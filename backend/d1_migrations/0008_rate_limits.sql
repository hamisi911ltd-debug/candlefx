-- Fixed-window rate limiting for the Cloudflare Worker API (replaces Redis/slowapi).
CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_rate_limits_expires_at ON rate_limits (expires_at);
