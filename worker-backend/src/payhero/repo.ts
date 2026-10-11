import type { Env } from "../types";

export interface PayHeroDeposit {
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
}

function rowToDeposit(r: Record<string, unknown>): PayHeroDeposit {
  return {
    id: r.id as string, user_id: r.user_id as string, external_reference: r.external_reference as string,
    checkout_request_id: (r.checkout_request_id as string) ?? null,
    provider_reference: (r.provider_reference as string) ?? null,
    phone_number: r.phone_number as string, amount: r.amount as number, status: r.status as string,
    mpesa_receipt_number: (r.mpesa_receipt_number as string) ?? null,
    result_desc: (r.result_desc as string) ?? null,
    created_at: r.created_at as string, updated_at: r.updated_at as string,
  };
}

export async function getDepositByReference(env: Env, ref: string): Promise<PayHeroDeposit | null> {
  const row = await env.DB.prepare("SELECT * FROM payhero_deposits WHERE external_reference = ? LIMIT 1").bind(ref).first();
  return row ? rowToDeposit(row) : null;
}

export async function insertDeposit(env: Env, d: PayHeroDeposit): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO payhero_deposits (id, user_id, external_reference, checkout_request_id, provider_reference, " +
      "phone_number, amount, status, mpesa_receipt_number, result_desc, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      d.id, d.user_id, d.external_reference, d.checkout_request_id, d.provider_reference, d.phone_number,
      d.amount, d.status, d.mpesa_receipt_number, d.result_desc, d.created_at, d.updated_at
    )
    .run();
}

export async function updateDepositStatus(
  env: Env, depositId: string, status: string, mpesaReceipt: string | null, resultDesc: string | null
): Promise<void> {
  await env.DB.prepare(
    "UPDATE payhero_deposits SET status = ?, mpesa_receipt_number = ?, result_desc = ?, updated_at = ? WHERE id = ?"
  )
    .bind(status, mpesaReceipt, resultDesc, new Date().toISOString(), depositId)
    .run();
}

export async function listDeposits(env: Env, userId: string, limit = 50): Promise<PayHeroDeposit[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM payhero_deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
  )
    .bind(userId, limit)
    .all();
  return results.map(rowToDeposit);
}
