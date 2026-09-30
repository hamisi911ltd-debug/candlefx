# Crypto Trading Bot Platform

A multi-user platform for connecting your own exchange account and running automated
trading strategies. The platform **never holds user funds** - you provide exchange API
keys (trading permission only, withdrawal disabled) and all orders are placed directly
against your own exchange account.

> **Status: MVP under active development.** Built in phases - see `Phase` sections below.
> Live trading (Phase 4) is disabled by default and requires explicit opt-in per bot.

## Risk disclaimer

Automated trading carries substantial risk of loss. Strategies included here are simple
educational examples (moving average crossover, RSI), not investment advice. Past
backtest/paper-trading performance does not guarantee future results. Only connect
exchange API keys with trading permission (never withdrawal permission), and only trade
funds you can afford to lose.

## Tech stack

- **Backend**: Python 3.12, FastAPI, SQLAlchemy + Alembic, PostgreSQL
- **Exchange connectivity**: [ccxt](https://github.com/ccxt/ccxt) (Binance Spot + Binance Spot Testnet to start)
- **Background execution**: a dedicated `worker` process using APScheduler (see "Why APScheduler, not Celery/RQ" below)
- **Data / backtesting**: pandas, numpy
- **Frontend**: Next.js (TypeScript, App Router) + Tailwind CSS, charts via lightweight-charts / Recharts
- **Infra**: Docker Compose (db, redis, backend, worker, frontend)

## Why APScheduler, not Celery/RQ?

Bot execution is fundamentally periodic - "evaluate this bot's strategy every N minutes" -
not event-driven one-off work. APScheduler's interval/cron triggers map directly onto that,
so the MVP worker uses APScheduler with Redis-backed locking (to keep multiple worker
replicas from double-running the same bot) instead of standing up a full broker-backed task
queue for something that doesn't need arbitrary task dispatch. If we later need retries,
distributed workers, or ad-hoc one-off tasks (e.g. a queued backtest job), Celery or RQ can
be introduced without touching bot/strategy logic, since the worker's scheduling layer is
isolated from the business logic in `backend/app/services`.

## Project structure

```
crypto-bot-platform/
├── docker-compose.yml
├── .env.example
├── backend/         FastAPI app, Alembic migrations, tests
├── worker/           Background bot-execution process
└── frontend/           Next.js app
```

See `backend/app/` for the module breakdown (api / core / exchanges / strategies /
backtest / services / risk).

## Getting started (local dev via Docker)

1. Copy the example env file and fill in secrets:
   ```
   cp .env.example .env
   ```
   Generate real values for `JWT_SECRET_KEY` and `MASTER_ENCRYPTION_KEY`:
   ```
   python -c "import secrets; print(secrets.token_urlsafe(64))"
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```
2. Start everything:
   ```
   docker compose up --build
   ```
   This runs Postgres, Redis, the FastAPI backend (with Alembic migrations applied
   automatically on startup), the worker process, and the Next.js frontend.
3. Backend API docs: http://localhost:8000/docs
4. Frontend: http://localhost:3000

## Getting Binance Testnet API keys

1. Go to https://testnet.binance.vision/ and sign in with a GitHub account.
2. Generate a HMAC_SHA256 API key/secret pair. Testnet keys have no real value and are
   safe to use for development.
3. In the app, when adding an exchange key, leave "Testnet" checked and paste the
   testnet key/secret. The platform will verify the key against Binance's testnet before
   saving it, and will reject any key that reports withdrawal permission enabled.

## Running backend tests

```
cd backend
python -m venv .venv && .venv/Scripts/activate   # or source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
pytest
```

## Adding a new strategy (Phase 2+)

Strategies live in `backend/app/strategies/`. Each strategy subclasses
`app.strategies.base.Strategy`, declares its configurable parameters via a Pydantic
model, and implements `generate_signal(candles: pd.DataFrame) -> Signal`. Register the
new strategy in `app.strategies.registry` so it becomes selectable from the UI/backtester
without any other code changes.

## Security notes

- Passwords are hashed with argon2; JWT access (short-lived) + refresh (long-lived) tokens.
- Exchange API keys are encrypted at rest with Fernet using `MASTER_ENCRYPTION_KEY`; the
  plaintext secret is only ever decrypted in-memory, never logged, and never returned in
  full by the API (only a masked suffix is shown).
- Keys reporting withdrawal permission are rejected at add-time.
- Auth endpoints are rate-limited; all request bodies are validated via Pydantic.

## Roadmap (design kept open, not yet built)

- Subscription plans (free: 1 paper bot; paid: more bots + live trading), payments via
  M-Pesa Daraja API and card.
- Additional exchanges/markets: more ccxt exchanges, Alpaca (stocks), MT5/OANDA (forex).
- Strategy marketplace and copy trading.
- Admin panel (global kill switch, user management).
