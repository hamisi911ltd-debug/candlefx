import uuid
from datetime import datetime, timezone

from app.core.security import hash_password, verify_password
from app.db_d1 import D1Client, D1Error
from app.models.user import User
from app.sql_utils import sql_quote


class AuthError(Exception):
    pass


def get_user_by_email(db: D1Client, email: str) -> User | None:
    rows = db.execute(f"SELECT * FROM users WHERE email = {sql_quote(email)} LIMIT 1")
    return User.from_row(rows[0]) if rows else None


def get_user_by_id(db: D1Client, user_id: str) -> User | None:
    rows = db.execute(f"SELECT * FROM users WHERE id = {sql_quote(user_id)} LIMIT 1")
    return User.from_row(rows[0]) if rows else None


def register_user(db: D1Client, email: str, password: str, phone_number: str | None = None) -> User:
    user = User(
        id=str(uuid.uuid4()),
        email=email,
        hashed_password=hash_password(password),
        is_active=True,
        trading_paused=False,
        created_at=datetime.now(timezone.utc).isoformat(),
        phone_number=phone_number,
    )
    # No pre-check SELECT for an existing email: that would cost a second sequential
    # D1 round trip on every registration just to handle the rare duplicate case.
    # Instead attempt the INSERT directly and rely on the email UNIQUE constraint,
    # translating that specific failure into a clean AuthError.
    try:
        db.execute(
            "INSERT INTO users (id, email, hashed_password, is_active, trading_paused, created_at, phone_number) "
            f"VALUES ({sql_quote(user.id)}, {sql_quote(user.email)}, {sql_quote(user.hashed_password)}, "
            f"{sql_quote(user.is_active)}, {sql_quote(user.trading_paused)}, {sql_quote(user.created_at)}, "
            f"{sql_quote(user.phone_number)})"
        )
    except D1Error as exc:
        if "UNIQUE constraint failed: users.email" in str(exc):
            raise AuthError("A user with this email already exists") from exc
        raise
    return user


def authenticate_user(db: D1Client, email: str, password: str) -> User:
    user = get_user_by_email(db, email)
    if user is None or not user.is_active or not verify_password(password, user.hashed_password):
        raise AuthError("Incorrect email or password")
    return user
