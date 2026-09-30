import secrets
import time
import uuid
from datetime import datetime, timezone

from app.db_d1 import D1Client
from app.models.prediction import Prediction, PredictionAccount
from app.models.user import User
from app.schemas.market import OhlcvBar
from app.schemas.prediction import PredictionAccountOut, ResolveOut, ResolveRequest, RoundOut
from app.services import synthetic_market as market
from app.sql_utils import sql_quote

STARTING_POINTS = 1000.0
VISIBLE_CANDLES = 60
# Binary-option-style payout: a correct guess returns this fraction of the stake as
# profit (stake itself is also returned), a wrong guess forfeits the full stake.
PAYOUT_RATE = 0.85
MAX_DEPOSIT = 100_000.0


class PredictionError(Exception):
    pass


class RoundNotReadyError(Exception):
    def __init__(self, seconds_remaining: float):
        self.seconds_remaining = seconds_remaining
        super().__init__(f"Not decided yet - {seconds_remaining:.1f}s left on this candle.")


def _candle_to_bar(c: dict) -> OhlcvBar:
    return OhlcvBar(timestamp=c["timestamp"], open=c["open"], high=c["high"], low=c["low"], close=c["close"], volume=c["volume"])


def ensure_account(db: D1Client, user_id: str) -> PredictionAccount:
    """Public: also used by payhero_service to guarantee a deposit's target
    account row exists before crediting real_balance_kes, since a user can deposit
    before ever having played the game."""
    rows = db.execute(f"SELECT * FROM prediction_accounts WHERE user_id = {sql_quote(user_id)} LIMIT 1")
    if rows:
        return PredictionAccount.from_row(rows[0])

    account = PredictionAccount(
        user_id=user_id, points_balance=STARTING_POINTS, real_balance_kes=0.0,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    db.execute(
        "INSERT INTO prediction_accounts (user_id, points_balance, real_balance_kes, created_at) "
        f"VALUES ({sql_quote(account.user_id)}, {sql_quote(account.points_balance)}, "
        f"{sql_quote(account.real_balance_kes)}, {sql_quote(account.created_at)})"
    )
    return account


def _ensure_account(db: D1Client, user: User) -> PredictionAccount:
    return ensure_account(db, user.id)


def get_round(db: D1Client, user: User, symbol: str) -> RoundOut:
    account = _ensure_account(db, user)

    if symbol not in market.SYMBOL_PROFILES:
        raise PredictionError(f"Unknown symbol '{symbol}'. Choose one of {sorted(market.SYMBOL_PROFILES)}")

    seed = secrets.token_hex(8)
    start_time = time.time()
    entry_tick_index = -1  # the tick immediately before "now" - already closed by construction

    candles = market.get_candles(seed, symbol, start_time, VISIBLE_CANDLES, end_tick_index=entry_tick_index)
    entry = candles[-1]

    return RoundOut(
        symbol=symbol,
        seed=seed,
        start_time=start_time,
        tick_seconds=market.TICK_SECONDS,
        bars=[_candle_to_bar(c) for c in candles],
        entry_tick_index=entry_tick_index,
        entry_time=entry["timestamp"],
        entry_price=entry["close"],
        points_balance=account.points_balance,
        real_balance_kes=account.real_balance_kes,
        payout_rate=PAYOUT_RATE,
        server_time=time.time(),
    )


def get_live_bars(symbol: str, seed: str, start_time: float, count: int = VISIBLE_CANDLES) -> tuple[list[dict], int]:
    latest_closed = market.current_tick_index(start_time) - 1
    candles = market.get_candles(seed, symbol, start_time, count, end_tick_index=latest_closed)
    return candles, latest_closed


def resolve_round(db: D1Client, user: User, payload: ResolveRequest) -> ResolveOut:
    # Check timing and validate input BEFORE touching the database: a D1 round trip
    # alone can take longer than one tick, so doing the account lookup first would
    # make "not ready yet" spuriously flip to "ready" depending on DB latency alone.
    if payload.symbol not in market.SYMBOL_PROFILES:
        raise PredictionError(f"Unknown symbol '{payload.symbol}'")

    target_tick = payload.entry_tick_index + 1
    if not market.tick_is_closed(payload.start_time, target_tick):
        raise RoundNotReadyError(market.seconds_until_closed(payload.start_time, target_tick))

    account = _ensure_account(db, user)
    is_real = payload.currency == "kes"
    current_balance = account.real_balance_kes if is_real else account.points_balance
    if payload.stake > current_balance:
        label = "KES" if is_real else "points"
        raise PredictionError(
            f"Insufficient {label} balance: stake is {payload.stake:.2f}, you have {current_balance:.2f}"
        )

    entry_candle = market.get_candle(payload.seed, payload.symbol, payload.start_time, payload.entry_tick_index)
    exit_candle = market.get_candle(payload.seed, payload.symbol, payload.start_time, target_tick)

    entry_price = entry_candle["close"]
    # Judge the outcome the same way the chart renders the candle's own color
    # (its close vs its own open), not against a separately-tracked entry price -
    # those two references are normally identical since candles chain close-to-open,
    # but keeping the comparison anchored to the revealed candle itself guarantees
    # the result text can never contradict what the user sees drawn on the chart.
    actual_direction = "up" if exit_candle["close"] >= exit_candle["open"] else "down"
    correct = payload.direction == actual_direction
    payout = payload.stake * PAYOUT_RATE if correct else -payload.stake
    new_balance = current_balance + payout
    new_points_balance = new_balance if not is_real else account.points_balance
    new_real_balance = new_balance if is_real else account.real_balance_kes

    prediction = Prediction(
        id=str(uuid.uuid4()),
        user_id=user.id,
        symbol=payload.symbol,
        timeframe="tick",
        entry_time=entry_candle["timestamp"],
        entry_price=entry_price,
        direction=payload.direction,
        stake=payload.stake,
        currency=payload.currency,
        exit_time=exit_candle["timestamp"],
        exit_price=exit_candle["close"],
        correct=correct,
        payout=payout,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    db.execute(
        "INSERT INTO predictions (id, user_id, symbol, timeframe, entry_time, entry_price, direction, "
        "stake, currency, exit_time, exit_price, correct, payout, created_at) VALUES ("
        f"{sql_quote(prediction.id)}, {sql_quote(prediction.user_id)}, {sql_quote(prediction.symbol)}, "
        f"{sql_quote(prediction.timeframe)}, {sql_quote(prediction.entry_time)}, {sql_quote(prediction.entry_price)}, "
        f"{sql_quote(prediction.direction)}, {sql_quote(prediction.stake)}, {sql_quote(prediction.currency)}, "
        f"{sql_quote(prediction.exit_time)}, {sql_quote(prediction.exit_price)}, {sql_quote(prediction.correct)}, "
        f"{sql_quote(prediction.payout)}, {sql_quote(prediction.created_at)})"
    )
    db.execute(
        f"UPDATE prediction_accounts SET points_balance = {sql_quote(new_points_balance)}, "
        f"real_balance_kes = {sql_quote(new_real_balance)} WHERE user_id = {sql_quote(user.id)}"
    )

    return ResolveOut(
        correct=correct,
        actual_direction=actual_direction,
        exit_price=exit_candle["close"],
        exit_bar=_candle_to_bar(exit_candle),
        payout=payout,
        currency=payload.currency,
        points_balance=new_points_balance,
        real_balance_kes=new_real_balance,
        next_entry_tick_index=target_tick,
        next_entry_price=exit_candle["close"],
    )


def _account_stats(db: D1Client, user: User, points_balance: float, real_balance_kes: float) -> PredictionAccountOut:
    rows = db.execute(f"SELECT correct FROM predictions WHERE user_id = {sql_quote(user.id)}")
    total = len(rows)
    correct = sum(1 for r in rows if r["correct"])
    return PredictionAccountOut(
        points_balance=points_balance, real_balance_kes=real_balance_kes,
        total_predictions=total, correct_predictions=correct, payout_rate=PAYOUT_RATE,
    )


def get_account(db: D1Client, user: User) -> PredictionAccountOut:
    account = _ensure_account(db, user)
    return _account_stats(db, user, account.points_balance, account.real_balance_kes)


def deposit(db: D1Client, user: User, amount: float) -> PredictionAccountOut:
    """Tops up the virtual points balance. Not a real payment of any kind - there is
    no money involved anywhere in this app, this just adds to a number in the
    database so play can continue after running out of points."""
    if amount <= 0:
        raise PredictionError("Deposit amount must be positive")
    if amount > MAX_DEPOSIT:
        raise PredictionError(f"Deposit amount cannot exceed {MAX_DEPOSIT:.0f} points")

    account = _ensure_account(db, user)
    new_balance = account.points_balance + amount
    db.execute(
        f"UPDATE prediction_accounts SET points_balance = {sql_quote(new_balance)} "
        f"WHERE user_id = {sql_quote(user.id)}"
    )
    return _account_stats(db, user, new_balance, account.real_balance_kes)


def get_history(db: D1Client, user: User, limit: int = 50) -> list[Prediction]:
    rows = db.execute(
        f"SELECT * FROM predictions WHERE user_id = {sql_quote(user.id)} "
        f"ORDER BY created_at DESC LIMIT {int(limit)}"
    )
    return [Prediction.from_row(r) for r in rows]


def reset_account(db: D1Client, user: User) -> PredictionAccountOut:
    """Resets the free-practice points balance and wipes only points-currency
    history. Deliberately never touches real_balance_kes or 'kes'-currency
    predictions - that's real money and a real transaction record, not something a
    fresh-start button should be able to erase."""
    account = _ensure_account(db, user)
    db.execute(
        f"DELETE FROM predictions WHERE user_id = {sql_quote(user.id)} AND currency = 'points'"
    )
    db.execute(
        f"UPDATE prediction_accounts SET points_balance = {sql_quote(STARTING_POINTS)} "
        f"WHERE user_id = {sql_quote(user.id)}"
    )
    return _account_stats(db, user, STARTING_POINTS, account.real_balance_kes)
