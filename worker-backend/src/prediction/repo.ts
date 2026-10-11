import type { Env } from "../types";

export const STARTING_POINTS = 1000.0;
export const PAYOUT_RATE = 0.85;
export const MAX_DEPOSIT = 100_000.0;

export interface PredictionAccount {
  user_id: string;
  points_balance: number;
  real_balance_kes: number;
  created_at: string;
}

export async function ensureAccount(env: Env, userId: string): Promise<PredictionAccount> {
  const row = await env.DB.prepare("SELECT * FROM prediction_accounts WHERE user_id = ? LIMIT 1").bind(userId).first();
  if (row) {
    return {
      user_id: row.user_id as string,
      points_balance: row.points_balance as number,
      real_balance_kes: (row.real_balance_kes as number) ?? 0,
      created_at: row.created_at as string,
    };
  }
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO prediction_accounts (user_id, points_balance, real_balance_kes, created_at) VALUES (?, ?, 0, ?)"
  )
    .bind(userId, STARTING_POINTS, createdAt)
    .run();
  return { user_id: userId, points_balance: STARTING_POINTS, real_balance_kes: 0, created_at: createdAt };
}

export async function setBalances(env: Env, userId: string, pointsBalance: number, realBalanceKes: number): Promise<void> {
  await env.DB.prepare("UPDATE prediction_accounts SET points_balance = ?, real_balance_kes = ? WHERE user_id = ?")
    .bind(pointsBalance, realBalanceKes, userId)
    .run();
}

export async function creditRealBalance(env: Env, userId: string, amount: number): Promise<void> {
  await ensureAccount(env, userId);
  await env.DB.prepare("UPDATE prediction_accounts SET real_balance_kes = real_balance_kes + ? WHERE user_id = ?")
    .bind(amount, userId)
    .run();
}

export interface PredictionRow {
  id: string;
  symbol: string;
  timeframe: string;
  entry_time: string;
  entry_price: number;
  direction: string;
  stake: number;
  currency: string;
  exit_time: string;
  exit_price: number;
  correct: boolean;
  payout: number;
  created_at: string;
}

export async function insertPrediction(env: Env, userId: string, p: PredictionRow): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO predictions (id, user_id, symbol, timeframe, entry_time, entry_price, direction, stake, " +
      "currency, exit_time, exit_price, correct, payout, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      p.id, userId, p.symbol, p.timeframe, p.entry_time, p.entry_price, p.direction, p.stake, p.currency,
      p.exit_time, p.exit_price, p.correct ? 1 : 0, p.payout, p.created_at
    )
    .run();
}

export async function accountStats(env: Env, userId: string) {
  const { results } = await env.DB.prepare("SELECT correct FROM predictions WHERE user_id = ?").bind(userId).all();
  const total = results.length;
  const correct = results.filter((r) => Boolean(r.correct)).length;
  return { total, correct };
}

export async function getHistory(env: Env, userId: string, limit = 50): Promise<PredictionRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM predictions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
  )
    .bind(userId, limit)
    .all();
  return results.map((r) => ({
    id: r.id as string, symbol: r.symbol as string, timeframe: r.timeframe as string,
    entry_time: r.entry_time as string, entry_price: r.entry_price as number, direction: r.direction as string,
    stake: r.stake as number, currency: (r.currency as string) ?? "points", exit_time: r.exit_time as string,
    exit_price: r.exit_price as number, correct: Boolean(r.correct), payout: r.payout as number,
    created_at: r.created_at as string,
  }));
}

export async function deletePointsHistory(env: Env, userId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM predictions WHERE user_id = ? AND currency = 'points'").bind(userId).run();
}
