/** Real-money deposits via PayHero's M-Pesa STK push API (deposits only - no withdrawals).
 *   POST https://backend.payhero.co.ke/api/v2/payments
 *   GET  https://backend.payhero.co.ke/api/v2/transaction-status?reference=...
 *   Callback POSTed to callback_url: {status, response: {ResultCode, ExternalReference, ...}}
 */
import { Hono } from "hono";
import { requireUser, } from "./auth";
import { getFx } from "./fx";
import { ensureAccount } from "./prediction";
import { rateLimit } from "./ratelimit";
import { HttpError, type AppEnv, type Env } from "./types";
import { bad, invalid, nowIso, num, readJson, str, validatePhone } from "./util";

const BASE_URL = "https://backend.payhero.co.ke/api/v2";
export const MIN_DEPOSIT_KES = 1000;
const MAX_DEPOSIT_KES = 250_000; // M-Pesa single-transaction ceiling

type Deposit = {
  id: string;
  user_id: string;
  external_reference: string;
  checkout_request_id: string | null;
  provider_reference: string | null;
  phone_number: string;
  amount: number;
  status: string;
  mpesa_receipt_number: string | null;
  result_desc: string | null;
  created_at: string;
  updated_at: string;
};

const notConfigured = (m: string) => new HttpError(503, m);

function authHeaders(env: Env): Record<string, string> {
  if (!env.PAYHERO_API_USERNAME || !env.PAYHERO_API_PASSWORD) {
    throw notConfigured("PayHero credentials are not configured (PAYHERO_API_USERNAME/PAYHERO_API_PASSWORD).");
  }
  return {
    Authorization: `Basic ${btoa(`${env.PAYHERO_API_USERNAME}:${env.PAYHERO_API_PASSWORD}`)}`,
    "Content-Type": "application/json",
  };
}

const getByReference = (db: D1Database, ref: string) =>
  db.prepare("SELECT * FROM payhero_deposits WHERE external_reference = ? LIMIT 1").bind(ref).first<Deposit>();

/** Atomically moves a deposit pending -> success/failed. Returns true only for the
 * one call that made the transition, so a replayed webhook or repeated status poll
 * can never credit the same deposit twice. */
async function settle(
  db: D1Database,
  dep: Deposit,
  status: "success" | "failed",
  receipt: string | null,
  desc: string | null,
): Promise<boolean> {
  const res = await db
    .prepare(
      "UPDATE payhero_deposits SET status = ?, mpesa_receipt_number = ?, result_desc = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
    )
    .bind(status, receipt, desc, nowIso(), dep.id)
    .run();
  if (!res.meta.changes) return false;
  if (status === "success") {
    await ensureAccount(db, dep.user_id);
    await db
      .prepare("UPDATE prediction_accounts SET real_balance_kes = real_balance_kes + ? WHERE user_id = ?")
      .bind(dep.amount, dep.user_id)
      .run();
  }
  return true;
}

export const payhero = new Hono<AppEnv>();

