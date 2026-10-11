from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import JWTError

from app.core.deps import get_current_user, get_db
from app.core.rate_limit import limiter
from app.core.security import TokenType, create_access_token, create_refresh_token, decode_token
from app.db_d1 import D1Client
from app.models.user import User
from app.schemas.auth import (
    AccessTokenOut,
    RefreshRequest,
    TokenPair,
    UserLogin,
    UserOut,
    UserRegister,
)
from app.services.auth_service import (
    AuthError,
    authenticate_user,
    get_user_by_id,
    register_user,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _tokens_for(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
        user=UserOut.model_validate(user),
    )


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
def register(request: Request, payload: UserRegister, db: D1Client = Depends(get_db)) -> TokenPair:
    try:
        user = register_user(db, payload.email, payload.password, payload.phone_number)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return _tokens_for(user)


@router.post("/login", response_model=TokenPair)
@limiter.limit("10/minute")
def login(request: Request, payload: UserLogin, db: D1Client = Depends(get_db)) -> TokenPair:
    try:
        user = authenticate_user(db, payload.email, payload.password)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    return _tokens_for(user)


@router.post("/refresh", response_model=AccessTokenOut)
@limiter.limit("20/minute")
def refresh(request: Request, payload: RefreshRequest, db: D1Client = Depends(get_db)) -> AccessTokenOut:
    try:
        user_id = decode_token(payload.refresh_token, TokenType.REFRESH)
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token") from exc

    user = get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    return AccessTokenOut(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user
