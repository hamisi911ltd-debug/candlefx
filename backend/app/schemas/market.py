from pydantic import BaseModel


class OhlcvBar(BaseModel):
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class OhlcvOut(BaseModel):
    symbol: str
    timeframe: str
    bars: list[OhlcvBar]
