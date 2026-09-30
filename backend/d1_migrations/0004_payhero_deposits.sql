-- Real-money deposit ledger via PayHero (M-Pesa STK push). Deliberately kept
-- separate from prediction_accounts.points_balance (the virtual game wallet) -
-- crediting real KES into actual wagers requires withdrawal handling, KYC, and
-- responsible-gambling controls that do not exist yet; this table only tracks
-- confirmed deposit transactions.

CREATE TABLE payhero_deposits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    external_reference TEXT NOT NULL UNIQUE,
    checkout_request_id TEXT,
    phone_number TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | success | failed
    mpesa_receipt_number TEXT,
    result_desc TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX ix_payhero_deposits_user_id ON payhero_deposits (user_id);
CREATE INDEX ix_payhero_deposits_external_reference ON payhero_deposits (external_reference);
