from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_market_history_returns_404_not_500_for_invalid_ticker():
    """An unrecognised ticker (e.g. an ISIN passed by mistake) must return a
    handled 404, not a 500 with a yfinance traceback."""
    with patch("backend.services.market_data._av_get_history", return_value=None), \
         patch("backend.services.market_data.yf.Ticker") as MockTicker:
        MockTicker.return_value.history.side_effect = Exception("Invalid ISIN number")
        res = client.get("/market/history/US0000000000")

    assert res.status_code == 404
    assert res.json()["detail"] == "Price history not available for US0000000000"


def test_market_history_returns_404_when_ticker_constructor_raises():
    """Same failure mode, but the exception is raised at yf.Ticker(ticker)
    construction itself (before .history() is called)."""
    with patch("backend.services.market_data._av_get_history", return_value=None), \
         patch("backend.services.market_data.yf.Ticker", side_effect=ValueError("Invalid ISIN number")):
        res = client.get("/market/history/US0000000000")

    assert res.status_code == 404
    assert res.json()["detail"] == "Price history not available for US0000000000"


def test_market_history_returns_data_for_valid_ticker():
    import pandas as pd

    dates = pd.date_range("2024-01-01", periods=5, freq="B")
    fake_hist = pd.DataFrame({"Close": [100, 101, 102, 103, 104], "Volume": [1000] * 5}, index=dates)

    with patch("backend.services.market_data._av_get_history", return_value=None), \
         patch("backend.services.market_data.yf.Ticker") as MockTicker:
        MockTicker.return_value.history.return_value = fake_hist
        res = client.get("/market/history/AAPL")

    assert res.status_code == 200
    body = res.json()
    assert body["ticker"] == "AAPL"
    assert len(body["data"]) == 5
