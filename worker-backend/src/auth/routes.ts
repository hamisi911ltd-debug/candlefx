import { Hono } from "hono";
import type { Env } from "../types";
import { hashPassword, verifyPassword } from "./password";
import { createAccessToken, createRefreshToken, verifyToken } from "./jwt";
import { createUser, EmailTakenError, getPasswordHash, getUserById } from "./repo";
import { requireAuth } from "../middleware/auth";

export const authRoutes = new Hono<{ Bindings: Env }>();

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters long";
  if (!/[0-9]/.test(password)) return "Password must contain at least one digit";
  if (!/[a-zA-Z]/.test(password)) return "Password must contain at least one letter";
  return null;
}

async function tokensFor(env: Env, user: { id: string; email: string; is_active: boolean; trading_paused: boolean; phone_number: string | null }) {
  return {
    access_token: await createAccessToken(env.JWT_SECRET, user.id),
    refresh_token: await createRefreshToken(env.JWT_SECRET, user.id),
    token_type: "bearer",
    user: {
      id: user.id,
      email: user.email,
      is_active: user.is_active,
      trading_paused: user.trading_paused,
    },
  };
}

authRoutes.post("/register", async (c) => {
  type Body = { email?: string; password?: string; phone_number?: string };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const phoneNumber = body.phone_number?.trim() || null;

  if (!isValidEmail(email)) return c.json({ detail: "Invalid email address" }, 422);
  const pwError = isValidPassword(password);
  if (pwError) return c.json({ detail: pwError }, 422);
  if (phoneNumber && !/^\+?[0-9]{9,15}$/.test(phoneNumber)) {
    return c.json({ detail: "Invalid phone number" }, 422);
  }

  const hashed = await hashPassword(password);
  try {
    const user = await createUser(c.env, email, hashed, phoneNumber);
    return c.json(await tokensFor(c.env, user), 201);
  } catch (err) {
    if (err instanceof EmailTakenError) return c.json({ detail: err.message }, 409);
    throw err;
  }
});

authRoutes.post("/login", async (c) => {
  type Body = { email?: string; password?: string };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  const found = await getPasswordHash(c.env, email);
  if (!found || !found.user.is_active || !(await verifyPassword(password, found.hash))) {
    return c.json({ detail: "Incorrect email or password" }, 401);
  }
  return c.json(await tokensFor(c.env, found.user));
});

authRoutes.post("/refresh", async (c) => {
  type Body = { refresh_token?: string };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  if (!body.refresh_token) return c.json({ detail: "Invalid refresh token" }, 401);

  try {
    const userId = await verifyToken(c.env.JWT_SECRET, body.refresh_token, "refresh");
    const user = await getUserById(c.env, userId);
    if (!user || !user.is_active) return c.json({ detail: "Invalid refresh token" }, 401);
    return c.json({ access_token: await createAccessToken(c.env.JWT_SECRET, user.id), token_type: "bearer" });
  } catch {
    return c.json({ detail: "Invalid refresh token" }, 401);
  }
});

authRoutes.get("/me", requireAuth, async (c) => {
  const user = c.get("user");
  return c.json({ id: user.id, email: user.email, is_active: user.is_active, trading_paused: user.trading_paused });
});
