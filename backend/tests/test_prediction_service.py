import time
from unittest.mock import MagicMock

import pytest

from app.models.user import User
from app.schemas.prediction import ResolveRequest
from app.services import prediction_service as svc
from app.services import synthetic_market as market


@pytest.fixture
def user():
    return User(
        id="user-1", email="t@example.com", hashed_password="h",
        is_active=True, trading_paused=False, created_at="2026-01-01",
    )


def _db_no_account():
    db = MagicMock()
    db.execute.return_value = []
    return db


def _db_with_balance(balance):
    db = MagicMock()

    def execute(sql, *a, **kw):
        if "SELECT * FROM prediction_accounts" in sql:
            return [{"user_id": "user-1", "points_balance": balance, "created_at": "2026-01-01"}]
        if "SELECT correct FROM predictions" in sql:
            return []
        return []

    db.execute.side_effect = execute
    return db


def test_get_round_returns_visible_window(user):
    db = _db_no_account()
    round_out = svc.get_round(db, user, "SIM-CALM")

    assert len(round_out.bars) == svc.VISIBLE_CANDLES
    assert round_out.entry_price == round_out.bars[-1].close
    assert round_out.points_balance == svc.STARTING_POINTS
    assert round_out.entry_tick_index == -1


def test_get_round_rejects_unknown_symbol(user):
    db = _db_no_account()
    with pytest.raises(svc.PredictionError, match="Unknown symbol"):
        svc.get_round(db, user, "NOT-A-SYMBOL")


def test_resolve_before_tick_closes_raises_not_ready(user):
    db = _db_with_balance(1000.0)
    payload = ResolveRequest(
        symbol="SIM-CALM", seed="fixed-seed", start_time=time.time(),
        entry_tick_index=-1, direction="up", stake=10,
    )
    # entry_tick_index=-1 -> target tick 0, which closes TICK_SECONDS from "now" (start_time == now)
    with pytest.raises(svc.RoundNotReadyError):
        svc.resolve_round(db, user, payload)


def test_resolve_after_tick_closes_scores_correctly(user):
    db = _db_with_balance(1000.0)
    seed = "fixed-seed"
    symbol = "SIM-CALM"
    start_time = time.time() - 100 * market.TICK_SECONDS  # long past, both ticks are closed

    entry_candle = market.get_candle(seed, symbol, start_time, -1)
    exit_candle = market.get_candle(seed, symbol, start_time, 0)
    expected_direction = "up" if exit_candle["close"] >= entry_candle["close"] else "down"

    payload = ResolveRequest(
        symbol=symbol, seed=seed, start_time=start_time,
        entry_tick_index=-1, direction=expected_direction, stake=25,
    )
    result = svc.resolve_round(db, user, payload)

    assert result.correct is True
    assert result.actual_direction == expected_direction
    assert result.payout == 25 * svc.PAYOUT_RATE
    assert result.points_balance == 1000.0 + 25 * svc.PAYOUT_RATE
    assert result.next_entry_tick_index == 0


def test_resolve_wrong_guess_deducts_points(user):
    db = _db_with_balance(1000.0)
    seed = "fixed-seed"
    symbol = "SIM-CALM"
    start_time = time.time() - 100 * market.TICK_SECONDS

    entry_candle = market.get_candle(seed, symbol, start_time, -1)
    exit_candle = market.get_candle(seed, symbol, start_time, 0)
    actual_direction = "up" if exit_candle["close"] >= entry_candle["close"] else "down"
    wrong_direction = "down" if actual_direction == "up" else "up"

    payload = ResolveRequest(
        symbol=symbol, seed=seed, start_time=start_time,
        entry_tick_index=-1, direction=wrong_direction, stake=25,
    )
    result = svc.resolve_round(db, user, payload)

    assert result.correct is False
    assert result.payout == -25
    assert result.points_balance == 975.0


def test_resolve_rejects_stake_over_balance(user):
    db = _db_with_balance(5.0)
    start_time = time.time() - 100 * market.TICK_SECONDS
    payload = ResolveRequest(
        symbol="SIM-CALM", seed="s", start_time=start_time,
        entry_tick_index=-1, direction="up", stake=500,
    )
    with pytest.raises(svc.PredictionError, match="Insufficient points"):
        svc.resolve_round(db, user, payload)


def test_reset_account_clears_history_and_restores_balance(user):
    db = _db_with_balance(1000.0)
    result = svc.reset_account(db, user)

    assert result.points_balance == svc.STARTING_POINTS
    assert result.total_predictions == 0
    delete_calls = [c for c in db.execute.call_args_list if "DELETE FROM predictions" in c[0][0]]
    update_calls = [c for c in db.execute.call_args_list if "UPDATE prediction_accounts" in c[0][0]]
    assert len(delete_calls) == 1
    assert len(update_calls) == 1


def test_deposit_adds_to_balance(user):
    db = _db_with_balance(100.0)
    result = svc.deposit(db, user, 250.0)
    assert result.points_balance == 350.0


def test_deposit_rejects_non_positive_amount(user):
    db = _db_with_balance(100.0)
    with pytest.raises(svc.PredictionError, match="must be positive"):
        svc.deposit(db, user, -10.0)


def test_deposit_rejects_over_max(user):
    db = _db_with_balance(100.0)
    with pytest.raises(svc.PredictionError, match="cannot exceed"):
        svc.deposit(db, user, svc.MAX_DEPOSIT + 1)


def test_resolve_round_with_kes_currency_deducts_real_balance():
    db = MagicMock()
    seed = "fixed-seed"
    symbol = "SIM-CALM"
    start_time = time.time() - 100 * market.TICK_SECONDS

    entry_candle = market.get_candle(seed, symbol, start_time, -1)
    exit_candle = market.get_candle(seed, symbol, start_time, 0)
    actual_direction = "up" if exit_candle["close"] >= exit_candle["open"] else "down"

    db.execute.return_value = [{
        "user_id": "user-1", "points_balance": 1000.0, "real_balance_kes": 500.0, "created_at": "2026-01-01",
    }]

    user = User(
        id="user-1", email="t@example.com", hashed_password="h",
        is_active=True, trading_paused=False, created_at="2026-01-01",
    )
    payload = ResolveRequest(
        symbol=symbol, seed=seed, start_time=start_time, entry_tick_index=-1,
        direction=actual_direction, stake=100, currency="kes",
    )
    result = svc.resolve_round(db, user, payload)

    assert result.currency == "kes"
    assert result.correct is True
    assert result.real_balance_kes == 500.0 + 100 * svc.PAYOUT_RATE
    assert result.points_balance == 1000.0  # untouched


def test_resolve_round_kes_insufficient_balance():
    db = MagicMock()
    db.execute.return_value = [{
        "user_id": "user-1", "points_balance": 1000.0, "real_balance_kes": 5.0, "created_at": "2026-01-01",
    }]
    user = User(
        id="user-1", email="t@example.com", hashed_password="h",
        is_active=True, trading_paused=False, created_at="2026-01-01",
    )
    payload = ResolveRequest(
        symbol="SIM-CALM", seed="s", start_time=time.time() - 100 * market.TICK_SECONDS,
        entry_tick_index=-1, direction="up", stake=100, currency="kes",
    )
    with pytest.raises(svc.PredictionError, match="Insufficient KES"):
        svc.resolve_round(db, user, payload)
