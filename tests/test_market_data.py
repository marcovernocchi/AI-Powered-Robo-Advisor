from unittest.mock import patch
from backend.services.market_data import get_stock_info, get_multiple_prices


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
