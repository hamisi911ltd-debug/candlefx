from dataclasses import dataclass


@dataclass
class PredictionAccount:
    user_id: str
    points_balance: float
    real_balance_kes: float
    created_at: str

    @classmethod
    def from_row(cls, row: dict) -> "PredictionAccount":
        return cls(
            user_id=row["user_id"],
            points_balance=row["points_balance"],
            real_balance_kes=row.get("real_balance_kes", 0.0) or 0.0,
            created_at=row["created_at"],
        )


@dataclass
class Prediction:
    id: str
    user_id: str
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

    @classmethod
    def from_row(cls, row: dict) -> "Prediction":
        return cls(
            id=row["id"],
            user_id=row["user_id"],
            symbol=row["symbol"],
            timeframe=row["timeframe"],
            entry_time=row["entry_time"],
            entry_price=row["entry_price"],
            direction=row["direction"],
            stake=row["stake"],
            currency=row.get("currency", "points") or "points",
            exit_time=row["exit_time"],
            exit_price=row["exit_price"],
            correct=bool(row["correct"]),
            payout=row["payout"],
            created_at=row["created_at"],
        )
