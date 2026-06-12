from unittest.mock import patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base, get_db
from backend.db.models import User
from backend.main import app


@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app), TestingSessionLocal
    finally:
        app.dependency_overrides.clear()


def _register(test_client, email):
    res = test_client.post("/auth/register", json={
        "email": email,
        "name": "Test User",
        "password": "testpass123",
        "country": "US",
    })
    assert res.status_code == 200, res.text
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _set_risk_score(session_factory, email, score):
    db = session_factory()
    try:
        user = db.query(User).filter(User.email == email).first()
        user.risk_score = score
        db.commit()
    finally:
        db.close()


def _create_portfolio(test_client, headers, name):
    res = test_client.post("/portfolio/create", json={"name": name}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _add_holding(test_client, headers, portfolio_id, ticker, shares, avg_buy_price):
    res = test_client.post("/portfolio/holdings", json={
        "ticker": ticker,
        "shares": shares,
        "avg_buy_price": avg_buy_price,
        "portfolio_id": portfolio_id,
    }, headers=headers)
    assert res.status_code == 201, res.text


def test_advice_uses_holdings_from_non_first_portfolio(client):
    test_client, session_factory = client
    headers = _register(test_client, "advisor@example.com")
    _set_risk_score(session_factory, "advisor@example.com", 5)

    p1 = _create_portfolio(test_client, headers, "Portfolio 1")
    p2 = _create_portfolio(test_client, headers, "Portfolio 2")
    assert p1 != p2

    # Holdings live only in the second portfolio; the first stays empty.
    _add_holding(test_client, headers, p2, "AAPL", shares=10, avg_buy_price=100.0)

    captured = {}

    def fake_generate_advice(portfolio_summary, risk_score, lang=None):
        captured["summary"] = portfolio_summary
        captured["risk_score"] = risk_score
        return "MOCK ADVICE"

    with patch("backend.api.advice.get_multiple_prices", return_value={"AAPL": {"price": 150.0, "stale": False}}), \
         patch("backend.api.advice.generate_advice", side_effect=fake_generate_advice):
        res = test_client.post("/advice/generate", headers=headers)

    assert res.status_code == 200
    assert res.json()["advice"] == "MOCK ADVICE"
    assert captured["summary"]["AAPL"] == {"shares": 10, "value": 1500.0, "allocation_pct": 100.0}


def test_optimize_aggregated_uses_black_litterman_with_holdings_from_non_first_portfolio(client):
    test_client, session_factory = client
    headers = _register(test_client, "optimizer@example.com")
    _set_risk_score(session_factory, "optimizer@example.com", 5)

    p1 = _create_portfolio(test_client, headers, "Portfolio 1")
    p2 = _create_portfolio(test_client, headers, "Portfolio 2")
    assert p1 != p2

    # Both holdings live only in the second portfolio.
    _add_holding(test_client, headers, p2, "AAPL", shares=10, avg_buy_price=100.0)
    _add_holding(test_client, headers, p2, "MSFT", shares=5, avg_buy_price=200.0)

    portfolios = {p["id"]: p for p in test_client.get("/portfolio/list", headers=headers).json()}
    assert portfolios[p1]["holdings_count"] == 0
    assert portfolios[p2]["holdings_count"] == 2

    dates = pd.date_range("2024-01-01", periods=120, freq="B")

    def fake_history(ticker, period="1y", start_date=None):
        if ticker == "AAPL":
            closes = [100 + i * 0.5 for i in range(120)]
        elif ticker == "MSFT":
            closes = [200 + (i % 10) * 0.8 for i in range(120)]
        else:  # ^GSPC market proxy, used by Black-Litterman to estimate delta
            closes = [4000 + (i % 12) * 3.0 for i in range(120)]
        return pd.DataFrame({"Close": closes, "Volume": [1000] * 120}, index=dates)

    with patch("backend.api.portfolio.get_price_history", side_effect=fake_history), \
         patch("backend.models.bl_optimizer.get_price_history", side_effect=fake_history), \
         patch("backend.models.bl_optimizer.get_market_caps", return_value={"AAPL": 3.0e12, "MSFT": 2.5e12}):
        res = test_client.get("/portfolio/optimize", headers=headers)

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["method"] == "black_litterman"
    assert set(body["weights"].keys()) == {"AAPL", "MSFT"}


def test_optimize_aggregated_black_litterman_falls_back_when_market_data_missing(client):
    test_client, session_factory = client
    headers = _register(test_client, "bl-fallback@example.com")
    _set_risk_score(session_factory, "bl-fallback@example.com", 5)

    p1 = _create_portfolio(test_client, headers, "Portfolio 1")
    _add_holding(test_client, headers, p1, "AAPL", shares=10, avg_buy_price=100.0)
    _add_holding(test_client, headers, p1, "MSFT", shares=5, avg_buy_price=200.0)

    dates = pd.date_range("2024-01-01", periods=120, freq="B")

    def fake_history(ticker, period="1y", start_date=None):
        if ticker == "AAPL":
            closes = [100 + i * 0.5 for i in range(120)]
            return pd.DataFrame({"Close": closes, "Volume": [1000] * 120}, index=dates)
        if ticker == "MSFT":
            closes = [200 + (i % 10) * 0.8 for i in range(120)]
            return pd.DataFrame({"Close": closes, "Volume": [1000] * 120}, index=dates)
        # ^GSPC market proxy unavailable (e.g. yfinance down) for every window
        return pd.DataFrame({"Close": [], "Volume": []})

    with patch("backend.api.portfolio.get_price_history", side_effect=fake_history), \
         patch("backend.models.bl_optimizer.get_price_history", side_effect=fake_history), \
         patch("backend.models.bl_optimizer.get_market_caps", return_value={"AAPL": None, "MSFT": None}):
        res = test_client.get("/portfolio/optimize", headers=headers)

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["method"] == "black_litterman"
    assert set(body["weights"].keys()) == {"AAPL", "MSFT"}
    warnings = " ".join(body.get("warnings", []))
    assert "Market cap unavailable" in warnings
    assert "Market proxy" in warnings


def test_optimize_aggregated_skips_single_unrecoverable_ticker(client):
    """One unfetchable ticker (e.g. an ISIN yfinance can't resolve) must not
    block optimization as long as enough other holdings have valid history."""
    test_client, session_factory = client
    headers = _register(test_client, "bl-skip@example.com")
    _set_risk_score(session_factory, "bl-skip@example.com", 5)

    p1 = _create_portfolio(test_client, headers, "Portfolio 1")
    _add_holding(test_client, headers, p1, "AAPL", shares=10, avg_buy_price=100.0)
    _add_holding(test_client, headers, p1, "MSFT", shares=5, avg_buy_price=200.0)
    _add_holding(test_client, headers, p1, "BADISIN", shares=1, avg_buy_price=50.0)

    dates = pd.date_range("2024-01-01", periods=120, freq="B")

    def fake_history(ticker, period="1y", start_date=None):
        if ticker == "AAPL":
            closes = [100 + i * 0.5 for i in range(120)]
            return pd.DataFrame({"Close": closes, "Volume": [1000] * 120}, index=dates)
        if ticker == "MSFT":
            closes = [200 + (i % 10) * 0.8 for i in range(120)]
            return pd.DataFrame({"Close": closes, "Volume": [1000] * 120}, index=dates)
        if ticker == "BADISIN":
            # yfinance can't resolve this symbol -> empty history, not an exception
            return pd.DataFrame(columns=["Close", "Volume"])
        # ^GSPC market proxy
        closes = [4000 + (i % 12) * 3.0 for i in range(120)]
        return pd.DataFrame({"Close": closes, "Volume": [1000] * 120}, index=dates)

    with patch("backend.api.portfolio.get_price_history", side_effect=fake_history), \
         patch("backend.models.bl_optimizer.get_price_history", side_effect=fake_history), \
         patch("backend.models.bl_optimizer.get_market_caps", return_value={"AAPL": 3.0e12, "MSFT": 2.5e12}):
        res = test_client.get("/portfolio/optimize", headers=headers)

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["method"] == "black_litterman"
    assert set(body["weights"].keys()) == {"AAPL", "MSFT"}


def test_optimize_aggregated_returns_clear_message_when_too_few_valid_tickers(client):
    """With only 1 valid ticker out of 3, the endpoint must return a readable
    400 (the message Portfolio.jsx shows in optError), not a crash."""
    test_client, session_factory = client
    headers = _register(test_client, "bl-toofew@example.com")
    _set_risk_score(session_factory, "bl-toofew@example.com", 5)

    p1 = _create_portfolio(test_client, headers, "Portfolio 1")
    _add_holding(test_client, headers, p1, "AAPL", shares=10, avg_buy_price=100.0)
    _add_holding(test_client, headers, p1, "BADISIN1", shares=1, avg_buy_price=50.0)
    _add_holding(test_client, headers, p1, "BADISIN2", shares=1, avg_buy_price=50.0)

    dates = pd.date_range("2024-01-01", periods=120, freq="B")

    def fake_history(ticker, period="1y", start_date=None):
        if ticker == "AAPL":
            closes = [100 + i * 0.5 for i in range(120)]
            return pd.DataFrame({"Close": closes, "Volume": [1000] * 120}, index=dates)
        return pd.DataFrame(columns=["Close", "Volume"])

    with patch("backend.api.portfolio.get_price_history", side_effect=fake_history):
        res = test_client.get("/portfolio/optimize", headers=headers)

    assert res.status_code == 400
    detail = res.json()["detail"]
    assert detail.startswith("Could not fetch enough price history to optimise.")
    assert "BADISIN1" in detail
    assert "BADISIN2" in detail


def test_optimize_aggregated_no_holdings(client):
    test_client, session_factory = client
    headers = _register(test_client, "empty@example.com")
    _set_risk_score(session_factory, "empty@example.com", 5)
    _create_portfolio(test_client, headers, "Portfolio 1")

    res = test_client.get("/portfolio/optimize", headers=headers)

    assert res.status_code == 400
    assert res.json()["detail"] == "No holdings to optimize"


def test_optimize_by_portfolio_id_still_scoped_to_single_portfolio(client):
    test_client, session_factory = client
    headers = _register(test_client, "legacy@example.com")
    _set_risk_score(session_factory, "legacy@example.com", 5)

    p1 = _create_portfolio(test_client, headers, "Portfolio 1")
    p2 = _create_portfolio(test_client, headers, "Portfolio 2")
    _add_holding(test_client, headers, p2, "AAPL", shares=10, avg_buy_price=100.0)
    _add_holding(test_client, headers, p2, "MSFT", shares=5, avg_buy_price=200.0)

    # The legacy per-portfolio endpoint stays scoped to p1, which is empty.
    res = test_client.get(f"/portfolio/optimize/{p1}", headers=headers)

    assert res.status_code == 400
    assert res.json()["detail"] == "No holdings to optimize"
