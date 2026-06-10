"""
Tests for optimize_black_litterman.

All tests use internally-generated price data — no real network calls.
get_market_caps and get_price_history (used for the ^GSPC proxy) are mocked
at the bl_optimizer module level so the mocks take effect wherever the
names are resolved.
"""

import numpy as np
import pandas as pd
from unittest.mock import patch

from backend.models.bl_optimizer import optimize_black_litterman, _weights_from_caps


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _make_prices(n_assets: int = 3, n_days: int = 300, seed: int = 42) -> pd.DataFrame:
    """Synthetic daily close prices — deterministic via seed."""
    np.random.seed(seed)
    dates = pd.date_range("2023-01-01", periods=n_days, freq="B")
    tickers = ["AAPL", "MSFT", "GOOGL"][:n_assets]
    data = {t: 100.0 * (1 + np.random.randn(n_days) * 0.012).cumprod() for t in tickers}
    return pd.DataFrame(data, index=dates)


def _make_proxy_df(n_days: int = 252, seed: int = 7) -> pd.DataFrame:
    """
    Synthetic S&P 500-like proxy (drift=0.0002/day ≈ 5% ann., std=0.008).
    Expected delta ≈ 3.2 — likely within [1, 5] but subject to sample noise.
    Tests are written to pass regardless of whether delta is clamped.
    """
    np.random.seed(seed)
    dates = pd.date_range("2023-01-01", periods=n_days, freq="B")
    daily = 0.0002 + 0.008 * np.random.randn(n_days)
    close = pd.Series(4000.0 * np.exp(np.cumsum(daily)), index=dates)
    return pd.DataFrame({"Close": close, "Volume": 1_000_000}, index=dates)


def _make_high_delta_proxy(n_days: int = 252) -> pd.DataFrame:
    """Proxy with extreme drift (≈65% ann.) → delta always >> 5, always triggers clamp."""
    np.random.seed(99)
    dates = pd.date_range("2023-01-01", periods=n_days, freq="B")
    daily = 0.002 + 0.008 * np.random.randn(n_days)
    close = pd.Series(4000.0 * np.exp(np.cumsum(daily)), index=dates)
    return pd.DataFrame({"Close": close, "Volume": 1_000_000}, index=dates)


_CAPS_OK = {"AAPL": 3.0e12, "MSFT": 2.5e12, "GOOGL": 1.8e12}
_CAPS_ALL_NONE = {"AAPL": None, "MSFT": None, "GOOGL": None}
_CAPS_PARTIAL = {"AAPL": 3.0e12, "MSFT": None, "GOOGL": 1.8e12}

# Pre-compute expected prior weights for _CAPS_PARTIAL (n=3, MSFT missing):
#   MSFT = 1/3 (equal share)
#   AAPL = (3T / 4.8T) * (2/3) ≈ 0.4167
#   GOOGL = (1.8T / 4.8T) * (2/3) ≈ 0.25
_PARTIAL_PRIOR = {
    "AAPL":  (3.0e12 / (3.0e12 + 1.8e12)) * (2.0 / 3),
    "MSFT":  1.0 / 3,
    "GOOGL": (1.8e12 / (3.0e12 + 1.8e12)) * (2.0 / 3),
}


# ---------------------------------------------------------------------------
# (a) BL with market caps available — happy path
# ---------------------------------------------------------------------------

@patch("backend.models.bl_optimizer.get_price_history", return_value=_make_proxy_df())
@patch("backend.models.bl_optimizer.get_market_caps", return_value=_CAPS_OK)
def test_bl_with_market_caps(mock_mc, mock_ph):
    prices = _make_prices()
    result = optimize_black_litterman(prices, risk_score=5)

    assert result.get("method") == "black_litterman"
    assert "weights" in result
    assert "expected_annual_return_pct" in result
    assert "annual_volatility_pct" in result
    assert "sharpe_ratio" in result
    assert abs(sum(result["weights"].values()) - 1.0) < 0.01

    # No equal-weight market-cap fallback when all caps are available
    for w in result.get("warnings", []):
        assert "equal-weight share" not in w

    mock_mc.assert_called_once()
    # _compute_delta tries "5y" first; proxy has 252 rows → succeeds in one call
    mock_ph.assert_called_once_with("^GSPC", period="5y")


@patch("backend.models.bl_optimizer.get_price_history", return_value=_make_proxy_df())
@patch("backend.models.bl_optimizer.get_market_caps", return_value=_CAPS_OK)
def test_bl_weights_sum_to_one(mock_mc, mock_ph):
    result = optimize_black_litterman(_make_prices(), risk_score=5)
    assert abs(sum(result["weights"].values()) - 1.0) < 0.01


