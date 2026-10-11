import { Hono } from "hono";
import { requireToken, requireUser } from "./auth";
import {
  MARKETS, cryptoLast, cryptoPrices, cryptoSecondCandle, cryptoView, getMarket, type Market,
} from "./markets";
import { getFx } from "./fx";
import { rateLimit } from "./ratelimit";
import * as sim from "./synthetic";
import { HttpError, type AppEnv, type Env } from "./types";
import { bad, invalid, nowIso, num, readJson, str } from "./util";

export const STARTING_POINTS = 100;
// Binary-option-style payout: a correct guess returns this fraction of the stake as profit
// (stake itself is also returned), a wrong guess forfeits the full stake, a draw refunds it.
const PAYOUT_RATE = 0.85;
export const BET_SECONDS = 120; // every bet is judged exactly two minutes after it is placed
const CRYPTO_FINALIZE_MS = 2_000; // wait for the exchange to mark the closing second final

type Account = { user_id: string; points_balance: number; real_balance_kes: number };

type Lock = {
  user_id: string;
  symbol: string;
  kind: "sim" | "crypto";
  entry_tick: number;
  target_tick: number; // sim: tick index, crypto: opening time (ms) of the 1-second candle at the verdict
  entry_price: number;
  direction: "up" | "down";
  stake: number;
  currency: "points" | "kes";
  created_at: string;
};

const toBar = (c: sim.Candle) => ({
  timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
});

function requireMarket(symbol: string): Market {
  const m = getMarket(symbol);
  if (!m) throw bad(`Unknown market '${symbol}'`);
  return m;
}

/** Also used by PayHero: a user can deposit before ever having played. */
export async function ensureAccount(db: D1Database, userId: string): Promise<Account> {
  await db
    .prepare("INSERT OR IGNORE INTO prediction_accounts (user_id, points_balance, real_balance_kes, created_at) VALUES (?, ?, 0, ?)")
    .bind(userId, STARTING_POINTS, nowIso())
    .run();
  const row = await db.prepare("SELECT * FROM prediction_accounts WHERE user_id = ? LIMIT 1").bind(userId).first<any>();
  return { user_id: userId, points_balance: row.points_balance, real_balance_kes: row.real_balance_kes ?? 0 };
}

async function accountOut(db: D1Database, userId: string, acct: Account) {
  const row = await db
    .prepare("SELECT COUNT(*) AS total, COALESCE(SUM(correct), 0) AS correct FROM predictions WHERE user_id = ?")
    .bind(userId)
    .first<{ total: number; correct: number }>();
  return {
    points_balance: acct.points_balance,
    real_balance_kes: acct.real_balance_kes,
    total_predictions: row?.total ?? 0,
    correct_predictions: row?.correct ?? 0,
    payout_rate: PAYOUT_RATE,
  };
}

// ---- market views -----------------------------------------------------------------------

// Long simulated views are expensive to compute, so they are computed at a coarser
// "as of" tick and shared between users for a few seconds (the forming bar lags slightly).
const VIEW_STALENESS_TICKS: Record<sim.Range, number> = { "3m": 1, "15m": 1, "1h": 2, "6h": 5, "24h": 10 };
const viewCache = new Map<string, sim.Candle[]>();

async function barsFor(env: Env, market: Market, range: sim.Range): Promise<sim.Candle[]> {
  if (market.kind === "crypto") return cryptoView(market, range);
  const g = VIEW_STALENESS_TICKS[range];
  const latest = sim.latestClosedTick();
  const asOf = latest - (((latest % g) + g) % g);
  const cacheKey = `${market.id}|${range}|${asOf}`;
  let bars = viewCache.get(cacheKey);
  if (!bars) {
    bars = sim.getView(sim.marketKey(env.JWT_SECRET_KEY, market.id), market.id, asOf, range);
    if (viewCache.size > 120) viewCache.clear();
    viewCache.set(cacheKey, bars);
  }
  return bars;
}

// ---- bet settlement ---------------------------------------------------------------------

const getLock = (db: D1Database, userId: string, symbol: string) =>
  db.prepare("SELECT * FROM pending_bets WHERE user_id = ? AND symbol = ? LIMIT 1").bind(userId, symbol).first<Lock>();

