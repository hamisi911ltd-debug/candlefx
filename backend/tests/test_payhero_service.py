from unittest.mock import MagicMock, patch

import pytest

from app.models.user import User
from app.schemas.payhero import PayHeroCallback, PayHeroCallbackResponse
from app.services import payhero_service as svc


@pytest.fixture
def user():
    return User(
        id="user-1", email="t@example.com", hashed_password="h",
        is_active=True, trading_paused=False, created_at="2026-01-01",
    )


@pytest.fixture(autouse=True)
def payhero_configured(monkeypatch):
    settings = MagicMock()
    settings.payhero_api_username = "user"
    settings.payhero_api_password = "pass"
    settings.payhero_channel_id = "133"
    settings.payhero_callback_base_url = None
    monkeypatch.setattr(svc, "get_settings", lambda: settings)


def test_initiate_deposit_not_configured_without_credentials(monkeypatch, user):
    settings = MagicMock()
    settings.payhero_api_username = None
    settings.payhero_api_password = None
    monkeypatch.setattr(svc, "get_settings", lambda: settings)

    with pytest.raises(svc.PayHeroNotConfigured):
        svc.initiate_deposit(MagicMock(), user, 100, "0712345678")


def test_initiate_deposit_success(user):
    db = MagicMock()
    fake_response = MagicMock(status_code=201)
    fake_response.json.return_value = {
        "success": True, "status": "QUEUED", "reference": "E8UWT7CLUW",
        "CheckoutRequestID": "ws_CO_123",
    }

    with patch.object(svc.httpx, "post", return_value=fake_response) as mock_post:
        deposit = svc.initiate_deposit(db, user, 100, "0712345678")

    assert deposit.status == "pending"
    assert deposit.checkout_request_id == "ws_CO_123"
    assert deposit.provider_reference == "E8UWT7CLUW"
    assert deposit.external_reference.startswith("CFX-")

    sent_body = mock_post.call_args.kwargs["json"]
    assert sent_body["amount"] == 100
    assert sent_body["phone_number"] == "0712345678"
    assert sent_body["channel_id"] == 133
    assert sent_body["provider"] == "m-pesa"

    insert_calls = [c for c in db.execute.call_args_list if "INSERT INTO payhero_deposits" in c[0][0]]
    assert len(insert_calls) == 1


def test_initiate_deposit_raises_on_rejection(user):
    db = MagicMock()
    fake_response = MagicMock(status_code=400, text="Bad request")

    with patch.object(svc.httpx, "post", return_value=fake_response):
        with pytest.raises(svc.PayHeroError, match="rejected"):
            svc.initiate_deposit(db, user, 100, "0712345678")


def _db_with_pending_deposit():
    deposit_row = {
        "id": "d1", "user_id": "user-1", "external_reference": "CFX-abc123",
        "checkout_request_id": "ws_CO_1", "provider_reference": "E8UWT7CLUW", "phone_number": "0712345678",
        "amount": 100.0, "status": "pending", "mpesa_receipt_number": None, "result_desc": None,
        "created_at": "2026-01-01", "updated_at": "2026-01-01",
    }
    account_row = {
        "user_id": "user-1", "points_balance": 1000.0, "real_balance_kes": 0.0, "created_at": "2026-01-01",
    }
    db = MagicMock()

    def execute(sql, *a, **kw):
        if "SELECT * FROM payhero_deposits" in sql:
            return [deposit_row]
        if "SELECT * FROM prediction_accounts" in sql:
            return [account_row]
        return []

    db.execute.side_effect = execute
    return db


def test_handle_callback_marks_success():
    db = _db_with_pending_deposit()

    payload = PayHeroCallback(
        status=True,
        response=PayHeroCallbackResponse(
            Amount=100, CheckoutRequestID="ws_CO_1", ExternalReference="CFX-abc123",
            MpesaReceiptNumber="ABC123XYZ", ResultCode=0, ResultDesc="Success",
        ),
    )
    deposit = svc.handle_callback(db, payload)

    assert deposit.status == "success"
    assert deposit.mpesa_receipt_number == "ABC123XYZ"
    update_calls = [c for c in db.execute.call_args_list if "UPDATE payhero_deposits" in c[0][0]]
    assert len(update_calls) == 1
    assert "'success'" in update_calls[0][0][0]
    credit_calls = [c for c in db.execute.call_args_list if "real_balance_kes = real_balance_kes +" in c[0][0]]
    assert len(credit_calls) == 1


def test_handle_callback_marks_failure_on_nonzero_result_code():
    db = _db_with_pending_deposit()

    payload = PayHeroCallback(
        status=False,
        response=PayHeroCallbackResponse(
            ExternalReference="CFX-abc123", ResultCode=1, ResultDesc="Cancelled by user",
        ),
    )
    deposit = svc.handle_callback(db, payload)
    assert deposit.status == "failed"
    credit_calls = [c for c in db.execute.call_args_list if "real_balance_kes = real_balance_kes +" in c[0][0]]
    assert len(credit_calls) == 0


def test_handle_callback_is_idempotent_for_already_settled_deposit():
    deposit_row = {
        "id": "d1", "user_id": "user-1", "external_reference": "CFX-abc123",
        "checkout_request_id": "ws_CO_1", "provider_reference": "E8UWT7CLUW", "phone_number": "0712345678",
        "amount": 100.0, "status": "success", "mpesa_receipt_number": "ABC123XYZ", "result_desc": "Success",
        "created_at": "2026-01-01", "updated_at": "2026-01-01",
    }
    db = MagicMock()
    db.execute.side_effect = lambda sql, *a, **kw: [deposit_row] if "SELECT * FROM payhero_deposits" in sql else []

    payload = PayHeroCallback(
        status=True,
        response=PayHeroCallbackResponse(ExternalReference="CFX-abc123", ResultCode=0, MpesaReceiptNumber="ABC123XYZ"),
    )
    deposit = svc.handle_callback(db, payload)

    assert deposit.status == "success"
    credit_calls = [c for c in db.execute.call_args_list if "real_balance_kes = real_balance_kes +" in c[0][0]]
    assert len(credit_calls) == 0
    update_calls = [c for c in db.execute.call_args_list if "UPDATE payhero_deposits" in c[0][0]]
    assert len(update_calls) == 0


def test_handle_callback_rejects_unknown_reference(user):
    db = MagicMock()
    db.execute.return_value = []

    payload = PayHeroCallback(
        status=True,
        response=PayHeroCallbackResponse(ExternalReference="CFX-doesnotexist", ResultCode=0),
    )
    with pytest.raises(svc.PayHeroError, match="No deposit found"):
        svc.handle_callback(db, payload)
