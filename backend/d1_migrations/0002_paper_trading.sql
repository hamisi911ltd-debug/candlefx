-- Paper trading: a virtual balance per user, funded with fake starting money,
-- and a trade ledger. No exchange account or API key involved - trades execute
-- against real live market prices but settle against this virtual balance only.

CREATE TABLE paper_accounts (
    user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    cash_balance REAL NOT NULL DEFAULT 10000.0,
    created_at TEXT NOT NULL
);

CREATE TABLE paper_trades (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    amount REAL NOT NULL,
    price REAL NOT NULL,
    quote_value REAL NOT NULL,
    executed_at TEXT NOT NULL
);

CREATE INDEX ix_paper_trades_user_id ON paper_trades (user_id);