@patch("backend.models.bl_optimizer.get_price_history", return_value=_make_proxy_df())
@patch("backend.models.bl_optimizer.get_market_caps", return_value=_CAPS_OK)
def test_bl_output_keys_match_optimize_portfolio(mock_mc, mock_ph):
    """Output schema must be a strict superset of optimize_portfolio."""
    result = optimize_black_litterman(_make_prices(), risk_score=5)
    for key in ("weights", "expected_annual_return_pct", "annual_volatility_pct", "sharpe_ratio"):
        assert key in result, f"missing key: {key}"


# ---------------------------------------------------------------------------
# (b) Fix 2 — output types must be native Python float, not np.float64
# ---------------------------------------------------------------------------

@patch("backend.models.bl_optimizer.get_price_history", return_value=_make_proxy_df())
@patch("backend.models.bl_optimizer.get_market_caps", return_value=_CAPS_OK)
def test_bl_output_types_are_native_float(mock_mc, mock_ph):
    """Numeric values must be json-serialisable native float, not np.float64."""
    result = optimize_black_litterman(_make_prices(), risk_score=5)
    assert type(result["expected_annual_return_pct"]) is float, (
        f"expected float, got {type(result['expected_annual_return_pct'])}"
    )
    assert type(result["annual_volatility_pct"]) is float
    assert type(result["sharpe_ratio"]) is float
    for ticker, v in result["weights"].items():
        assert type(v) is float, f"weight for {ticker} is {type(v).__name__}, expected float"


# ---------------------------------------------------------------------------
# (c) Fix 3 — partial market-cap fallback (mixed cap + equal-weight)
# ---------------------------------------------------------------------------

@patch("backend.models.bl_optimizer.get_price_history", return_value=_make_proxy_df())
@patch("backend.models.bl_optimizer.get_market_caps", return_value=_CAPS_ALL_NONE)
def test_bl_fallback_all_caps_missing(mock_mc, mock_ph):
    result = optimize_black_litterman(_make_prices(), risk_score=5)

    assert result.get("method") == "black_litterman"
    assert "warnings" in result
    assert any("equal-weight share" in w for w in result["warnings"]), (
        "Expected 'equal-weight share' in warning when all caps are None; "
        f"got: {result['warnings']}"
    )
    assert abs(sum(result["weights"].values()) - 1.0) < 0.01


@patch("backend.models.bl_optimizer.get_price_history", return_value=_make_proxy_df())
@patch("backend.models.bl_optimizer.get_market_caps", return_value=_CAPS_PARTIAL)
def test_bl_partial_caps_warning_names_missing_ticker(mock_mc, mock_ph):
    """Warning must name the specific missing ticker (MSFT), not say 'all tickers'."""
    result = optimize_black_litterman(_make_prices(), risk_score=5)

    assert result.get("method") == "black_litterman"
    assert "warnings" in result
    assert any("MSFT" in w for w in result["warnings"]), (
        f"Warning should name 'MSFT'; got: {result['warnings']}"
    )
    assert any("equal-weight share" in w for w in result["warnings"])
    assert abs(sum(result["weights"].values()) - 1.0) < 0.01


def test_bl_partial_caps_prior_weight_math():
    """
    Unit-test _weights_from_caps directly.
    With AAPL=3T, MSFT=None, GOOGL=1.8T (n=3):
      MSFT = 1/3
      AAPL = (3T / 4.8T) * (2/3) ≈ 0.4167
      GOOGL = (1.8T / 4.8T) * (2/3) = 0.25
    Verifies sum=1 and exact per-ticker values.
    """
    w = _weights_from_caps(["AAPL", "MSFT", "GOOGL"], _CAPS_PARTIAL)
    assert abs(w.sum() - 1.0) < 1e-9
    for ticker, expected in _PARTIAL_PRIOR.items():
        assert abs(w[ticker] - expected) < 1e-9, (
            f"{ticker}: expected {expected:.6f}, got {w[ticker]:.6f}"
        )


# ---------------------------------------------------------------------------
# (d) Fix 1 — delta clamping outside [1, 5]
# ---------------------------------------------------------------------------

@patch("backend.models.bl_optimizer.get_price_history", return_value=_make_high_delta_proxy())
@patch("backend.models.bl_optimizer.get_market_caps", return_value=_CAPS_OK)
def test_bl_delta_clamped_when_out_of_range(mock_mc, mock_ph):
    """
    High-drift proxy → delta ≈ 40 >> 5.
    Must clamp to default 2.5, add a warning mentioning 'outside plausible range'
    and 'delta', and still produce a valid result.
    """
    result = optimize_black_litterman(_make_prices(), risk_score=5)

    assert result.get("method") == "black_litterman"
    assert "warnings" in result
    clamp_warnings = [
        w for w in result["warnings"]
        if "outside plausible range" in w and "delta" in w
    ]
    assert clamp_warnings, (
        f"Expected clamped-delta warning; got: {result['warnings']}"
    )
    assert abs(sum(result["weights"].values()) - 1.0) < 0.01


