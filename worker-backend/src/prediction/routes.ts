import { Hono } from "hono";
import type { Env, AppUser } from "../types";
import { requireAuth } from "../middleware/auth";
import * as market from "../market/synthetic";
import {
  accountStats, creditRealBalance, deletePointsHistory, ensureAccount, getHistory,
  insertPrediction, setBalances, MAX_DEPOSIT, PAYOUT_RATE, STARTING_POINTS,
} from "./repo";

export const predictionRoutes = new Hono<{ Bindings: Env; Variables: { user: AppUser } }>();
predictionRoutes.use("*", requireAuth);

const VISIBLE_CANDLES = 60;

function candleToBar(c: market.Candle) {
  return { timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
}

predictionRoutes.get("/symbols", (c) =>
  c.json(
    Object.entries(market.SYMBOL_PROFILES)
      .map(([id, p]) => ({ id, label: p.label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  )
);

predictionRoutes.get("/round", async (c) => {
  const symbol = (c.req.query("symbol") || "").toUpperCase();
  if (!market.SYMBOL_PROFILES[symbol]) {
    return c.json({ detail: `Unknown symbol '${symbol}'` }, 400);
  }
  const user = c.get("user");
  const account = await ensureAccount(c.env, user.id);

  const seed = crypto.randomUUID().replace(/-/g, "");
  const startTime = Date.now() / 1000;
  const entryTickIndex = -1;
  const candles = market.getCandles(seed, symbol, startTime, VISIBLE_CANDLES, entryTickIndex);
  const entry = candles[candles.length - 1];

  return c.json({
    symbol, seed, start_time: startTime, tick_seconds: market.TICK_SECONDS,
    bars: candles.map(candleToBar), entry_tick_index: entryTickIndex,
    entry_time: entry.timestamp, entry_price: entry.close,
    points_balance: account.points_balance, real_balance_kes: account.real_balance_kes,
    payout_rate: PAYOUT_RATE, server_time: Date.now() / 1000,
  });
});

predictionRoutes.get("/live", async (c) => {
  const symbol = (c.req.query("symbol") || "").toUpperCase();
  const seed = c.req.query("seed") || "";
  const startTime = parseFloat(c.req.query("start_time") || "0");
  const latestClosed = market.currentTickIndex(startTime) - 1;
  const candles = market.getCandles(seed, symbol, startTime, VISIBLE_CANDLES, latestClosed);
  return c.json({ bars: candles.map(candleToBar), latest_closed_tick_index: latestClosed, server_time: Date.now() / 1000 });
});

predictionRoutes.post("/resolve", async (c) => {
  type Body = {
    symbol?: string; seed?: string; start_time?: number; entry_tick_index?: number;
    direction?: string; stake?: number; currency?: string;
  };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);

  const symbol = (body.symbol || "").toUpperCase();
  const seed = body.seed || "";
  const startTime = body.start_time ?? 0;
  const entryTickIndex = body.entry_tick_index ?? 0;
  const direction = (body.direction || "").toLowerCase();
  const stake = body.stake ?? 0;
  const currency = (body.currency || "points").toLowerCase();

  if (!market.SYMBOL_PROFILES[symbol]) return c.json({ detail: `Unknown symbol '${symbol}'` }, 400);
  if (direction !== "up" && direction !== "down") return c.json({ detail: "direction must be 'up' or 'down'" }, 422);
  if (stake <= 0) return c.json({ detail: "stake must be positive" }, 422);
  if (currency !== "points" && currency !== "kes") return c.json({ detail: "currency must be 'points' or 'kes'" }, 422);

  const targetTick = entryTickIndex + 1;
  if (!market.tickIsClosed(startTime, targetTick)) {
    const secondsRemaining = market.secondsUntilClosed(startTime, targetTick);
    return c.json({ detail: { message: `Not decided yet - ${secondsRemaining.toFixed(1)}s left.`, seconds_remaining: secondsRemaining } }, 425);
  }

  const user = c.get("user");
  const account = await ensureAccount(c.env, user.id);
  const isReal = currency === "kes";
  const currentBalance = isReal ? account.real_balance_kes : account.points_balance;
  if (stake > currentBalance) {
    return c.json({ detail: `Insufficient ${isReal ? "KES" : "points"} balance: stake is ${stake.toFixed(2)}, you have ${currentBalance.toFixed(2)}` }, 400);
  }

  const entryCandle = market.getCandle(seed, symbol, startTime, entryTickIndex);
  const exitCandle = market.getCandle(seed, symbol, startTime, targetTick);
  const actualDirection = exitCandle.close >= exitCandle.open ? "up" : "down";
  const correct = direction === actualDirection;
  const payout = correct ? stake * PAYOUT_RATE : -stake;
  const newBalance = currentBalance + payout;
  const newPoints = isReal ? account.points_balance : newBalance;
  const newReal = isReal ? newBalance : account.real_balance_kes;

  await insertPrediction(c.env, user.id, {
    id: crypto.randomUUID(), symbol, timeframe: "tick", entry_time: entryCandle.timestamp,
    entry_price: entryCandle.close, direction, stake, currency,
    exit_time: exitCandle.timestamp, exit_price: exitCandle.close, correct, payout,
    created_at: new Date().toISOString(),
  });
  await setBalances(c.env, user.id, newPoints, newReal);

  return c.json({
    correct, actual_direction: actualDirection, exit_price: exitCandle.close, exit_bar: candleToBar(exitCandle),
    payout, currency, points_balance: newPoints, real_balance_kes: newReal,
    next_entry_tick_index: targetTick, next_entry_price: exitCandle.close,
  });
});

predictionRoutes.get("/account", async (c) => {
  const user = c.get("user");
  const account = await ensureAccount(c.env, user.id);
  const stats = await accountStats(c.env, user.id);
  return c.json({
    points_balance: account.points_balance, real_balance_kes: account.real_balance_kes,
    total_predictions: stats.total, correct_predictions: stats.correct, payout_rate: PAYOUT_RATE,
  });
});

predictionRoutes.post("/deposit", async (c) => {
  type Body = { amount?: number };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const amount = body.amount ?? 0;
  if (amount <= 0) return c.json({ detail: "Deposit amount must be positive" }, 400);
  if (amount > MAX_DEPOSIT) return c.json({ detail: `Deposit amount cannot exceed ${MAX_DEPOSIT} points` }, 400);

  const user = c.get("user");
  const account = await ensureAccount(c.env, user.id);
  const newBalance = account.points_balance + amount;
  await setBalances(c.env, user.id, newBalance, account.real_balance_kes);
  const stats = await accountStats(c.env, user.id);
  return c.json({
    points_balance: newBalance, real_balance_kes: account.real_balance_kes,
    total_predictions: stats.total, correct_predictions: stats.correct, payout_rate: PAYOUT_RATE,
  });
});

predictionRoutes.post("/reset", async (c) => {
  const user = c.get("user");
  const account = await ensureAccount(c.env, user.id);
  await deletePointsHistory(c.env, user.id);
  await setBalances(c.env, user.id, STARTING_POINTS, account.real_balance_kes);
  const stats = await accountStats(c.env, user.id);
  return c.json({
    points_balance: STARTING_POINTS, real_balance_kes: account.real_balance_kes,
    total_predictions: stats.total, correct_predictions: stats.correct, payout_rate: PAYOUT_RATE,
  });
});

predictionRoutes.get("/history", async (c) => {
  const user = c.get("user");
  const history = await getHistory(c.env, user.id);
  return c.json(history);
});

export { creditRealBalance };
