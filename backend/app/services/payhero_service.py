"""Real-money deposits via PayHero's M-Pesa STK push API.

API contract below was extracted directly from PayHero's own published developer
docs (docs.payhero.co.ke) - not guessed. Endpoints used:

    POST https://backend.payhero.co.ke/api/v2/payments
        body: {amount, phone_number, channel_id, provider: "m-pesa",
               external_reference, callback_url}
        -> 201 {success, status: "QUEUED", reference, CheckoutRequestID}

    GET https://backend.payhero.co.ke/api/v2/transaction-status?reference=...
        -> 200 {status: "QUEUED"|"SUCCESS"|"FAILED", provider_reference, ...}

    Callback POSTed to callback_url:
        {status: bool, response: {Amount, CheckoutRequestID, ExternalReference,
                                   MerchantRequestID, MpesaReceiptNumber, Phone,
                                   ResultCode, ResultDesc}}
        ResultCode == 0 means success.

This module tracks confirmed deposit transactions and, once a deposit is confirmed
successful, credits the user's real_balance_kes (in prediction_accounts) - a
balance kept entirely separate from points_balance, the free-practice wallet. It
never lets money out (no withdrawal/disbursement here) - only in.
"""
import base64
import logging
import uuid
from datetime import datetime, timezone

import httpx

from app.config import get_settings
from app.db_d1 import D1Client
from app.models.payhero_deposit import PayHeroDeposit
from app.models.user import User
from app.schemas.payhero import PayHeroCallback
from app.services.prediction_service import ensure_account
from app.sql_utils import sql_quote

logger = logging.getLogger(__name__)

_BASE_URL = "https://backend.payhero.co.ke/api/v2"


class PayHeroError(Exception):
    pass


class PayHeroNotConfigured(PayHeroError):
    pass


def _auth_header() -> dict[str, str]:
    settings = get_settings()
    if not settings.payhero_api_username or not settings.payhero_api_password:
        raise PayHeroNotConfigured(
            "PayHero credentials are not configured (PAYHERO_API_USERNAME/PAYHERO_API_PASSWORD)."
        )
    token = base64.b64encode(
        f"{settings.payhero_api_username}:{settings.payhero_api_password}".encode()
    ).decode()
    return {"Authorization": f"Basic {token}", "Content-Type": "application/json"}


def _get_deposit_by_reference(db: D1Client, external_reference: str) -> PayHeroDeposit | None:
    rows = db.execute(
        f"SELECT * FROM payhero_deposits WHERE external_reference = {sql_quote(external_reference)} LIMIT 1"
    )
    return PayHeroDeposit.from_row(rows[0]) if rows else None


def initiate_deposit(db: D1Client, user: User, amount: int, phone_number: str) -> PayHeroDeposit:
    settings = get_settings()
    if not settings.payhero_channel_id:
        raise PayHeroNotConfigured("PAYHERO_CHANNEL_ID is not configured.")

    external_reference = f"CFX-{uuid.uuid4().hex[:12]}"
    callback_url = (
        f"{settings.payhero_callback_base_url}/api/payhero/callback"
        if settings.payhero_callback_base_url
        else None
    )

    body = {
        "amount": amount,
        "phone_number": phone_number,
        "channel_id": int(settings.payhero_channel_id),
        "provider": "m-pesa",
        "external_reference": external_reference,
    }
    if callback_url:
        body["callback_url"] = callback_url

    try:
        resp = httpx.post(f"{_BASE_URL}/payments", headers=_auth_header(), json=body, timeout=20.0)
    except httpx.HTTPError as exc:
        raise PayHeroError(f"Could not reach PayHero: {exc}") from exc

    if resp.status_code not in (200, 201):
        logger.warning("PayHero deposit initiation failed with status %s", resp.status_code)
        raise PayHeroError(f"PayHero rejected the deposit request (HTTP {resp.status_code}): {resp.text[:300]}")

    data = resp.json()
    checkout_request_id = data.get("CheckoutRequestID")
    # PayHero's own generated reference - required by /transaction-status later.
    # Distinct from both our external_reference and their CheckoutRequestID.
    provider_reference = data.get("reference")

    deposit = PayHeroDeposit(
        id=str(uuid.uuid4()),
        user_id=user.id,
        external_reference=external_reference,
        checkout_request_id=checkout_request_id,
        provider_reference=provider_reference,
        phone_number=phone_number,
        amount=float(amount),
        status="pending",
        mpesa_receipt_number=None,
        result_desc=None,
        created_at=datetime.now(timezone.utc).isoformat(),
        updated_at=datetime.now(timezone.utc).isoformat(),
    )
    db.execute(
        "INSERT INTO payhero_deposits (id, user_id, external_reference, checkout_request_id, "
        "provider_reference, phone_number, amount, status, mpesa_receipt_number, result_desc, "
        "created_at, updated_at) VALUES ("
        f"{sql_quote(deposit.id)}, {sql_quote(deposit.user_id)}, {sql_quote(deposit.external_reference)}, "
        f"{sql_quote(deposit.checkout_request_id)}, {sql_quote(deposit.provider_reference)}, "
        f"{sql_quote(deposit.phone_number)}, {sql_quote(deposit.amount)}, "
        f"{sql_quote(deposit.status)}, {sql_quote(deposit.mpesa_receipt_number)}, {sql_quote(deposit.result_desc)}, "
        f"{sql_quote(deposit.created_at)}, {sql_quote(deposit.updated_at)})"
    )
    return deposit


