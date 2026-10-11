import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth, requireUser } from "./auth";
import { ALLOWED_TIMEFRAMES, fetchOhlcv, isForex } from "./market";
import { payhero } from "./payhero";
import { admin, advanceWithdrawals, wallet } from "./wallet";
import { prediction, settleOverdueBets } from "./prediction";
import { purgeExpiredRateLimits } from "./ratelimit";
import { HttpError, type AppEnv, type Env } from "./types";
import { bad } from "./util";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  const origins = (c.env.CORS_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  return cors({
    origin: (origin) => (origins.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    credentials: true,
  })(c, next);
});

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/api/auth", auth);
app.route("/api/predict", prediction);
app.route("/api/payhero", payhero);
app.route("/api/wallet", wallet);
app.route("/api/admin", admin);

app.get("/api/market/ohlcv", requireUser, async (c) => {
  const symbol = (c.req.query("symbol") ?? "").toUpperCase();
  let timeframe = c.req.query("timeframe") ?? "1h";
  const limit = Number(c.req.query("limit") ?? 200);
  if (symbol.length < 3 || symbol.length > 20) throw new HttpError(422, "symbol must be 3-20 characters");
  if (!Number.isInteger(limit) || limit < 10 || limit > 1000) throw new HttpError(422, "limit must be between 10 and 1000");
  if (!ALLOWED_TIMEFRAMES.includes(timeframe)) throw bad(`timeframe must be one of ${JSON.stringify([...ALLOWED_TIMEFRAMES].sort())}`);
  // Forex data only has one rate per business day, so any finer request is served daily.
  if (isForex(symbol) && timeframe !== "1d") timeframe = "1d";
  return c.json({ symbol, timeframe, bars: await fetchOhlcv(symbol, timeframe, limit) });
});

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ detail: err.detail }, err.status as any, err.headers);
  }
  console.error("Unhandled error:", err);
  return c.json({ detail: "Internal server error" }, 500);
});

app.notFound((c) => c.json({ detail: "Not Found" }, 404));

export default {
  fetch: app.fetch,
  // Cron Trigger (replaces the placeholder APScheduler worker): pay out abandoned bets and
  // clear expired rate-limit rows.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([settleOverdueBets(env), advanceWithdrawals(env), purgeExpiredRateLimits(env.DB)]));
  },
};
