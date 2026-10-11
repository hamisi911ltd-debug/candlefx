from dataclasses import dataclass


@dataclass
class User:
    id: str
    email: str
    hashed_password: str
    is_active: bool
    trading_paused: bool
    created_at: str
    phone_number: str | None = None

    @classmethod
    def from_row(cls, row: dict) -> "User":
        return cls(
            id=row["id"],
            email=row["email"],
            hashed_password=row["hashed_password"],
            is_active=bool(row["is_active"]),
            trading_paused=bool(row["trading_paused"]),
            created_at=row["created_at"],
            phone_number=row.get("phone_number"),
        )
