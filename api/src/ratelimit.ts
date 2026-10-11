import type { MiddlewareHandler } from "hono";
import { HttpError, type AppEnv } from "./types";

/** Fixed-window limiter backed by D1 (replaces slowapi + Redis). One upsert per hit. */
export function rateLimit(name: string, max: number, windowSeconds = 60): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const now = Math.floor(Date.now() / 1000);
    const window = Math.floor(now / windowSeconds);
    const key = `${name}:${ip}:${window}`;
    const row = await c.env.DB.prepare(
      `INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
      .bind(key, (window + 1) * windowSeconds + 60)
      .first<{ count: number }>();
    if (row && row.count > max) {
      throw new HttpError(429, `Rate limit exceeded: ${max} per ${windowSeconds} seconds`, {
        "Retry-After": String((window + 1) * windowSeconds - now),
      });
    }
    await next();
  };
}

export async function purgeExpiredRateLimits(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(Math.floor(Date.now() / 1000)).run();
}