payhero.post("/deposit", rateLimit("payhero-deposit", 10), requireUser, async (c) => {
  const user = c.get("user");
  const body = await readJson(c.req.raw);
  const amount = Math.trunc(num(body.amount, "amount"));
  if (amount < MIN_DEPOSIT_KES) {
    const fx = await getFx();
    throw invalid(`Minimum deposit is KES ${MIN_DEPOSIT_KES.toLocaleString("en-US")} (about $${(MIN_DEPOSIT_KES * fx.usd_per_kes).toFixed(2)} USD)`);
  }
  if (amount > MAX_DEPOSIT_KES) throw invalid(`Maximum deposit is KES ${MAX_DEPOSIT_KES.toLocaleString("en-US")} per transaction`);
  const phone = validatePhone(str(body.phone_number, "phone_number"));
  if (!phone) throw invalid("phone_number must be a valid M-Pesa number, e.g. 0712345678");

  if (!c.env.PAYHERO_CHANNEL_ID) throw notConfigured("PAYHERO_CHANNEL_ID is not configured.");
  const externalReference = `CFX-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const payload: Record<string, unknown> = {
    amount,
    phone_number: phone,
    channel_id: Number(c.env.PAYHERO_CHANNEL_ID),
    provider: "m-pesa",
    external_reference: externalReference,
  };
  if (c.env.PAYHERO_CALLBACK_BASE_URL) payload.callback_url = `${c.env.PAYHERO_CALLBACK_BASE_URL}/api/payhero/callback`;

  const headers = authHeaders(c.env);
  let resp: Response;
  try {
    resp = await fetch(`${BASE_URL}/payments`, { method: "POST", headers, body: JSON.stringify(payload) });
  } catch (e) {
    throw new HttpError(502, `Could not reach PayHero: ${e}`);
  }
  if (resp.status !== 200 && resp.status !== 201) {
    throw new HttpError(502, `PayHero rejected the deposit request (HTTP ${resp.status}): ${(await resp.text()).slice(0, 300)}`);
  }
  const data = (await resp.json()) as any;
  const now = nowIso();
  const dep: Deposit = {
    id: crypto.randomUUID(),
    user_id: user.id,
    external_reference: externalReference,
    checkout_request_id: data.CheckoutRequestID ?? null,
    provider_reference: data.reference ?? null, // PayHero's own reference, needed for /transaction-status
    phone_number: phone,
    amount,
    status: "pending",
    mpesa_receipt_number: null,
    result_desc: null,
    created_at: now,
    updated_at: now,
  };
  await c.env.DB.prepare(
    `INSERT INTO payhero_deposits (id, user_id, external_reference, checkout_request_id, provider_reference, phone_number,
      amount, status, mpesa_receipt_number, result_desc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      dep.id, dep.user_id, dep.external_reference, dep.checkout_request_id, dep.provider_reference, dep.phone_number,
      dep.amount, dep.status, dep.mpesa_receipt_number, dep.result_desc, dep.created_at, dep.updated_at,
    )
    .run();

  return c.json(
    { external_reference: dep.external_reference, checkout_request_id: dep.checkout_request_id, status: dep.status },
    201,
  );
});

payhero.get("/deposit/:ref", requireUser, async (c) => {
  const user = c.get("user");
  const dep = await getByReference(c.env.DB, c.req.param("ref"));
  if (!dep || dep.user_id !== user.id) throw new HttpError(404, "Deposit not found.");

  if (dep.status === "pending") {
    if (!dep.provider_reference) {
      throw new HttpError(
        404,
        "This deposit has no PayHero-issued reference yet - cannot check status. It should still resolve via the callback webhook.",
      );
    }
    let resp: Response;
    try {
      resp = await fetch(`${BASE_URL}/transaction-status?reference=${encodeURIComponent(dep.provider_reference)}`, {
        headers: authHeaders(c.env),
      });
    } catch (e) {
      throw new HttpError(404, `Could not reach PayHero: ${e}`);
    }
    if (resp.status !== 200) {
      throw new HttpError(404, `PayHero status check failed (HTTP ${resp.status}): ${(await resp.text()).slice(0, 300)}`);
    }
    const remote = (await resp.json()) as any;
    if (remote.status === "SUCCESS") {
      await settle(c.env.DB, dep, "success", remote.provider_reference ?? null, null);
    } else if (remote.status === "FAILED") {
      await settle(c.env.DB, dep, "failed", null, "Payment failed");
    }
  }
  return c.json(await getByReference(c.env.DB, dep.external_reference));
});

payhero.get("/deposits", requireUser, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM payhero_deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
  )
    .bind(c.get("user").id)
    .all();
  return c.json(results);
});

// PayHero calls this directly - no user JWT. The deposit is matched purely by the
// external_reference it echoes back; it can only settle that one pre-created row.
payhero.post("/callback", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ received: true, matched: false });
  }
  const r = body?.response ?? {};
  const ref: string | undefined = r.ExternalReference;
  // Always 200: PayHero retries on non-2xx, and retrying won't fix an unmatched reference.
  if (!ref) return c.json({ received: true, matched: false });
  const dep = await getByReference(c.env.DB, ref);
  if (!dep) return c.json({ received: true, matched: false });

  if (dep.status === "pending") {
    const success = body.status === true && r.ResultCode === 0;
    await settle(c.env.DB, dep, success ? "success" : "failed", r.MpesaReceiptNumber ?? null, r.ResultDesc ?? null);
  }
  const fresh = await getByReference(c.env.DB, ref);
  return c.json({ received: true, matched: true, status: fresh?.status });
});
