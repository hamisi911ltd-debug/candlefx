import time

from app.services import synthetic_market as market


def test_candles_are_deterministic_for_same_seed():
    seed = "abc123"
    start = 1_700_000_000.0
    a = market.get_candles(seed, "SIM-CALM", start, 10, end_tick_index=50)
    b = market.get_candles(seed, "SIM-CALM", start, 10, end_tick_index=50)
    assert a == b


def test_different_seeds_produce_different_paths():
    start = 1_700_000_000.0
    a = market.get_candles("seed-a", "SIM-CALM", start, 10, end_tick_index=50)
    b = market.get_candles("seed-b", "SIM-CALM", start, 10, end_tick_index=50)
    assert a != b


def test_candle_chain_is_continuous():
    candles = market.get_candles("seed", "SIM-STEADY", 1_700_000_000.0, 20, end_tick_index=100)
    for i in range(1, len(candles)):
        assert candles[i]["open"] == candles[i - 1]["close"]


def test_tick_is_closed_only_after_real_time_elapses():
    start = time.time()
    assert not market.tick_is_closed(start, 5)  # tick 5 closes ~10s from now
    assert market.tick_is_closed(start, -1)  # ticks before "now" are already closed


def test_current_tick_index_advances_with_time():
    start = time.time() - market.TICK_SECONDS * 3.5
    assert market.current_tick_index(start) == 3
