"""Public forex rate data via the Frankfurter API (ECB reference rates - free, no key).

Frankfurter only publishes one rate per business day (no intraday OHLC), so daily bars
here use that single rate for open/high/low/close. This is a real, live data source -
just lower resolution than crypto's minute-level candles. Good enough for a daily-bar
forex paper-trading view; a real trading terminal would use a paid tick-data feed.
"""
from datetime import datetime, timedelta, timezone

import httpx
import pandas as pd

FOREX_PAIRS = {"EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CHF", "USD/CAD", "NZD/USD", "EUR/GBP"}

_BASE_URL = "https://api.frankfurter.dev/v1"


class ForexDataError(Exception):
    pass


def _split(symbol: str) -> tuple[str, str]:
    base, quote = symbol.split("/")
    return base.upper(), quote.upper()


def fetch_last_price(symbol: str) -> float:
    base, quote = _split(symbol)
    try:
        resp = httpx.get(f"{_BASE_URL}/latest", params={"from": base, "to": quote}, timeout=10.0, follow_redirects=True)
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as exc:
        raise ForexDataError(f"Could not fetch forex rate for {symbol}: {exc}") from exc

    rate = data.get("rates", {}).get(quote)
    if rate is None:
        raise ForexDataError(f"No rate available for {symbol}")
    return float(rate)


def fetch_last_prices(symbols: list[str]) -> dict[str, float]:
    result = {}
    for symbol in symbols:
        try:
            result[symbol] = fetch_last_price(symbol)
        except ForexDataError:
            continue
    return result


def fetch_ohlcv(symbol: str, timeframe: str = "1d", limit: int = 200) -> pd.DataFrame:
    base, quote = _split(symbol)
    end = datetime.now(timezone.utc).date()
    # Frankfurter is business-days-only; pad the window so `limit` bars actually come back.
    start = end - timedelta(days=int(limit * 1.6) + 5)

    try:
        resp = httpx.get(
            f"{_BASE_URL}/{start.isoformat()}..{end.isoformat()}",
            params={"from": base, "to": quote},
            timeout=15.0, follow_redirects=True,
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as exc:
        raise ForexDataError(f"Could not fetch forex history for {symbol}: {exc}") from exc

    rates = data.get("rates", {})
    rows = []
    for date_str in sorted(rates.keys())[-limit:]:
        rate = rates[date_str].get(quote)
        if rate is None:
            continue
        rows.append({
            "timestamp": pd.Timestamp(date_str, tz="UTC"),
            "open": rate, "high": rate, "low": rate, "close": rate, "volume": 0.0,
        })

    if not rows:
        raise ForexDataError(f"No historical rates available for {symbol}")
    return pd.DataFrame(rows)
