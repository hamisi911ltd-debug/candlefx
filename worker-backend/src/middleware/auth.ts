import type { MiddlewareHandler } from "hono";
import type { Env, AppUser } from "../types";
import { verifyToken } from "../auth/jwt";
import { getUserById } from "../auth/repo";

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: { user: AppUser } }> = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ detail: "Could not validate credentials" }, 401);
  }
  const token = authHeader.slice("Bearer ".length);

  try {
    const userId = await verifyToken(c.env.JWT_SECRET, token, "access");
    const user = await getUserById(c.env, userId);
    if (!user || !user.is_active) {
      return c.json({ detail: "Could not validate credentials" }, 401);
    }
    c.set("user", user);
  } catch {
    return c.json({ detail: "Could not validate credentials" }, 401);
  }

  await next();
};
