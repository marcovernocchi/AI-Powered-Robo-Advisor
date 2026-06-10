from unittest.mock import patch
from backend.services.market_data import get_stock_info, get_multiple_prices, get_price_history


def test_get_stock_info_structure():
    mock_info = {
        "longName": "Apple Inc.",
        "sector": "Technology",
        "marketCap": 3_000_000_000_000,
        "trailingPE": 29.5,
        "fiftyTwoWeekHigh": 200.0,
        "fiftyTwoWeekLow": 150.0,
    }
    with patch("backend.services.market_data.yf.Ticker") as MockTicker:
        MockTicker.return_value.info = mock_info
        info = get_stock_info("AAPL")

    assert info["name"] == "Apple Inc."
    assert info["sector"] == "Technology"
    assert info["pe_ratio"] == 29.5
    assert "52w_high" in info


def test_get_multiple_prices_handles_errors():
    with patch("backend.services.market_data._fetch_live_price", return_value=None):
        with patch("backend.services.market_data._get_price_cache", return_value=(None, False, True)):
            result = get_multiple_prices(["AAPL"])
    assert result["AAPL"]["price"] is None


def test_get_price_history_returns_empty_df_for_unrecoverable_ticker():
    """An invalid symbol/ISIN should yield an empty DataFrame, not raise."""
    with patch("backend.services.market_data._av_get_history", return_value=None), \
         patch("backend.services.market_data.yf.Ticker") as MockTicker:
        MockTicker.return_value.history.side_effect = Exception("Invalid ISIN number")
        hist = get_price_history("US0000000000")

    assert hist.empty
    assert list(hist.columns) == ["Close", "Volume"]


def test_get_price_history_returns_empty_df_when_ticker_constructor_raises():
    """yfinance can raise (e.g. "Invalid ISIN number") as soon as Ticker(ticker)
    is constructed, before .history() is even called."""
    with patch("backend.services.market_data._av_get_history", return_value=None), \
         patch("backend.services.market_data.yf.Ticker", side_effect=ValueError("Invalid ISIN number")):
        hist = get_price_history("US0000000000")

    assert hist.empty
    assert list(hist.columns) == ["Close", "Volume"]
