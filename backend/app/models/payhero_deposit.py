from dataclasses import dataclass


@dataclass
class PayHeroDeposit:
    id: str
    user_id: str
    external_reference: str
    checkout_request_id: str | None
    provider_reference: str | None
    phone_number: str
    amount: float
    status: str
    mpesa_receipt_number: str | None
    result_desc: str | None
    created_at: str
    updated_at: str

    @classmethod
    def from_row(cls, row: dict) -> "PayHeroDeposit":
        return cls(
            id=row["id"],
            user_id=row["user_id"],
            external_reference=row["external_reference"],
            checkout_request_id=row.get("checkout_request_id"),
            provider_reference=row.get("provider_reference"),
            phone_number=row["phone_number"],
            amount=row["amount"],
            status=row["status"],
            mpesa_receipt_number=row.get("mpesa_receipt_number"),
            result_desc=row.get("result_desc"),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
