from unittest.mock import MagicMock

import pytest

from app.db_d1 import D1Error
from app.services import auth_service


def test_register_user_rejects_duplicate_email():
    db = MagicMock()
    db.execute.side_effect = D1Error(
        "D1 query did not succeed: [{'code': 7500, 'message': \"UNIQUE constraint failed: "
        "users.email: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)\"}]"
    )

    with pytest.raises(auth_service.AuthError, match="already exists"):
        auth_service.register_user(db, "a@b.com", "s3curePassword!")


def test_register_user_success_inserts_and_hashes_password():
    db = MagicMock()
    db.execute.return_value = []  # no existing user on the lookup

    user = auth_service.register_user(db, "new@example.com", "s3curePassword!")

    assert user.email == "new@example.com"
    assert user.hashed_password != "s3curePassword!"
    insert_calls = [c for c in db.execute.call_args_list if "INSERT INTO users" in c[0][0]]
    assert len(insert_calls) == 1


def test_authenticate_user_rejects_wrong_password():
    db = MagicMock()
    from app.core.security import hash_password

    db.execute.return_value = [{
        "id": "u1", "email": "a@b.com", "hashed_password": hash_password("correct-password"),
        "is_active": 1, "trading_paused": 0, "created_at": "2026-01-01",
    }]

    with pytest.raises(auth_service.AuthError):
        auth_service.authenticate_user(db, "a@b.com", "wrong-password")


def test_authenticate_user_success():
    db = MagicMock()
    from app.core.security import hash_password

    db.execute.return_value = [{
        "id": "u1", "email": "a@b.com", "hashed_password": hash_password("correct-password"),
        "is_active": 1, "trading_paused": 0, "created_at": "2026-01-01",
    }]

    user = auth_service.authenticate_user(db, "a@b.com", "correct-password")
    assert user.id == "u1"


