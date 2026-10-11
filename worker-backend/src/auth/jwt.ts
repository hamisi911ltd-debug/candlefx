import { SignJWT, jwtVerify } from "jose";

const ACCESS_EXPIRES = "15m";
const REFRESH_EXPIRES = "30d";

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function createAccessToken(secret: string, userId: string): Promise<string> {
  return new SignJWT({ type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_EXPIRES)
    .setJti(crypto.randomUUID())
    .sign(secretKey(secret));
}

export async function createRefreshToken(secret: string, userId: string): Promise<string> {
  return new SignJWT({ type: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(REFRESH_EXPIRES)
    .setJti(crypto.randomUUID())
    .sign(secretKey(secret));
}

export async function verifyToken(secret: string, token: string, expectedType: "access" | "refresh"): Promise<string> {
  const { payload } = await jwtVerify(token, secretKey(secret));
  if (payload.type !== expectedType) throw new Error("Unexpected token type");
  if (!payload.sub) throw new Error("Missing subject");
  return payload.sub;
}
