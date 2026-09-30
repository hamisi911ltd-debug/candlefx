"""Dispatches market-data calls to the right source based on the symbol: crypto pairs
go to ccxt/Binance, known forex pairs go to the Frankfurter FX rate feed. This is what
lets paper trading and the chart endpoint treat "BTC/USDT" and "EUR/USD" identically
from the caller's side."""
import pandas as pd

from app.exchanges import forex_data, market_data

MarketDataError = market_data.MarketDataError  # re-exported for a single error type


def is_forex(symbol: str) -> bool:
    return symbol.upper() in forex_data.FOREX_PAIRS


def fetch_last_price(symbol: str) -> float:
    if is_forex(symbol):
        try:
            return forex_data.fetch_last_price(symbol)
        except forex_data.ForexDataError as exc:
            raise MarketDataError(str(exc)) from exc
    return market_data.fetch_last_price(symbol)


def fetch_last_prices(symbols: list[str]) -> dict[str, float]:
    forex_symbols = [s for s in symbols if is_forex(s)]
    crypto_symbols = [s for s in symbols if not is_forex(s)]

    result: dict[str, float] = {}
    if forex_symbols:
        result.update(forex_data.fetch_last_prices(forex_symbols))
    if crypto_symbols:
        try:
            result.update(market_data.fetch_last_prices(crypto_symbols))
        except MarketDataError:
            pass
    return result


def fetch_ohlcv(symbol: str, timeframe: str = "1h", limit: int = 200) -> pd.DataFrame:
    if is_forex(symbol):
        try:
            return forex_data.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
        except forex_data.ForexDataError as exc:
            raise MarketDataError(str(exc)) from exc
    return market_data.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
