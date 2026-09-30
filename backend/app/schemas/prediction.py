from pydantic import BaseModel, field_validator

from app.schemas.market import OhlcvBar

CURRENCIES = ("points", "kes")


class RoundOut(BaseModel):
    symbol: str
    seed: str
    start_time: float
    tick_seconds: int
    bars: list[OhlcvBar]
    entry_tick_index: int
    entry_time: str
    entry_price: float
    points_balance: float
    real_balance_kes: float
    payout_rate: float
    server_time: float


class LiveOut(BaseModel):
    bars: list[OhlcvBar]
    latest_closed_tick_index: int
    server_time: float


class ResolveRequest(BaseModel):
    symbol: str
    seed: str
    start_time: float
    entry_tick_index: int
    direction: str
    stake: float
    currency: str = "points"

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in ("up", "down"):
            raise ValueError("direction must be 'up' or 'down'")
        return v

    @field_validator("stake")
    @classmethod
    def stake_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("stake must be positive")
        return v

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in CURRENCIES:
            raise ValueError(f"currency must be one of {CURRENCIES}")
        return v


class ResolveOut(BaseModel):
    correct: bool
    actual_direction: str
    exit_price: float
    exit_bar: OhlcvBar
    payout: float
    currency: str
    points_balance: float
    real_balance_kes: float
    # The just-resolved tick becomes the new entry point, so the frontend can chain
    # straight into the next guess without a fresh /round call.
    next_entry_tick_index: int
    next_entry_price: float


class NotReadyOut(BaseModel):
    ready: bool = False
    seconds_remaining: float


class PredictionOut(BaseModel):
    id: str
    symbol: str
    timeframe: str
    entry_time: str
    entry_price: float
    direction: str
    stake: float
    currency: str
    exit_time: str
    exit_price: float
    correct: bool
    payout: float
    created_at: str


class PredictionAccountOut(BaseModel):
    points_balance: float
    real_balance_kes: float
    total_predictions: int
    correct_predictions: int
    payout_rate: float = 0.0


class DepositRequest(BaseModel):
    amount: float

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("amount must be positive")
        return v
