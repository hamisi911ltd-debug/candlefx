import { Hono } from "hono";
import type { Env, AppUser } from "../types";
import { requireAuth } from "../middleware/auth";
import { listDeposits } from "./repo";
import { checkStatus, handleCallback, initiateDeposit, PayHeroError, PayHeroNotConfigured, type CallbackPayload } from "./service";

export const payheroRoutes = new Hono<{ Bindings: Env; Variables: { user: AppUser } }>();

payheroRoutes.post("/deposit", requireAuth, async (c) => {
  type Body = { amount?: number; phone_number?: string };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const amount = body.amount ?? 0;
  const phone = (body.phone_number || "").trim();
  if (amount <= 0) return c.json({ detail: "amount must be positive" }, 422);
  const digits = phone.replace("+", "");
  if (!/^\d+$/.test(digits) || digits.length < 9) return c.json({ detail: "phone_number must be a valid M-Pesa number" }, 422);

  const user = c.get("user");
  try {
    const deposit = await initiateDeposit(c.env, user.id, amount, phone);
    return c.json({ external_reference: deposit.external_reference, checkout_request_id: deposit.checkout_request_id, status: deposit.status }, 201);
  } catch (err) {
    if (err instanceof PayHeroNotConfigured) return c.json({ detail: err.message }, 503);
    if (err instanceof PayHeroError) return c.json({ detail: err.message }, 502);
    throw err;
  }
});

payheroRoutes.get("/deposit/:reference", requireAuth, async (c) => {
  const user = c.get("user");
  try {
    const deposit = await checkStatus(c.env, user.id, c.req.param("reference"));
    return c.json(deposit);
  } catch (err) {
    if (err instanceof PayHeroError) return c.json({ detail: err.message }, 404);
    throw err;
  }
});

payheroRoutes.get("/deposits", requireAuth, async (c) => {
  const user = c.get("user");
  return c.json(await listDeposits(c.env, user.id));
});

// No auth - PayHero calls this directly. Matched purely by external_reference.
payheroRoutes.post("/callback", async (c) => {
  const payload = await c.req.json<CallbackPayload>().catch(() => null);
  if (!payload) return c.json({ received: true, matched: false });
  try {
    const deposit = await handleCallback(c.env, payload);
    return c.json({ received: true, matched: true, status: deposit.status });
  } catch {
    // Still 200 - PayHero retries on non-2xx, and retrying won't fix a genuinely
    // unmatched reference.
    return c.json({ received: true, matched: false });
  }
});
