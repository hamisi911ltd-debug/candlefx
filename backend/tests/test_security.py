import pytest
from jose import JWTError

from app.core.security import (
    TokenType,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_password_hash_and_verify_roundtrip():
    hashed = hash_password("s3curePassword!")
    assert hashed != "s3curePassword!"
    assert verify_password("s3curePassword!", hashed)
    assert not verify_password("wrongPassword", hashed)


def test_access_token_roundtrip():
    token = create_access_token("user-123")
    assert decode_token(token, TokenType.ACCESS) == "user-123"


def test_refresh_token_rejected_as_access_token():
    token = create_refresh_token("user-123")
    with pytest.raises(JWTError):
        decode_token(token, TokenType.ACCESS)
