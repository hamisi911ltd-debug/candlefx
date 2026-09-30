-- Simplification: drop the exchange-key/live-trading and buy-sell paper-trading
-- tables entirely, replaced by a simple "predict up or down" game using real
-- historical candles. No exchange account of any kind is involved anymore.

DROP TABLE IF EXISTS exchange_api_keys;
DROP TABLE IF EXISTS paper_trades;
DROP TABLE IF EXISTS paper_accounts;

CREATE TABLE prediction_accounts (
    user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    points_balance REAL NOT NULL DEFAULT 1000.0,
    created_at TEXT NOT NULL
);

CREATE TABLE predictions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    entry_time TEXT NOT NULL,
    entry_price REAL NOT NULL,
    direction TEXT NOT NULL,
    stake REAL NOT NULL,
    exit_time TEXT NOT NULL,
    exit_price REAL NOT NULL,
    correct INTEGER NOT NULL,
    payout REAL NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX ix_predictions_user_id ON predictions (user_id);
