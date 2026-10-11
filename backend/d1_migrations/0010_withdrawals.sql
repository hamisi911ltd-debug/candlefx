-- Scheduled withdrawals: requested any time, paid out in batches every 3 working days.
-- The amount is escrowed (deducted from real_balance_kes) when requested and refunded
-- if the request is cancelled or rejected.
CREATE TABLE IF NOT EXISTS withdrawals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    phone_number TEXT NOT NULL,
    status TEXT NOT NULL,            -- scheduled | processing | paid | rejected | cancelled
    cutoff_at TEXT NOT NULL,         -- last moment the request can still be cancelled
    scheduled_for TEXT NOT NULL,     -- payout instant of the batch this request belongs to
    payout_reference TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_withdrawals_user ON withdrawals (user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_withdrawals_status ON withdrawals (status, scheduled_for);

-- Audit trail: every status change, with a timestamp, for tracking and tracing.
CREATE TABLE IF NOT EXISTS withdrawal_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    withdrawal_id TEXT NOT NULL REFERENCES withdrawals (id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    note TEXT,
    at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_withdrawal_events_w ON withdrawal_events (withdrawal_id, id);
