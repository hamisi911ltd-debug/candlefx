import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { rateLimit } from "./ratelimit";
import {
  createAccessToken,
  createRefreshToken,
  decodeToken,
  hashPassword,
  verifyPassword,
} from "./security";
import { HttpError, type AppEnv, type Env, type User } from "./types";
import { invalid, nowIso, readJson, str, validatePhone } from "./util";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function rowToUser(r: any): User {
  return {
    id: r.id,
    email: r.email,
    hashed_password: r.hashed_password,
    is_active: !!r.is_active,
    trading_paused: !!r.trading_paused,
    created_at: r.created_at,
    phone_number: r.phone_number ?? null,
  };
}

const userOut = (u: User) => ({
  id: u.id,
  email: u.email,
  is_active: u.is_active,
  trading_paused: u.trading_paused,
  phone_number: u.phone_number,
});

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  const r = await db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(id).first();
  return r ? rowToUser(r) : null;
}

async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const r = await db.prepare("SELECT * FROM users WHERE email = ? LIMIT 1").bind(email).first();
  return r ? rowToUser(r) : null;
}

/** Requires a valid access token; puts the user on the context. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const unauthorized = new HttpError(401, "Could not validate credentials", { "WWW-Authenticate": "Bearer" });
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw unauthorized;
  let userId: string;
  try {
    userId = await decodeToken(c.env, token, "access");
  } catch {
    throw unauthorized;
  }
  const user = await getUserById(c.env.DB, userId);
  if (!user || !user.is_active) throw unauthorized;
  c.set("user", user);
  await next();
});

/** Cheaper variant for high-frequency read-only polling (chart/ticker): verifies the
 * signed access token but skips the per-request user lookup. */
export const requireToken = createMiddleware<AppEnv>(async (c, next) => {
  const unauthorized = new HttpError(401, "Could not validate credentials", { "WWW-Authenticate": "Bearer" });
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw unauthorized;
  try {
    await decodeToken(c.env, token, "access");
  } catch {
    throw unauthorized;
  }
  await next();
});

async function tokensFor(env: Env, user: User) {
  return {
    access_token: await createAccessToken(env, user.id),
    refresh_token: await createRefreshToken(env, user.id),
    token_type: "bearer",
    user: userOut(user),
  };
}

function validateRegistration(body: Record<string, any>) {
  const emailRaw = str(body.email, "email").trim();
  if (!EMAIL_RE.test(emailRaw)) throw invalid("email is not a valid email address");
  const at = emailRaw.lastIndexOf("@");
  const email = emailRaw.slice(0, at + 1) + emailRaw.slice(at + 1).toLowerCase();

  const password = str(body.password, "password");
  if (password.length < 10) throw invalid("Password must be at least 10 characters long");
  if (!/\d/.test(password)) throw invalid("Password must contain at least one digit");
  if (!/[A-Za-z]/.test(password)) throw invalid("Password must contain at least one letter");

  return { email, password, phone: validatePhone(body.phone_number) };
}

export const auth = new Hono<AppEnv>();

auth.post("/register", rateLimit("register", 5), async (c) => {
  const { email, password, phone } = validateRegistration(await readJson(c.req.raw));
  const user: User = {
    id: crypto.randomUUID(),
    email,
    hashed_password: await hashPassword(password),
    is_active: true,
    trading_paused: false,
    created_at: nowIso(),
    phone_number: phone,
  };
  try {
    await c.env.DB.prepare(
      "INSERT INTO users (id, email, hashed_password, is_active, trading_paused, created_at, phone_number) VALUES (?, ?, ?, 1, 0, ?, ?)",
    )
      .bind(user.id, user.email, user.hashed_password, user.created_at, user.phone_number)
      .run();
  } catch (e) {
    if (String(e).includes("UNIQUE constraint failed")) {
      throw new HttpError(409, "A user with this email already exists");
    }
    throw e;
  }
  return c.json(await tokensFor(c.env, user), 201);
});

auth.post("/login", rateLimit("login", 10), async (c) => {
  const body = await readJson(c.req.raw);
  const email = str(body.email, "email").trim();
  const password = str(body.password, "password");
  const fail = new HttpError(401, "Incorrect email or password");

  const user = await getUserByEmail(c.env.DB, email);
  if (!user || !user.is_active) throw fail;
  const { ok, needsRehash } = await verifyPassword(password, user.hashed_password);
  if (!ok) throw fail;
  if (needsRehash) {
    await c.env.DB.prepare("UPDATE users SET hashed_password = ? WHERE id = ?")
      .bind(await hashPassword(password), user.id)
      .run();
  }
  return c.json(await tokensFor(c.env, user));
});

auth.post("/refresh", rateLimit("refresh", 20), async (c) => {
  const body = await readJson(c.req.raw);
  const invalidRefresh = new HttpError(401, "Invalid refresh token");
  let userId: string;
  try {
    userId = await decodeToken(c.env, str(body.refresh_token, "refresh_token"), "refresh");
  } catch {
    throw invalidRefresh;
  }
  const user = await getUserById(c.env.DB, userId);
  if (!user || !user.is_active) throw invalidRefresh;
  return c.json({ access_token: await createAccessToken(c.env, user.id), token_type: "bearer" });
});

auth.get("/me", requireUser, (c) => c.json(userOut(c.get("user"))));

auth.patch("/me", requireUser, async (c) => {
  const body = await readJson(c.req.raw);
  const user = c.get("user");
  if (!("phone_number" in body)) throw invalid("Nothing to update");
  const phone = validatePhone(body.phone_number);
  await c.env.DB.prepare("UPDATE users SET phone_number = ? WHERE id = ?").bind(phone, user.id).run();
  return c.json(userOut({ ...user, phone_number: phone }));
});
