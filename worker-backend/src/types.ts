export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  PAYHERO_API_USERNAME?: string;
  PAYHERO_API_PASSWORD?: string;
  PAYHERO_ACCOUNT_ID?: string;
  PAYHERO_CHANNEL_ID?: string;
  PAYHERO_CALLBACK_BASE_URL?: string;
  CORS_ORIGINS?: string;
}

export interface AppUser {
  id: string;
  email: string;
  is_active: boolean;
  trading_paused: boolean;
  phone_number: string | null;
}
