/** Same PayHero API contract as the Python backend's payhero_service.py, ported to
 * `fetch`. See that file's docstring for the full endpoint reference - extracted
 * from PayHero's own docs, not guessed. */
import type { Env } from "../types";
import { creditRealBalance } from "../prediction/repo";
import { getDepositByReference, insertDeposit, updateDepositStatus, type PayHeroDeposit } from "./repo";

const BASE_URL = "https://backend.payhero.co.ke/api/v2";

export class PayHeroError extends Error {}
export class PayHeroNotConfigured extends PayHeroError {}

function authHeader(env: Env): HeadersInit {
  if (!env.PAYHERO_API_USERNAME || !env.PAYHERO_API_PASSWORD) {
    throw new PayHeroNotConfigured("PayHero credentials are not configured.");
  }
  const token = btoa(`${env.PAYHERO_API_USERNAME}:${env.PAYHERO_API_PASSWORD}`);
  return { Authorization: `Basic ${token}`, "Content-Type": "application/json" };
}

export async function initiateDeposit(env: Env, userId: string, amount: number, phoneNumber: string): Promise<PayHeroDeposit> {
  if (!env.PAYHERO_CHANNEL_ID) throw new PayHeroNotConfigured("PAYHERO_CHANNEL_ID is not configured.");

  const externalReference = `CFX-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const callbackUrl = env.PAYHERO_CALLBACK_BASE_URL ? `${env.PAYHERO_CALLBACK_BASE_URL}/api/payhero/callback` : undefined;

  const body: Record<string, unknown> = {
    amount, phone_number: phoneNumber, channel_id: parseInt(env.PAYHERO_CHANNEL_ID, 10),
    provider: "m-pesa", external_reference: externalReference,
  };
  if (callbackUrl) body.callback_url = callbackUrl;

  const resp = await fetch(`${BASE_URL}/payments`, { method: "POST", headers: authHeader(env), body: JSON.stringify(body) });
  if (resp.status !== 200 && resp.status !== 201) {
    const text = await resp.text();
    throw new PayHeroError(`PayHero rejected the deposit request (HTTP ${resp.status}): ${text.slice(0, 300)}`);
  }
  const data = await resp.json<{ CheckoutRequestID?: string; reference?: string }>();

  const now = new Date().toISOString();
  const deposit: PayHeroDeposit = {
    id: crypto.randomUUID(), user_id: userId, external_reference: externalReference,
    checkout_request_id: data.CheckoutRequestID ?? null, provider_reference: data.reference ?? null,
    phone_number: phoneNumber, amount, status: "pending", mpesa_receipt_number: null, result_desc: null,
    created_at: now, updated_at: now,
  };
  await insertDeposit(env, deposit);
  return deposit;
}

export interface CallbackPayload {
  status: boolean;
  response: {
    ExternalReference?: string; ResultCode?: number; MpesaReceiptNumber?: string; ResultDesc?: string;
  };
}

export async function handleCallback(env: Env, payload: CallbackPayload): Promise<PayHeroDeposit> {
  const ref = payload.response.ExternalReference;
  if (!ref) throw new PayHeroError("Callback is missing ExternalReference.");

  const deposit = await getDepositByReference(env, ref);
  if (!deposit) throw new PayHeroError(`No deposit found for reference '${ref}'.`);
  if (deposit.status !== "pending") return deposit; // idempotent - never double-credit a replay

  const success = payload.status && payload.response.ResultCode === 0;
  const status = success ? "success" : "failed";
  await updateDepositStatus(env, deposit.id, status, payload.response.MpesaReceiptNumber ?? null, payload.response.ResultDesc ?? null);
  if (success) await creditRealBalance(env, deposit.user_id, deposit.amount);

  return { ...deposit, status, mpesa_receipt_number: payload.response.MpesaReceiptNumber ?? null, result_desc: payload.response.ResultDesc ?? null };
}

export async function checkStatus(env: Env, userId: string, externalReference: string): Promise<PayHeroDeposit> {
  const deposit = await getDepositByReference(env, externalReference);
  if (!deposit || deposit.user_id !== userId) throw new PayHeroError("Deposit not found.");
  if (deposit.status !== "pending") return deposit;
  if (!deposit.provider_reference) {
    throw new PayHeroError("This deposit has no PayHero-issued reference yet - it should still resolve via the callback webhook.");
  }

  const resp = await fetch(`${BASE_URL}/transaction-status?reference=${encodeURIComponent(deposit.provider_reference)}`, {
    headers: authHeader(env),
  });
  if (resp.status !== 200) {
    const text = await resp.text();
    throw new PayHeroError(`PayHero status check failed (HTTP ${resp.status}): ${text.slice(0, 300)}`);
  }
  const data = await resp.json<{ status?: string; provider_reference?: string }>();

  if (data.status === "SUCCESS") {
    await updateDepositStatus(env, deposit.id, "success", data.provider_reference ?? null, null);
    await creditRealBalance(env, deposit.user_id, deposit.amount);
    return { ...deposit, status: "success", mpesa_receipt_number: data.provider_reference ?? null };
  }
  if (data.status === "FAILED") {
    await updateDepositStatus(env, deposit.id, "failed", null, "Payment failed");
    return { ...deposit, status: "failed" };
  }
  return deposit;
}
