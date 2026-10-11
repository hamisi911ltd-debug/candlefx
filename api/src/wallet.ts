/** Withdrawals (paid out in batches every 3 working days), real-money activity ledger, and the
 * operator endpoints used to confirm payouts. */
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { requireUser } from "./auth";
import { getFx } from "./fx";
import { ensureAccount } from "./prediction";
import { rateLimit } from "./ratelimit";
import { CUTOFF_HOUR, PAYOUT_EVERY_WORKING_DAYS, PAYOUT_HOUR, TIMEZONE, nextPayout, upcomingPayouts } from "./schedule";
import { HttpError, type AppEnv, type Env } from "./types";
import { bad, invalid, nowIso, num, readJson, str, validatePhone } from "./util";

export const MIN_WITHDRAW_KES = 500;
const MAX_WITHDRAW_KES = 250_000;

type Withdrawal = {
  id: string; user_id: string; amount: number; phone_number: string; status: string;
  cutoff_at: string; scheduled_for: string; payout_reference: string | null; note: string | null;
  created_at: string; updated_at: string;
};

const event = (db: D1Database, id: string, status: string, note: string | null) =>
  db.prepare("INSERT INTO withdrawal_events (withdrawal_id, status, note, at) VALUES (?, ?, ?, ?)").bind(id, status, note, nowIso());

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TIMEZONE });

/** Attach each withdrawal's status timeline. */
async function withEvents(db: D1Database, rows: Withdrawal[]) {
  if (!rows.length) return [];
  const marks = rows.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT withdrawal_id, status, note, at FROM withdrawal_events WHERE withdrawal_id IN (${marks}) ORDER BY id`)
    .bind(...rows.map((r) => r.id))
    .all<{ withdrawal_id: string; status: string; note: string | null; at: string }>();
  const by = new Map<string, { status: string; note: string | null; at: string }[]>();
  for (const e of results) (by.get(e.withdrawal_id) ?? by.set(e.withdrawal_id, []).get(e.withdrawal_id)!).push({ status: e.status, note: e.note, at: e.at });
  return rows.map((r) => ({ ...r, events: by.get(r.id) ?? [] }));
}

/** Refund an escrowed withdrawal and close it with `status`. Only the call that changes the status refunds. */
async function closeAndRefund(db: D1Database, w: Withdrawal, from: string[], status: "cancelled" | "rejected", note: string) {
  const marks = from.map(() => "?").join(",");
  const res = await db
    .prepare(`UPDATE withdrawals SET status = ?, note = ?, updated_at = ? WHERE id = ? AND status IN (${marks})`)
    .bind(status, note, nowIso(), w.id, ...from)
    .run();
  if (!res.meta.changes) return false;
  await db.batch([
    db.prepare("UPDATE prediction_accounts SET real_balance_kes = real_balance_kes + ? WHERE user_id = ?").bind(w.amount, w.user_id),
    event(db, w.id, status, note),
  ]);
  return true;
}

export const wallet = new Hono<AppEnv>();

wallet.get("/schedule", async (c) => {
  const next = nextPayout();
  return c.json({
    timezone: TIMEZONE,
    rule: `Payouts run every ${PAYOUT_EVERY_WORKING_DAYS} working days (Mon-Fri). Requests made before ${String(CUTOFF_HOUR).padStart(2, "0")}:00 on a payout day are paid that day at ${PAYOUT_HOUR}:00; later requests wait for the next payout.`,
    every_working_days: PAYOUT_EVERY_WORKING_DAYS,
    min_kes: MIN_WITHDRAW_KES,
    max_kes: MAX_WITHDRAW_KES,
    next,
    upcoming: upcomingPayouts(5),
    server_time: Date.now() / 1000,
  });
});

wallet.post("/withdraw", rateLimit("withdraw", 10), requireUser, async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const body = await readJson(c.req.raw);
  const amount = Math.trunc(num(body.amount, "amount"));
  const phone = validatePhone(str(body.phone_number, "phone_number"));
  if (!phone) throw invalid("phone_number must be a valid M-Pesa number, e.g. 0712345678");
  if (amount < MIN_WITHDRAW_KES) {
    const fx = await getFx();
    throw invalid(`Minimum withdrawal is KES ${MIN_WITHDRAW_KES.toLocaleString("en-US")} (about $${(MIN_WITHDRAW_KES * fx.usd_per_kes).toFixed(2)} USD)`);
  }
  if (amount > MAX_WITHDRAW_KES) throw invalid(`Maximum withdrawal is KES ${MAX_WITHDRAW_KES.toLocaleString("en-US")} per request`);

  const account = await ensureAccount(db, user.id);
  if (amount > account.real_balance_kes) {
    throw bad(`Insufficient real balance: you asked for KES ${amount.toLocaleString("en-US")} but have KES ${account.real_balance_kes.toFixed(2)}`);
  }

  const batch = nextPayout();
  const now = nowIso();
  const w: Withdrawal = {
    id: crypto.randomUUID(), user_id: user.id, amount, phone_number: phone, status: "scheduled",
    cutoff_at: batch.cutoff_at, scheduled_for: batch.payout_at, payout_reference: null, note: null,
    created_at: now, updated_at: now,
  };

  // Escrow first (conditional, so concurrent requests can't overdraw), then create the request.
  const esc = await db
    .prepare("UPDATE prediction_accounts SET real_balance_kes = real_balance_kes - ? WHERE user_id = ? AND real_balance_kes >= ?")
    .bind(amount, user.id, amount)
    .run();
  if (!esc.meta.changes) throw bad("Insufficient real balance");

  await db.batch([
    db
      .prepare(
        `INSERT INTO withdrawals (id, user_id, amount, phone_number, status, cutoff_at, scheduled_for, payout_reference, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      )
      .bind(w.id, w.user_id, w.amount, w.phone_number, w.status, w.cutoff_at, w.scheduled_for, now, now),
    event(db, w.id, "requested", `KES ${amount.toLocaleString("en-US")} to ${phone}`),
    event(db, w.id, "scheduled", `Queued for the ${fmtDay(batch.payout_at)} payout`),
  ]);

  return c.json((await withEvents(db, [w]))[0], 201);
});

