from pydantic import BaseModel, field_validator


class DepositInitiateRequest(BaseModel):
    amount: int
    phone_number: str

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("amount must be positive")
        return v

    @field_validator("phone_number")
    @classmethod
    def phone_looks_valid(cls, v: str) -> str:
        v = v.strip()
        digits = v.replace("+", "")
        if not digits.isdigit() or len(digits) < 9:
            raise ValueError("phone_number must be a valid M-Pesa number, e.g. 0712345678")
        return v


class DepositInitiateOut(BaseModel):
    external_reference: str
    checkout_request_id: str | None
    status: str


class DepositOut(BaseModel):
    id: str
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


class PayHeroCallbackResponse(BaseModel):
    Amount: float | None = None
    CheckoutRequestID: str | None = None
    ExternalReference: str | None = None
    MerchantRequestID: str | None = None
    MpesaReceiptNumber: str | None = None
    Phone: str | None = None
    ResultCode: int | None = None
    ResultDesc: str | None = None


class PayHeroCallback(BaseModel):
    forward_url: str | None = None
    status: bool
    response: PayHeroCallbackResponse
