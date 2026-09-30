import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.core.deps import get_current_user, get_db
from app.core.rate_limit import limiter
from app.db_d1 import D1Client
from app.models.user import User
from app.schemas.market import OhlcvBar
from app.schemas.prediction import (
    DepositRequest,
    LiveOut,
    PredictionAccountOut,
    PredictionOut,
    ResolveOut,
    ResolveRequest,
    RoundOut,
)
from app.services.prediction_service import (
    PredictionError,
    RoundNotReadyError,
    deposit,
    get_account,
    get_history,
    get_live_bars,
    get_round,
    reset_account,
    resolve_round,
)
from app.services.synthetic_market import SYMBOL_PROFILES

router = APIRouter(prefix="/predict", tags=["prediction-game"])


@router.get("/symbols")
def read_symbols() -> list[str]:
    return sorted(SYMBOL_PROFILES)


@router.get("/round", response_model=RoundOut)
def read_round(
    symbol: str = Query(...),
    db: D1Client = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RoundOut:
    try:
        return get_round(db, current_user, symbol.upper())
    except PredictionError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/live", response_model=LiveOut)
def read_live(
    symbol: str = Query(...),
    seed: str = Query(...),
    start_time: float = Query(...),
    current_user: User = Depends(get_current_user),
) -> LiveOut:
    candles, latest = get_live_bars(symbol.upper(), seed, start_time)
    return LiveOut(
        bars=[OhlcvBar(timestamp=c["timestamp"], open=c["open"], high=c["high"], low=c["low"], close=c["close"], volume=c["volume"]) for c in candles],
        latest_closed_tick_index=latest,
        server_time=time.time(),
    )


@router.post("/resolve", response_model=ResolveOut)
@limiter.limit("120/minute")
def resolve(
    request: Request,
    payload: ResolveRequest,
    db: D1Client = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ResolveOut:
    try:
        return resolve_round(db, current_user, payload)
    except RoundNotReadyError as exc:
        raise HTTPException(
            status_code=status.HTTP_425_TOO_EARLY,
            detail={"message": str(exc), "seconds_remaining": exc.seconds_remaining},
        ) from exc
    except PredictionError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/account", response_model=PredictionAccountOut)
def read_account(
    db: D1Client = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PredictionAccountOut:
    return get_account(db, current_user)


@router.post("/deposit", response_model=PredictionAccountOut)
@limiter.limit("30/minute")
def add_deposit(
    request: Request,
    payload: DepositRequest,
    db: D1Client = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PredictionAccountOut:
    try:
        return deposit(db, current_user, payload.amount)
    except PredictionError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/reset", response_model=PredictionAccountOut)
@limiter.limit("10/minute")
def reset(
    request: Request,
    db: D1Client = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PredictionAccountOut:
    return reset_account(db, current_user)


@router.get("/history", response_model=list[PredictionOut])
def read_history(
    db: D1Client = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[PredictionOut]:
    history = get_history(db, current_user)
    return [
        PredictionOut(
            id=p.id, symbol=p.symbol, timeframe=p.timeframe, entry_time=p.entry_time,
            entry_price=p.entry_price, direction=p.direction, stake=p.stake, currency=p.currency,
            exit_time=p.exit_time, exit_price=p.exit_price, correct=p.correct,
            payout=p.payout, created_at=p.created_at,
        )
        for p in history
    ]