wallet.get("/withdrawals", requireUser, async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 30")
    .bind(c.get("user").id)
    .all<Withdrawal>();
  return c.json(await withEvents(c.env.DB, results));
});

wallet.post("/withdrawals/:id/cancel", requireUser, async (c) => {
  const db = c.env.DB;
  const w = await db.prepare("SELECT * FROM withdrawals WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.get("user").id).first<Withdrawal>();
  if (!w) throw new HttpError(404, "Withdrawal not found");
  if (w.status !== "scheduled") throw bad(`This withdrawal is already ${w.status} and can no longer be cancelled.`);
  if (Date.now() >= Date.parse(w.cutoff_at)) throw bad("The cut-off for this payout has passed, so it can no longer be cancelled.");
  if (!(await closeAndRefund(db, w, ["scheduled"], "cancelled", "Cancelled by you - funds returned to your balance"))) {
    throw bad("This withdrawal can no longer be cancelled.");
  }
  return c.json((await withEvents(db, [{ ...w, status: "cancelled" }]))[0]);
});

// Every money movement on the real wallet, newest first - for live tracking and tracing.
wallet.get("/activity", requireUser, async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 30) || 30));
  const uid = c.get("user").id;
  const { results } = await c.env.DB.prepare(
    `SELECT id, 'deposit' AS type, amount AS amount_kes, status, created_at, external_reference AS ref, NULL AS detail
       FROM payhero_deposits WHERE user_id = ?1
     UNION ALL
     SELECT id, 'withdrawal', -amount, status, created_at, phone_number, scheduled_for
       FROM withdrawals WHERE user_id = ?1
     UNION ALL
     SELECT id, 'trade', payout,
            CASE WHEN payout = 0 THEN 'draw' WHEN correct = 1 THEN 'won' ELSE 'lost' END,
            created_at, symbol, direction
       FROM predictions WHERE user_id = ?1 AND currency = 'kes'
     UNION ALL
     SELECT user_id || ':' || symbol, 'trade', -stake, 'open', created_at, symbol, direction
       FROM pending_bets WHERE user_id = ?1 AND currency = 'kes'
     ORDER BY created_at DESC LIMIT ?2`,
  )
    .bind(uid, limit)
    .all();
  return c.json(results);
});

// ---- operator endpoints (payout confirmation) ---------------------------------------------

const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const key = c.env.ADMIN_API_KEY;
  const given = c.req.header("X-Admin-Key") ?? "";
  if (!key || given.length !== key.length || !timingEq(given, key)) throw new HttpError(403, "Forbidden");
  await next();
});

function timingEq(a: string, b: string): boolean {
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export const admin = new Hono<AppEnv>();
admin.use("*", requireAdmin);

admin.get("/withdrawals", async (c) => {
  const status = c.req.query("status") ?? "scheduled,processing";
  const list = status.split(",").map((s) => s.trim()).filter(Boolean);
  const { results } = await c.env.DB
    .prepare(`SELECT w.*, u.email FROM withdrawals w JOIN users u ON u.id = w.user_id WHERE w.status IN (${list.map(() => "?").join(",")}) ORDER BY w.scheduled_for, w.created_at`)
    .bind(...list)
    .all();
  return c.json(results);
});

admin.post("/withdrawals/:id/paid", async (c) => {
  const db = c.env.DB;
  const body = await readJson(c.req.raw);
  const reference = str(body.reference ?? "", "reference").trim();
  const res = await db
    .prepare("UPDATE withdrawals SET status = 'paid', payout_reference = ?, updated_at = ? WHERE id = ? AND status IN ('processing','scheduled')")
    .bind(reference || null, nowIso(), c.req.param("id"))
    .run();
  if (!res.meta.changes) throw bad("Withdrawal not found or already finalised");
  await event(db, c.req.param("id"), "paid", reference ? `Sent via M-Pesa - ref ${reference}` : "Sent via M-Pesa").run();
  return c.json({ ok: true });
});

admin.post("/withdrawals/:id/reject", async (c) => {
  const db = c.env.DB;
  const body = await readJson(c.req.raw);
  const reason = str(body.reason ?? "Rejected", "reason").trim() || "Rejected";
  const w = await db.prepare("SELECT * FROM withdrawals WHERE id = ?").bind(c.req.param("id")).first<Withdrawal>();
  if (!w) throw new HttpError(404, "Withdrawal not found");
  if (!(await closeAndRefund(db, w, ["processing", "scheduled"], "rejected", `Rejected: ${reason} - funds returned to your balance`))) {
    throw bad("Withdrawal already finalised");
  }
  return c.json({ ok: true });
});

/** Cron: when a batch's payout time arrives, move its requests from scheduled to processing. */
export async function advanceWithdrawals(env: Env): Promise<void> {
  const db = env.DB;
  const { results } = await db
    .prepare("SELECT id FROM withdrawals WHERE status = 'scheduled' AND scheduled_for <= ? LIMIT 100")
    .bind(nowIso())
    .all<{ id: string }>();
  for (const { id } of results) {
    const res = await db.prepare("UPDATE withdrawals SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'scheduled'").bind(nowIso(), id).run();
    if (res.meta.changes) await event(db, id, "processing", "Payout batch started - sending to your M-Pesa").run();
  }
}
