-- Initial schema for Cloudflare D1 (SQLite dialect).
-- UUIDs and datetimes are stored as TEXT (ISO 8601 for datetimes);
-- booleans are stored as INTEGER (0/1), SQLite convention.

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    hashed_password TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    trading_paused INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX ix_users_email ON users (email);

CREATE TABLE exchange_api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    exchange TEXT NOT NULL,
    label TEXT NOT NULL,
    is_testnet INTEGER NOT NULL DEFAULT 1,
    encrypted_api_key TEXT NOT NULL,
    encrypted_api_secret TEXT NOT NULL,
    key_suffix TEXT NOT NULL,
    can_withdraw INTEGER NOT NULL DEFAULT 0,
    is_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX ix_exchange_api_keys_user_id ON exchange_api_keys (user_id);
