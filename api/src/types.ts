export type Env = {
  DB: D1Database;
  JWT_SECRET_KEY: string;
  CORS_ORIGINS: string;
  ACCESS_TOKEN_EXPIRE_MINUTES: string;
  REFRESH_TOKEN_EXPIRE_DAYS: string;
  PAYHERO_API_USERNAME?: string;
  PAYHERO_API_PASSWORD?: string;
  PAYHERO_CHANNEL_ID?: string;
  PAYHERO_CALLBACK_BASE_URL?: string;
  ADMIN_API_KEY?: string;
};

export type User = {
  id: string;
  email: string;
  hashed_password: string;
  is_active: boolean;
  trading_paused: boolean;
  created_at: string;
  phone_number: string | null;
};

export type AppVars = { user: User };
export type AppEnv = { Bindings: Env; Variables: AppVars };

export class HttpError extends Error {
  constructor(public status: number, public detail: unknown, public headers?: Record<string, string>) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
}
