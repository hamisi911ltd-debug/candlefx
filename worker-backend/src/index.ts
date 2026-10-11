import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { authRoutes } from "./auth/routes";
import { predictionRoutes } from "./prediction/routes";
import { payheroRoutes } from "./payhero/routes";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const origins = (c.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return cors({
    origin: origins.length > 0 ? origins : "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })(c, next);
});

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/api/auth", authRoutes);
app.route("/api/predict", predictionRoutes);
app.route("/api/payhero", payheroRoutes);

export default app;
