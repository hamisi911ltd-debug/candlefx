import type { Env, AppUser } from "../types";

function rowToUser(row: Record<string, unknown>): AppUser {
  return {
    id: row.id as string,
    email: row.email as string,
    is_active: Boolean(row.is_active),
    trading_paused: Boolean(row.trading_paused),
    phone_number: (row.phone_number as string | null) ?? null,
  };
}

export async function getUserByEmail(env: Env, email: string): Promise<AppUser | null> {
  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ? LIMIT 1").bind(email).first();
  return row ? rowToUser(row) : null;
}

export async function getUserById(env: Env, id: string): Promise<AppUser | null> {
  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(id).first();
  return row ? rowToUser(row) : null;
}

export async function getPasswordHash(env: Env, email: string): Promise<{ user: AppUser; hash: string } | null> {
  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ? LIMIT 1").bind(email).first();
  if (!row) return null;
  return { user: rowToUser(row), hash: row.hashed_password as string };
}

export class EmailTakenError extends Error {}

export async function createUser(
  env: Env,
  email: string,
  hashedPassword: string,
  phoneNumber: string | null
): Promise<AppUser> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO users (id, email, hashed_password, is_active, trading_paused, created_at, phone_number) " +
        "VALUES (?, ?, ?, 1, 0, ?, ?)"
    )
      .bind(id, email, hashedPassword, createdAt, phoneNumber)
      .run();
  } catch (err) {
    const msg = String(err);
    if (msg.includes("UNIQUE constraint failed")) {
      throw new EmailTakenError("A user with this email already exists");
    }
    throw err;
  }
  return { id, email, is_active: true, trading_paused: false, phone_number: phoneNumber };
}
