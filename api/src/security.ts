import { sign, verify } from "hono/jwt";
import { argon2id } from "@noble/hashes/argon2.js";
import type { Env } from "./types";

const ALG = "HS256";
const PBKDF2_ITERATIONS = 100_000; // Workers' WebCrypto cap for PBKDF2
const enc = new TextEncoder();

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => {
  // Accept unpadded base64 too (argon2 PHC strings omit padding).
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

/** Returns whether the password matches, and whether the stored hash should be
 * upgraded (legacy argon2 hashes from the old Python backend are re-hashed to PBKDF2
 * on next successful login, since native PBKDF2 is far cheaper on Workers). */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  try {
    if (stored.startsWith("pbkdf2$")) {
      const [, iters, salt, hash] = stored.split("$");
      const actual = await pbkdf2(password, unb64(salt), Number(iters));
      return { ok: timingSafeEqual(actual, unb64(hash)), needsRehash: false };
    }
    if (stored.startsWith("$argon2")) {
      // $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>
      const parts = stored.split("$");
      const params = Object.fromEntries(parts[3].split(",").map((kv) => kv.split("=")));
      const expected = unb64(parts[5]);
      const actual = argon2id(enc.encode(password), unb64(parts[4]), {
        t: Number(params.t),
        m: Number(params.m),
        p: Number(params.p),
        dkLen: expected.length,
      });
      const ok = timingSafeEqual(actual, expected);
      return { ok, needsRehash: ok };
    }
  } catch {
    // fall through to failure
  }
  return { ok: false, needsRehash: false };
}

export type TokenType = "access" | "refresh";

async function createToken(env: Env, sub: string, type: TokenType, ttlSeconds: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub, type, iat: now, exp: now + ttlSeconds, jti: crypto.randomUUID() }, env.JWT_SECRET_KEY, ALG);
}

export const createAccessToken = (env: Env, userId: string) =>
  createToken(env, userId, "access", Number(env.ACCESS_TOKEN_EXPIRE_MINUTES || 15) * 60);
export const createRefreshToken = (env: Env, userId: string) =>
  createToken(env, userId, "refresh", Number(env.REFRESH_TOKEN_EXPIRE_DAYS || 30) * 86400);

/** Returns the subject (user id) or throws. */
export async function decodeToken(env: Env, token: string, expected: TokenType): Promise<string> {
  const payload = await verify(token, env.JWT_SECRET_KEY, ALG);
  if (payload.type !== expected) throw new Error("Unexpected token type");
  if (!payload.sub || typeof payload.sub !== "string") throw new Error("Missing subject");
  return payload.sub;
}