function revealIn(lock: Lock): number {
  if (lock.kind === "sim") return sim.secondsUntilClosed(lock.target_tick);
  return Math.max(0, (lock.target_tick + 1000 + CRYPTO_FINALIZE_MS - Date.now()) / 1000);
}

const notReady = (lock: Lock, remaining = revealIn(lock)) =>
  new HttpError(425, {
    message: `Locked in - revealing in ${Math.ceil(remaining)}s.`,
    seconds_remaining: remaining,
    entry_price: lock.entry_price,
    direction: lock.direction,
    stake: lock.stake,
    currency: lock.currency,
  });

/** Settles a locked bet once its target candle is final. Throws 425 while still waiting. */
export async function settleBet(env: Env, lock: Lock) {
  const db = env.DB;
  const market = requireMarket(lock.symbol);
  if (revealIn(lock) > 0) throw notReady(lock);

  let exitBar: sim.Candle;
  if (lock.kind === "sim") {
    exitBar = sim.getCandle(sim.marketKey(env.JWT_SECRET_KEY, market.id), market.id, lock.target_tick);
  } else {
    // An upstream hiccup must never fail a bet: the stake stays escrowed, so just keep waiting.
    const c = await cryptoSecondCandle(market, lock.target_tick).catch(() => null);
    if (!c) throw notReady(lock, 3);
    exitBar = {
      tick_index: Math.floor(c.ts / 1000), timestamp: new Date(c.ts + 1000).toISOString(),
      open: c.o, high: c.h, low: c.l, close: c.c, volume: 0,
    };
  }
  // The verdict: is the price now higher or lower than it was when the bet was placed?
  const actual: "up" | "down" | "flat" =
    exitBar.close > lock.entry_price ? "up" : exitBar.close < lock.entry_price ? "down" : "flat";

  const draw = actual === "flat";
  const correct = !draw && lock.direction === actual;
  const payout = draw ? 0 : correct ? lock.stake * PAYOUT_RATE : -lock.stake;
  const credit = draw ? lock.stake : correct ? lock.stake * (1 + PAYOUT_RATE) : 0; // stake was escrowed up front
  const col = lock.currency === "kes" ? "real_balance_kes" : "points_balance";

  // The delete is the one-shot guard: only the call that removes the lock may pay out.
  const del = await db.prepare("DELETE FROM pending_bets WHERE user_id = ? AND symbol = ?").bind(lock.user_id, lock.symbol).run();
  if (!del.meta.changes) throw new HttpError(409, "This bet was already settled.");

  const statements = [
    db
      .prepare(
        `INSERT INTO predictions (id, user_id, symbol, timeframe, entry_time, entry_price, direction, stake, currency,
          exit_time, exit_price, correct, payout, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(), lock.user_id, lock.symbol, "2m", lock.created_at,
        lock.entry_price, lock.direction, lock.stake, lock.currency, exitBar.timestamp, exitBar.close,
        correct ? 1 : 0, payout, nowIso(),
      ),
  ];
  if (credit > 0) {
    statements.unshift(db.prepare(`UPDATE prediction_accounts SET ${col} = ${col} + ? WHERE user_id = ?`).bind(credit, lock.user_id));
  }
  await db.batch(statements);

  const fresh = await ensureAccount(db, lock.user_id);
  return {
    correct,
    draw,
    actual_direction: actual,
    entry_price: lock.entry_price,
    exit_price: exitBar.close,
    exit_bar: toBar(exitBar),
    payout,
    currency: lock.currency,
    points_balance: fresh.points_balance,
    real_balance_kes: fresh.real_balance_kes,
    next_entry_tick_index: lock.kind === "sim" ? lock.target_tick : 0,
    next_entry_price: exitBar.close,
  };
}

/** Cron: collect bets whose owner walked away, so winners are still paid. */
export async function settleOverdueBets(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - (BET_SECONDS + 30) * 1000).toISOString();
  const { results } = await env.DB.prepare("SELECT * FROM pending_bets WHERE created_at < ? LIMIT 50").bind(cutoff).all<Lock>();
  for (const lock of results) {
    try {
      await settleBet(env, lock);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error("settleOverdueBets:", e);
    }
  }
}

// ---- routes -----------------------------------------------------------------------------

export const prediction = new Hono<AppEnv>();

prediction.get("/markets", (c) => c.json(MARKETS));
prediction.get("/symbols", (c) => c.json(MARKETS.map((m) => m.id)));

prediction.get("/prices", requireToken, async (c) => {
  const crypto = await cryptoPrices().catch(() => ({ prices: {}, changes: {} }));
  const cities = sim.latestPrices(c.env.JWT_SECRET_KEY);
  return c.json({
    prices: { ...crypto.prices, ...cities.prices },
    changes: { ...crypto.changes, ...cities.changes },
    server_time: Date.now() / 1000,
  });
});

prediction.get("/fx", async (c) => c.json(await getFx()));

prediction.get("/round", requireUser, async (c) => {
  const user = c.get("user");
  const market = requireMarket((c.req.query("symbol") ?? "").toUpperCase());
  const account = await ensureAccount(c.env.DB, user.id);
  const bars = await barsFor(c.env, market, "3m");
  const last = bars[bars.length - 1];
  const lock = await getLock(c.env.DB, user.id, market.id);

  return c.json({
    symbol: market.id,
    kind: market.kind,
    seed: "",
    start_time: 0,
    tick_seconds: sim.TICK_SECONDS,
    bet_seconds: BET_SECONDS,
    bars: bars.map(toBar),
    entry_tick_index: market.kind === "sim" ? sim.latestClosedTick() : 0,
    entry_time: last.timestamp,
    entry_price: last.close,
    points_balance: account.points_balance,
    real_balance_kes: account.real_balance_kes,
    payout_rate: PAYOUT_RATE,
    server_time: Date.now() / 1000,
    pending: lock
      ? { direction: lock.direction, stake: lock.stake, currency: lock.currency, entry_price: lock.entry_price, seconds_remaining: revealIn(lock) }
      : null,
  });
});

prediction.get("/live", requireToken, async (c) => {
  const market = requireMarket((c.req.query("symbol") ?? "").toUpperCase());
  const range = c.req.query("range") ?? "3m";
  if (!sim.isRange(range)) throw bad(`range must be one of ${Object.keys(sim.RANGES).join(", ")}`);
  const bars = await barsFor(c.env, market, range);
  return c.json({
    bars: bars.map(toBar),
    latest_closed_tick_index: market.kind === "sim" ? sim.latestClosedTick() : 0,
    server_time: Date.now() / 1000,
  });
});

prediction.post("/resolve", rateLimit("resolve", 120), requireUser, async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const body = await readJson(c.req.raw);
  const market = requireMarket(str(body.symbol, "symbol").trim().toUpperCase());

  let lock = await getLock(db, user.id, market.id);
  if (!lock) {
    // First time the server hears about this bet: lock it in (direction, stake, entry and
    // target are all fixed now, server-side) and escrow the stake, so nothing the client
    // sends later - and nothing it can see on the chart - can change the outcome.
    const direction = str(body.direction, "direction").trim().toLowerCase();
    const stake = num(body.stake, "stake");
    const currency = str(body.currency ?? "points", "currency").trim().toLowerCase();
    if (direction !== "up" && direction !== "down") throw invalid("direction must be 'up' or 'down'");
    if (stake <= 0) throw invalid("stake must be positive");
    if (currency !== "points" && currency !== "kes") throw invalid('currency must be one of ["points","kes"]');

    let entryTick: number, targetTick: number, entryPrice: number;
    const now = Date.now();
    if (market.kind === "sim") {
      entryTick = sim.latestClosedTick();
      // the tick whose close is the first one at or after "now + 2 minutes"
      targetTick = Math.ceil((now + BET_SECONDS * 1000) / (sim.TICK_SECONDS * 1000)) - 1;
      entryPrice = sim.getCandle(sim.marketKey(c.env.JWT_SECRET_KEY, market.id), market.id, entryTick).close;
    } else {
      entryTick = now;
      targetTick = Math.floor((now + BET_SECONDS * 1000) / 1000) * 1000; // the second that ends ~2 minutes from now
      entryPrice = await cryptoLast(market);
    }

    const account = await ensureAccount(db, user.id);
    const balance = currency === "kes" ? account.real_balance_kes : account.points_balance;
    if (stake > balance) {
      throw bad(`Insufficient ${currency === "kes" ? "KES" : "points"} balance: stake is ${stake.toFixed(2)}, you have ${balance.toFixed(2)}`);
    }

    const fresh: Lock = {
      user_id: user.id, symbol: market.id, kind: market.kind, entry_tick: entryTick, target_tick: targetTick,
      entry_price: entryPrice, direction, stake, currency, created_at: nowIso(),
    };
    const ins = await db
      .prepare(
        `INSERT OR IGNORE INTO pending_bets (user_id, symbol, kind, entry_tick, target_tick, entry_price, direction, stake, currency, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(fresh.user_id, fresh.symbol, fresh.kind, fresh.entry_tick, fresh.target_tick, fresh.entry_price, fresh.direction, fresh.stake, fresh.currency, fresh.created_at)
      .run();
    if (ins.meta.changes) {
      const col = currency === "kes" ? "real_balance_kes" : "points_balance";
      const esc = await db
        .prepare(`UPDATE prediction_accounts SET ${col} = ${col} - ? WHERE user_id = ? AND ${col} >= ?`)
        .bind(stake, user.id, stake)
        .run();
      if (!esc.meta.changes) {
        await db.prepare("DELETE FROM pending_bets WHERE user_id = ? AND symbol = ?").bind(user.id, market.id).run();
        throw bad("Insufficient balance for this stake");
      }
      lock = fresh;
    } else {
      lock = (await getLock(db, user.id, market.id))!; // lost a race with a parallel request: use the existing lock
    }
  }

  return c.json(await settleBet(c.env, lock));
});

prediction.get("/account", requireUser, async (c) => {
  const user = c.get("user");
  return c.json(await accountOut(c.env.DB, user.id, await ensureAccount(c.env.DB, user.id)));
});

prediction.post("/deposit", rateLimit("points-deposit", 30), requireUser, async (c) => {
  // Practice points are capped at the starting balance: this only tops up to the cap.
  const user = c.get("user");
  const amount = num((await readJson(c.req.raw)).amount, "amount");
  if (amount <= 0) throw invalid("amount must be positive");
  const acct = await ensureAccount(c.env.DB, user.id);
  const next = Math.min(STARTING_POINTS, acct.points_balance + amount);
  if (next <= acct.points_balance) throw bad(`Practice points are capped at ${STARTING_POINTS}.`);
  await c.env.DB.prepare("UPDATE prediction_accounts SET points_balance = ? WHERE user_id = ?").bind(next, user.id).run();
  return c.json(await accountOut(c.env.DB, user.id, { ...acct, points_balance: next }));
});

prediction.post("/reset", rateLimit("reset", 10), requireUser, async (c) => {
  // Resets only the free-practice points balance and points-currency history.
  // Never touches real_balance_kes or 'kes' predictions - that's real money.
  const user = c.get("user");
  const acct = await ensureAccount(c.env.DB, user.id);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM pending_bets WHERE user_id = ? AND currency = 'points'").bind(user.id),
    c.env.DB.prepare("DELETE FROM predictions WHERE user_id = ? AND currency = 'points'").bind(user.id),
    c.env.DB.prepare("UPDATE prediction_accounts SET points_balance = ? WHERE user_id = ?").bind(STARTING_POINTS, user.id),
  ]);
  return c.json(await accountOut(c.env.DB, user.id, { ...acct, points_balance: STARTING_POINTS }));
});

prediction.get("/history", requireUser, async (c) => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));
  const { results } = await c.env.DB.prepare("SELECT * FROM predictions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .bind(c.get("user").id, limit)
    .all<any>();
  return c.json(
    results.map((p) => ({
      id: p.id, symbol: p.symbol, timeframe: p.timeframe, entry_time: p.entry_time, entry_price: p.entry_price,
      direction: p.direction, stake: p.stake, currency: p.currency ?? "points", exit_time: p.exit_time,
      exit_price: p.exit_price, correct: !!p.correct, draw: p.payout === 0 && !p.correct, payout: p.payout,
      created_at: p.created_at,
    })),
  );
});
