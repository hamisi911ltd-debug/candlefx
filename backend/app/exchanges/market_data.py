"""Public market data - no API key required. Used for charts and paper trading,
where we only ever need to read prices, never touch anyone's account.

Uses one cached ccxt client for the process lifetime rather than constructing a new
one per call: a fresh ccxt.binance() client lazily calls load_markets() on its first
request, which pulls Binance's full exchange-info payload (thousands of symbols) -
paying that cost on every single price lookup made every page load was the main
source of slowness here, not network latency to Binance itself.
"""
import ccxt
import pandas as pd

_client: ccxt.binance | None = None


class MarketDataError(Exception):
    pass


def _public_client() -> ccxt.binance:
    global _client
    if _client is None:
        _client = ccxt.binance({"enableRateLimit": True})
    return _client


def fetch_ohlcv(symbol: str, timeframe: str = "1h", limit: int = 200) -> pd.DataFrame:
    client = _public_client()
    try:
        raw = client.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
    except ccxt.BaseError as exc:
        raise MarketDataError(f"Could not fetch market data for {symbol}: {exc}") from exc

    df = pd.DataFrame(raw, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    return df


def fetch_last_price(symbol: str) -> float:
    client = _public_client()
    try:
        ticker = client.fetch_ticker(symbol)
    except ccxt.BaseError as exc:
        raise MarketDataError(f"Could not fetch price for {symbol}: {exc}") from exc

    price = ticker.get("last")
    if price is None:
        raise MarketDataError(f"No last price available for {symbol}")
    return float(price)


def fetch_last_prices(symbols: list[str]) -> dict[str, float]:
    """Batched version of fetch_last_price - one request for many symbols instead of
    one sequential request per symbol. Falls back to per-symbol fetches only if the
    exchange doesn't support a batched ticker request."""
    if not symbols:
        return {}

    client = _public_client()
    try:
        if client.has.get("fetchTickers"):
            tickers = client.fetch_tickers(symbols)
            return {
                symbol: float(t["last"])
                for symbol, t in tickers.items()
                if t.get("last") is not None
            }
    except ccxt.BaseError as exc:
        raise MarketDataError(f"Could not fetch prices for {symbols}: {exc}") from exc

    return {symbol: fetch_last_price(symbol) for symbol in symbols}
