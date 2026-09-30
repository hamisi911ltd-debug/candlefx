from app.services import market_router


def test_is_forex_recognizes_known_pairs():
    assert market_router.is_forex("EUR/USD")
    assert market_router.is_forex("eur/usd")
    assert not market_router.is_forex("BTC/USDT")


def test_fetch_last_price_routes_forex_pairs(monkeypatch):
    monkeypatch.setattr(market_router.forex_data, "fetch_last_price", lambda s: 1.2345)
    price = market_router.fetch_last_price("EUR/USD")
    assert price == 1.2345


def test_fetch_last_price_routes_crypto_pairs(monkeypatch):
    monkeypatch.setattr(market_router.market_data, "fetch_last_price", lambda s: 50000.0)
    price = market_router.fetch_last_price("BTC/USDT")
    assert price == 50000.0


def test_fetch_last_prices_splits_by_market(monkeypatch):
    monkeypatch.setattr(market_router.forex_data, "fetch_last_prices", lambda syms: {s: 1.1 for s in syms})
    monkeypatch.setattr(market_router.market_data, "fetch_last_prices", lambda syms: {s: 100.0 for s in syms})

    result = market_router.fetch_last_prices(["EUR/USD", "BTC/USDT"])
    assert result == {"EUR/USD": 1.1, "BTC/USDT": 100.0}