# ---------------------------------------------------------------------------
# (e) Views
# ---------------------------------------------------------------------------

@patch("backend.models.bl_optimizer.get_price_history", return_value=_make_proxy_df())
@patch("backend.models.bl_optimizer.get_market_caps", return_value=_CAPS_OK)
def test_bl_with_views_runs_without_error(mock_mc, mock_ph):
    views = {"AAPL": 0.20}
    view_confidences = {"AAPL": 0.80}
    result = optimize_black_litterman(
        _make_prices(), risk_score=5, views=views, view_confidences=view_confidences
    )
    assert result.get("method") == "black_litterman"
    assert abs(sum(result["weights"].values()) - 1.0) < 0.01


@patch("backend.models.bl_optimizer.get_price_history", return_value=_make_proxy_df())
@patch("backend.models.bl_optimizer.get_market_caps", return_value=_CAPS_OK)
def test_bl_view_tilts_weight_toward_bullish_asset(mock_mc, mock_ph):
    """Strongly bullish AAPL view must not decrease AAPL's allocation."""
    no_view_result = optimize_black_litterman(_make_prices(seed=1), risk_score=5)
    view_result = optimize_black_litterman(
        _make_prices(seed=1), risk_score=5,
        views={"AAPL": 0.40}, view_confidences={"AAPL": 0.90},
    )
    aapl_no_view = no_view_result["weights"].get("AAPL", 0)
    aapl_with_view = view_result["weights"].get("AAPL", 0)
    assert aapl_with_view >= aapl_no_view, (
        f"Bullish view should not reduce AAPL weight "
        f"({aapl_with_view:.3f} < {aapl_no_view:.3f})"
    )


@patch("backend.models.bl_optimizer.get_price_history", return_value=_make_proxy_df())
@patch("backend.models.bl_optimizer.get_market_caps", return_value=_CAPS_OK)
def test_bl_views_without_confidences(mock_mc, mock_ph):
    """Views without confidences must use omega='default' and not raise."""
    result = optimize_black_litterman(
        _make_prices(), risk_score=5, views={"MSFT": 0.15}
    )
    assert result.get("method") == "black_litterman"


# ---------------------------------------------------------------------------
# (f) Market proxy fallback (delta fallback)
# ---------------------------------------------------------------------------

@patch("backend.models.bl_optimizer.get_price_history", side_effect=Exception("network error"))
@patch("backend.models.bl_optimizer.get_market_caps", return_value=_CAPS_OK)
def test_bl_proxy_failure_uses_default_delta(mock_mc, mock_ph):
    """All proxy windows fail → BL must still complete and warn about delta."""
    result = optimize_black_litterman(_make_prices(), risk_score=5)

    assert result.get("method") == "black_litterman"
    assert "warnings" in result
    assert any("delta" in w for w in result["warnings"]), (
        f"Expected delta warning when proxy fails; got: {result['warnings']}"
    )
    assert abs(sum(result["weights"].values()) - 1.0) < 0.01


@patch("backend.models.bl_optimizer.get_price_history", return_value=pd.DataFrame())
@patch("backend.models.bl_optimizer.get_market_caps", return_value=_CAPS_OK)
def test_bl_proxy_empty_df_uses_default_delta(mock_mc, mock_ph):
    """Empty proxy DataFrame across all windows triggers delta fallback."""
    result = optimize_black_litterman(_make_prices(), risk_score=5)
    assert any("delta" in w for w in result.get("warnings", []))


# ---------------------------------------------------------------------------
# (g) risk_score routing
# ---------------------------------------------------------------------------

@patch("backend.models.bl_optimizer.get_price_history", return_value=_make_proxy_df())
@patch("backend.models.bl_optimizer.get_market_caps", return_value=_CAPS_OK)
def test_bl_conservative_lower_vol_than_aggressive(mock_mc, mock_ph):
    prices = _make_prices()
    conservative = optimize_black_litterman(prices, risk_score=2)
    aggressive = optimize_black_litterman(prices, risk_score=9)
    assert conservative["annual_volatility_pct"] <= aggressive["annual_volatility_pct"]


# ---------------------------------------------------------------------------
# (h) insufficient history guard
# ---------------------------------------------------------------------------

@patch("backend.models.bl_optimizer.get_price_history", return_value=_make_proxy_df())
@patch("backend.models.bl_optimizer.get_market_caps", return_value=_CAPS_OK)
def test_bl_insufficient_history_returns_error(mock_mc, mock_ph):
    short_prices = _make_prices(n_days=30)   # below MIN_HISTORY_DAYS=60
    result = optimize_black_litterman(short_prices, risk_score=5)
    assert "error" in result
    assert "method" not in result
