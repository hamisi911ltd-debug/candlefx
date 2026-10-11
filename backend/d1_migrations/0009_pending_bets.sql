-- Escrowed, server-locked bets. A bet is locked (and its stake deducted) the moment the
-- server first receives it, so the outcome can never be peeked at before committing.
-- target_tick: simulated markets = tick index; real crypto = opening time (ms) of the
-- 1-minute candle the bet settles on.
CREATE TABLE IF NOT EXISTS pending_bets (
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    kind TEXT NOT NULL,
    entry_tick INTEGER NOT NULL,
    target_tick INTEGER NOT NULL,
    entry_price REAL NOT NULL,
    direction TEXT NOT NULL,
    stake REAL NOT NULL,
    currency TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, symbol)
);

CREATE INDEX IF NOT EXISTS ix_pending_bets_created_at ON pending_bets (created_at);
