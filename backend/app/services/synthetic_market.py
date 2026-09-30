"""A deterministic, seeded synthetic price generator - not real market data.

Each instrument follows a regime-switching random walk: every REGIME_TICKS ticks, a
new drift (trend strength/direction, or flat) is drawn at random and held constant
until the next regime change, with independent Gaussian noise added on top of every
tick. This is what makes it "kinda difficult to predict": pure trend-following breaks
whenever the hidden regime flips, and pure contrarian guessing breaks whenever it
doesn't - there is no fixed exploitable pattern, only a short-lived hidden trend that
occasionally reverses.

Everything here is a pure function of (seed, symbol, tick_index): given the same
inputs it always returns the same candle, with no server-side state to store. Real
time only enters via `current_tick_index`, which is what makes candles "close" - and
therefore become predictable/resolvable - only once real time has actually passed.
"""
import math
import random
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

# Every authenticated request (including this one) pays a D1 lookup in
# get_current_user before the route body even runs, and that round trip to
# Cloudflare's edge occasionally takes several seconds under real network variance -
# independent of anything in this module. TICK_SECONDS needs enough headroom over
# that worst case for "not decided yet" to be meaningful rather than a coin flip
# against request latency.
TICK_SECONDS = 5
REGIME_TICKS = 8  # ~40s per regime at 5s/tick
LOOKBACK_WINDOW = 200  # how far back a candle computation walks before treating price as "settled"

_DRIFT_CHOICES = [-1.0, -0.6, -0.3, 0.0, 0.3, 0.6, 1.0]


@dataclass
class SymbolProfile:
    base_price: float
    drift_scale: float  # per-tick log-return magnitude attributable to the current regime's trend
    volatility: float  # per-tick Gaussian noise stddev (log-return)


SYMBOL_PROFILES: dict[str, SymbolProfile] = {
    "SIM-CALM": SymbolProfile(base_price=100.0, drift_scale=0.0015, volatility=0.004),
    "SIM-STEADY": SymbolProfile(base_price=250.0, drift_scale=0.0025, volatility=0.007),
    "SIM-WILD": SymbolProfile(base_price=50.0, drift_scale=0.004, volatility=0.014),
}


class SyntheticMarketError(Exception):
    pass


def _rng(*parts) -> random.Random:
    return random.Random("|".join(str(p) for p in parts))


def current_tick_index(start_time: float) -> int:
    return math.floor((time.time() - start_time) / TICK_SECONDS)


def tick_is_closed(start_time: float, tick_index: int) -> bool:
    return time.time() >= start_time + (tick_index + 1) * TICK_SECONDS


def seconds_until_closed(start_time: float, tick_index: int) -> float:
    return max(0.0, (start_time + (tick_index + 1) * TICK_SECONDS) - time.time())


def tick_timestamp(start_time: float, tick_index: int) -> datetime:
    return datetime.fromtimestamp(start_time, tz=timezone.utc) + timedelta(seconds=tick_index * TICK_SECONDS)


def _regime_drift(seed: str, symbol: str, regime_index: int, drift_scale: float) -> float:
    rng = _rng(seed, symbol, "regime", regime_index)
    return rng.choice(_DRIFT_CHOICES) * drift_scale


def _tick_log_return(seed: str, symbol: str, tick_index: int, profile: SymbolProfile) -> float:
    regime_index = tick_index // REGIME_TICKS
    drift = _regime_drift(seed, symbol, regime_index, profile.drift_scale)
    noise = _rng(seed, symbol, "tick", tick_index).gauss(0, profile.volatility)
    return drift + noise


def get_candles(seed: str, symbol: str, start_time: float, count: int, end_tick_index: int) -> list[dict]:
    """Returns `count` candles ending at (and including) end_tick_index. Only ever
    call this with an end_tick_index that has already closed (see tick_is_closed) -
    otherwise you're asking for a candle that hasn't "happened" yet."""
    profile = SYMBOL_PROFILES.get(symbol)
    if profile is None:
        raise SyntheticMarketError(f"Unknown symbol '{symbol}'")

    window = max(count + 5, LOOKBACK_WINDOW)
    path_start = end_tick_index - window + 1

    price = profile.base_price
    candles = []
    idx = path_start
    while idx <= end_tick_index:
        ret = _tick_log_return(seed, symbol, idx, profile)
        open_price = price
        close_price = price * math.exp(ret)
        wiggle = _rng(seed, symbol, "wiggle", idx).gauss(0, profile.volatility / 2)
        high = max(open_price, close_price) * (1 + abs(wiggle))
        low = min(open_price, close_price) * (1 - abs(wiggle))
        candles.append({
            "tick_index": idx,
            "timestamp": tick_timestamp(start_time, idx).isoformat(),
            "open": round(open_price, 4),
            "high": round(high, 4),
            "low": round(low, 4),
            "close": round(close_price, 4),
            "volume": 0.0,
        })
        price = close_price
        idx += 1

    return candles[-count:]


def get_candle(seed: str, symbol: str, start_time: float, tick_index: int) -> dict:
    return get_candles(seed, symbol, start_time, count=1, end_tick_index=tick_index)[0]