def _update_deposit_status(
    db: D1Client, deposit: PayHeroDeposit, status: str, mpesa_receipt: str | None, result_desc: str | None
) -> None:
    db.execute(
        f"UPDATE payhero_deposits SET status = {sql_quote(status)}, "
        f"mpesa_receipt_number = {sql_quote(mpesa_receipt)}, result_desc = {sql_quote(result_desc)}, "
        f"updated_at = {sql_quote(datetime.now(timezone.utc).isoformat())} "
        f"WHERE id = {sql_quote(deposit.id)}"
    )


def _credit_real_balance(db: D1Client, user_id: str, amount: float) -> None:
    """Credits real_balance_kes. Only ever called once per deposit - both callers
    (handle_callback, check_status) only reach this on a pending->success
    transition, guarded by the deposit's own status column, so a replayed webhook
    or a repeated status poll can never double-credit the same deposit."""
    ensure_account(db, user_id)
    db.execute(
        f"UPDATE prediction_accounts SET real_balance_kes = real_balance_kes + {sql_quote(amount)} "
        f"WHERE user_id = {sql_quote(user_id)}"
    )


def handle_callback(db: D1Client, payload: PayHeroCallback) -> PayHeroDeposit:
    ref = payload.response.ExternalReference
    if not ref:
        raise PayHeroError("Callback is missing ExternalReference - cannot match it to a deposit.")

    deposit = _get_deposit_by_reference(db, ref)
    if deposit is None:
        raise PayHeroError(f"No deposit found for reference {ref!r}.")

    if deposit.status != "pending":
        # Already settled by an earlier callback or status check - a replayed
        # webhook must never credit the balance twice.
        return deposit

    success = payload.status and payload.response.ResultCode == 0
    status = "success" if success else "failed"
    _update_deposit_status(db, deposit, status, payload.response.MpesaReceiptNumber, payload.response.ResultDesc)
    if success:
        _credit_real_balance(db, deposit.user_id, deposit.amount)

    deposit.status = status
    deposit.mpesa_receipt_number = payload.response.MpesaReceiptNumber
    deposit.result_desc = payload.response.ResultDesc
    return deposit


def check_status(db: D1Client, user: User, external_reference: str) -> PayHeroDeposit:
    deposit = _get_deposit_by_reference(db, external_reference)
    if deposit is None or deposit.user_id != user.id:
        raise PayHeroError("Deposit not found.")

    if deposit.status != "pending":
        return deposit

    if not deposit.provider_reference:
        raise PayHeroError(
            "This deposit has no PayHero-issued reference yet (initiation response didn't include one) - "
            "cannot check status. It should still resolve via the callback webhook."
        )

    try:
        resp = httpx.get(
            f"{_BASE_URL}/transaction-status",
            headers=_auth_header(),
            params={"reference": deposit.provider_reference},
            timeout=15.0,
        )
    except httpx.HTTPError as exc:
        raise PayHeroError(f"Could not reach PayHero: {exc}") from exc

    if resp.status_code != 200:
        raise PayHeroError(f"PayHero status check failed (HTTP {resp.status_code}): {resp.text[:300]}")

    data = resp.json()
    remote_status = data.get("status")
    if remote_status == "SUCCESS":
        _update_deposit_status(db, deposit, "success", data.get("provider_reference"), None)
        _credit_real_balance(db, deposit.user_id, deposit.amount)
        deposit.status = "success"
        deposit.mpesa_receipt_number = data.get("provider_reference")
    elif remote_status == "FAILED":
        _update_deposit_status(db, deposit, "failed", None, "Payment failed")
        deposit.status = "failed"

    return deposit


def list_deposits(db: D1Client, user: User, limit: int = 50) -> list[PayHeroDeposit]:
    rows = db.execute(
        f"SELECT * FROM payhero_deposits WHERE user_id = {sql_quote(user.id)} "
        f"ORDER BY created_at DESC LIMIT {int(limit)}"
    )
    return [PayHeroDeposit.from_row(r) for r in rows]
