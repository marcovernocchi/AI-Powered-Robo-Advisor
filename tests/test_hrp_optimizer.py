"""
Tests for optimize_hrp.

All tests use internally-generated price data — no network calls.
HRP is a pure computation (no LLM, no market data service).
"""

import numpy as np
import pandas as pd

from backend.models.hrp_optimizer import optimize_hrp


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_prices(n_assets: int = 3, n_days: int = 300, seed: int = 42) -> pd.DataFrame:
    np.random.seed(seed)
    dates = pd.date_range("2023-01-01", periods=n_days, freq="B")
    tickers = ["AAPL", "MSFT", "GOOGL"][:n_assets]
    data = {t: 100.0 * (1 + np.random.randn(n_days) * 0.012).cumprod() for t in tickers}
    return pd.DataFrame(data, index=dates)


# ---------------------------------------------------------------------------
# (a) Output schema
# ---------------------------------------------------------------------------

def test_hrp_returns_correct_keys():
    result = optimize_hrp(_make_prices(), risk_score=5)
    for key in ("weights", "expected_annual_return_pct", "annual_volatility_pct", "sharpe_ratio"):
        assert key in result, f"missing key: {key}"
    assert result.get("method") == "hrp"


def test_hrp_weights_sum_to_one():
    result = optimize_hrp(_make_prices(), risk_score=5)
    assert abs(sum(result["weights"].values()) - 1.0) < 0.01


def test_hrp_all_weights_non_negative():
    result = optimize_hrp(_make_prices(), risk_score=5)
    for ticker, w in result["weights"].items():
        assert w >= 0, f"negative weight for {ticker}: {w}"


# ---------------------------------------------------------------------------
# (b) Output types — native float, not np.float64
# ---------------------------------------------------------------------------

def test_hrp_output_types_are_native_float():
    result = optimize_hrp(_make_prices(), risk_score=5)
    assert type(result["expected_annual_return_pct"]) is float
    assert type(result["annual_volatility_pct"]) is float
    assert type(result["sharpe_ratio"]) is float
    for ticker, v in result["weights"].items():
        assert type(v) is float, f"weight for {ticker} is {type(v).__name__}, expected float"


# ---------------------------------------------------------------------------
# (c) risk_score is ignored by HRP (but must be accepted without error)
# ---------------------------------------------------------------------------

def test_hrp_accepts_any_risk_score():
    prices = _make_prices()
    for score in (1, 5, 10):
        result = optimize_hrp(prices, risk_score=score)
        assert result.get("method") == "hrp"


def test_hrp_produces_same_weights_regardless_of_risk_score():
    """HRP doesn't use risk_score — weights must be identical for all scores."""
    prices = _make_prices()
    result_conservative = optimize_hrp(prices, risk_score=1)
    result_aggressive   = optimize_hrp(prices, risk_score=10)
    assert result_conservative["weights"] == result_aggressive["weights"]


# ---------------------------------------------------------------------------
# (d) Diversification — HRP should not concentrate in a single asset
# ---------------------------------------------------------------------------

def test_hrp_weights_are_diversified():
    """With 3 assets, no single asset should capture > 80% of the portfolio."""
    result = optimize_hrp(_make_prices(), risk_score=5)
    for ticker, w in result["weights"].items():
        assert w < 0.80, f"HRP over-concentrated in {ticker}: {w:.1%}"


# ---------------------------------------------------------------------------
# (e) Insufficient history guard
# ---------------------------------------------------------------------------

def test_hrp_insufficient_history_returns_error():
    short_prices = _make_prices(n_days=30)   # below MIN_HISTORY_DAYS=60
    result = optimize_hrp(short_prices, risk_score=5)
    assert "error" in result
    assert "method" not in result


def test_hrp_exactly_two_valid_tickers():
    """Two tickers is the minimum — must succeed, not error."""
    result = optimize_hrp(_make_prices(n_assets=2), risk_score=5)
    assert result.get("method") == "hrp"
    assert len([k for k, v in result["weights"].items() if v > 0]) >= 1


# ---------------------------------------------------------------------------
# (f) Excluded-history warning
# ---------------------------------------------------------------------------

def test_hrp_warns_on_excluded_ticker():
    prices = _make_prices(n_days=300)
    # Inject a ticker with only 10 rows of valid data
    prices["SHORT"] = float("nan")
    prices.loc[prices.index[-10:], "SHORT"] = 100.0

    result = optimize_hrp(prices, risk_score=5)
    assert result.get("method") == "hrp"
    assert "warnings" in result
    assert any("SHORT" in w for w in result["warnings"])
    assert "SHORT" not in result["weights"]
