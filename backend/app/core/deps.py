from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError

from app.core.security import TokenType, decode_token
from app.db_d1 import D1Client, get_d1_client
from app.models.user import User
from app.services.auth_service import get_user_by_id

_bearer_scheme = HTTPBearer(auto_error=False)

_CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_db() -> D1Client:
    return get_d1_client()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: D1Client = Depends(get_db),
) -> User:
    if credentials is None:
        raise _CREDENTIALS_EXCEPTION
    try:
        user_id = decode_token(credentials.credentials, TokenType.ACCESS)
    except JWTError as exc:
        raise _CREDENTIALS_EXCEPTION from exc

    user = get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        raise _CREDENTIALS_EXCEPTION
    return user
