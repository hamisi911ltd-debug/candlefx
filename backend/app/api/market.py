from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.market import OhlcvBar, OhlcvOut
from app.services.market_router import MarketDataError, fetch_ohlcv, is_forex

router = APIRouter(prefix="/market", tags=["market"])

_ALLOWED_TIMEFRAMES = {"1m", "5m", "15m", "1h", "4h", "1d"}


@router.get("/ohlcv", response_model=OhlcvOut)
def get_ohlcv(
    symbol: str = Query(..., min_length=3, max_length=20),
    timeframe: str = Query("1h"),
    limit: int = Query(200, ge=10, le=1000),
    current_user: User = Depends(get_current_user),
) -> OhlcvOut:
    if timeframe not in _ALLOWED_TIMEFRAMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"timeframe must be one of {sorted(_ALLOWED_TIMEFRAMES)}",
        )
    # Forex data (Frankfurter) only publishes one rate per business day - no intraday
    # granularity is available, so any finer timeframe request is served as daily bars.
    if is_forex(symbol) and timeframe != "1d":
        timeframe = "1d"
    try:
        df = fetch_ohlcv(symbol.upper(), timeframe=timeframe, limit=limit)
    except MarketDataError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    bars = [
        OhlcvBar(
            timestamp=row.timestamp.isoformat(),
            open=row.open,
            high=row.high,
            low=row.low,
            close=row.close,
            volume=row.volume,
        )
        for row in df.itertuples()
    ]
    return OhlcvOut(symbol=symbol.upper(), timeframe=timeframe, bars=bars)
