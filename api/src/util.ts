import { HttpError } from "./types";

export async function readJson(req: Request): Promise<Record<string, any>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, any>;
  } catch {
    // fall through
  }
  throw new HttpError(422, "Request body must be a JSON object");
}

export const bad = (msg: string) => new HttpError(400, msg);
export const invalid = (msg: string) => new HttpError(422, msg);

export function num(v: unknown, field: string): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw invalid(`${field} must be a number`);
  return n;
}

export function str(v: unknown, field: string): string {
  if (typeof v !== "string") throw invalid(`${field} must be a string`);
  return v;
}

export function validatePhone(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = str(v, "phone_number").trim();
  if (!s) return null;
  const digits = s.replace("+", "");
  if (!/^\d+$/.test(digits) || digits.length < 9) {
    throw invalid("phone_number must be a valid M-Pesa number, e.g. 0712345678");
  }
  return s;
}

export const nowIso = () => new Date().toISOString();
