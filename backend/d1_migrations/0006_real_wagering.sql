-- Confirmed PayHero deposits now fund a real, separate KES balance that the
-- prediction game can wager against - distinct from points_balance, which stays
-- as a free-practice balance for anyone who hasn't deposited real money.

ALTER TABLE prediction_accounts ADD COLUMN real_balance_kes REAL NOT NULL DEFAULT 0;
ALTER TABLE predictions ADD COLUMN currency TEXT NOT NULL DEFAULT 'points';
