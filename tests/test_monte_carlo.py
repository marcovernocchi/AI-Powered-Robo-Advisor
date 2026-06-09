"""Unit tests for the Monte Carlo simulation engine.

Uses synthetic price data so no network calls are needed.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from unittest.mock import patch

from backend.monte_carlo.schemas import AssetOverride, MonteCarloInput
from backend.monte_carlo.simulator import _estimate_expected_returns, _apply_volatility_overrides, run_monte_carlo


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_prices(tickers: list[str], n_days: int = 1500, seed: int = 42) -> pd.DataFrame:
    """Return a DataFrame of synthetic prices with realistic log-normal dynamics."""
    rng = np.random.default_rng(seed)
    # Daily log-returns: mean ~6% ann, vol ~15% ann
    mu = 0.06 / 252
    sigma = 0.15 / np.sqrt(252)
    log_ret = rng.normal(mu, sigma, size=(n_days, len(tickers)))
    prices = 100 * np.exp(np.cumsum(log_ret, axis=0))
    idx = pd.date_range("2019-01-01", periods=n_days, freq="B")
    return pd.DataFrame(prices, index=idx, columns=tickers)


def _patch_loader(prices: pd.DataFrame):
    """Patch load_prices to return synthetic data."""
    return patch(
        "backend.monte_carlo.simulator.load_prices",
        return_value=(prices, []),
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def simple_params():
    return MonteCarloInput(
        weights={"VWCE": 0.6, "AGGH": 0.4},
        initial_capital=10_000.0,
        horizon_years=10,
        n_simulations=500,
        monthly_contribution=0.0,
        target_value=None,
        lookback_years=5,
    )


@pytest.fixture
def prices_2asset():
    return _make_prices(["VWCE", "AGGH"])


# ---------------------------------------------------------------------------
# Schema validation tests
# ---------------------------------------------------------------------------

def test_weights_must_sum_to_one():
    with pytest.raises(Exception, match="weights must sum"):
        MonteCarloInput(weights={"A": 0.5, "B": 0.3}, initial_capital=1000, horizon_years=5, n_simulations=100)


def test_n_simulations_capped():
    p = MonteCarloInput(weights={"A": 1.0}, initial_capital=1000, horizon_years=5, n_simulations=99_999)
    assert p.n_simulations == 10_000


def test_n_simulations_minimum():
    with pytest.raises(Exception):
        MonteCarloInput(weights={"A": 1.0}, initial_capital=1000, horizon_years=5, n_simulations=5)


def test_horizon_bounds():
    with pytest.raises(Exception):
        MonteCarloInput(weights={"A": 1.0}, initial_capital=1000, horizon_years=0, n_simulations=100)
    with pytest.raises(Exception):
        MonteCarloInput(weights={"A": 1.0}, initial_capital=1000, horizon_years=51, n_simulations=100)


# ---------------------------------------------------------------------------
# Simulation correctness tests
# ---------------------------------------------------------------------------

def test_percentiles_are_ordered(simple_params, prices_2asset):
    rng = np.random.default_rng(42)
    with _patch_loader(prices_2asset):
        result = run_monte_carlo(simple_params, rng=rng)

    for i in range(len(result.time_labels)):
        p5  = result.percentiles.p5[i]
        p25 = result.percentiles.p25[i]
        p50 = result.percentiles.p50[i]
        p75 = result.percentiles.p75[i]
        p95 = result.percentiles.p95[i]
        assert p5 <= p25 <= p50 <= p75 <= p95, (
            f"Percentile ordering violated at step {i}: {p5} {p25} {p50} {p75} {p95}"
        )


def test_t0_equals_initial_capital(simple_params, prices_2asset):
    rng = np.random.default_rng(42)
    with _patch_loader(prices_2asset):
        result = run_monte_carlo(simple_params, rng=rng)

    # All percentile series should start at initial_capital
    ic = simple_params.initial_capital
    for series in [result.percentiles.p5, result.percentiles.p25,
                   result.percentiles.p50, result.percentiles.p75,
                   result.percentiles.p95]:
        assert abs(series[0] - ic) < 1.0, f"t=0 value {series[0]} != initial_capital {ic}"


def test_median_final_positive():
    """With strongly positive historical returns the median final value should exceed initial capital."""
    # Build prices with a guaranteed upward trend (~10% ann)
    rng_data = np.random.default_rng(99)
    n_days = 1500
    mu = 0.10 / 252
    sigma = 0.12 / np.sqrt(252)
    log_ret = rng_data.normal(mu, sigma, size=(n_days, 2))
    prices = 100 * np.exp(np.cumsum(log_ret, axis=0))
    idx = pd.date_range("2019-01-01", periods=n_days, freq="B")
    prices_df = pd.DataFrame(prices, index=idx, columns=["VWCE", "AGGH"])

    params = MonteCarloInput(
        weights={"VWCE": 0.6, "AGGH": 0.4},
        initial_capital=10_000.0,
        horizon_years=10,
        n_simulations=500,
    )
    rng = np.random.default_rng(42)
    with _patch_loader(prices_df):
        result = run_monte_carlo(params, rng=rng)

    assert result.median_final > params.initial_capital


def test_mean_close_to_median_many_simulations(prices_2asset):
    """With many simulations, mean and median should converge within 50% of each other."""
    params = MonteCarloInput(
        weights={"VWCE": 0.6, "AGGH": 0.4},
        initial_capital=10_000.0,
        horizon_years=10,
        n_simulations=5000,
        monthly_contribution=0.0,
    )
    rng = np.random.default_rng(0)
    with _patch_loader(prices_2asset):
        result = run_monte_carlo(params, rng=rng)

    ratio = result.mean_final / result.median_final
    # mean >= median (log-normal) but should not be wildly off
    assert 1.0 <= ratio <= 3.0, f"mean/median ratio {ratio:.2f} looks unreasonable"


def test_monthly_contribution_increases_final_value(prices_2asset):
    base_params = MonteCarloInput(
        weights={"VWCE": 0.6, "AGGH": 0.4},
        initial_capital=10_000.0,
        horizon_years=10,
        n_simulations=500,
        monthly_contribution=0.0,
    )
    contrib_params = MonteCarloInput(
        weights={"VWCE": 0.6, "AGGH": 0.4},
        initial_capital=10_000.0,
        horizon_years=10,
        n_simulations=500,
        monthly_contribution=200.0,
    )
    rng_base = np.random.default_rng(7)
    rng_contrib = np.random.default_rng(7)
    with _patch_loader(prices_2asset):
        result_base = run_monte_carlo(base_params, rng=rng_base)
        result_contrib = run_monte_carlo(contrib_params, rng=rng_contrib)

    assert result_contrib.median_final > result_base.median_final


def test_prob_target_between_0_and_1(prices_2asset):
    params = MonteCarloInput(
        weights={"VWCE": 0.6, "AGGH": 0.4},
        initial_capital=10_000.0,
        horizon_years=10,
        n_simulations=500,
        target_value=50_000.0,
    )
    rng = np.random.default_rng(42)
    with _patch_loader(prices_2asset):
        result = run_monte_carlo(params, rng=rng)

    assert result.prob_target is not None
    assert 0.0 <= result.prob_target <= 1.0


def test_certain_target_gives_prob_one(prices_2asset):
    """A target well below the initial capital (already reached) should give prob ≈ 1."""
    params = MonteCarloInput(
        weights={"VWCE": 0.6, "AGGH": 0.4},
        initial_capital=100_000.0,
        horizon_years=10,
        n_simulations=200,
        target_value=1.0,   # trivially achievable
    )
    rng = np.random.default_rng(42)
    with _patch_loader(prices_2asset):
        result = run_monte_carlo(params, rng=rng)

    assert result.prob_target == pytest.approx(1.0, abs=0.01)


def test_impossible_target_gives_prob_zero(prices_2asset):
    """A target absurdly above any realistic outcome should give prob ≈ 0."""
    params = MonteCarloInput(
        weights={"VWCE": 0.6, "AGGH": 0.4},
        initial_capital=1_000.0,
        horizon_years=1,
        n_simulations=200,
        target_value=1_000_000_000.0,
    )
    rng = np.random.default_rng(42)
    with _patch_loader(prices_2asset):
        result = run_monte_carlo(params, rng=rng)

    assert result.prob_target == pytest.approx(0.0, abs=0.01)


def test_result_has_correct_time_labels(simple_params, prices_2asset):
    rng = np.random.default_rng(42)
    with _patch_loader(prices_2asset):
        result = run_monte_carlo(simple_params, rng=rng)

    assert len(result.time_labels) == simple_params.horizon_years + 1
    # Labels should be consecutive years
    years = [int(y) for y in result.time_labels]
    assert years == list(range(years[0], years[0] + simple_params.horizon_years + 1))


def test_no_target_returns_none_prob(simple_params, prices_2asset):
    rng = np.random.default_rng(42)
    with _patch_loader(prices_2asset):
        result = run_monte_carlo(simple_params, rng=rng)

    assert result.prob_target is None


def test_per_asset_estimates_present(simple_params, prices_2asset):
    rng = np.random.default_rng(42)
    with _patch_loader(prices_2asset):
        result = run_monte_carlo(simple_params, rng=rng)

    for ticker in ["VWCE", "AGGH"]:
        assert ticker in result.annualized_returns
        assert ticker in result.annualized_volatilities
        assert result.annualized_volatilities[ticker] > 0


# ---------------------------------------------------------------------------
# _estimate_expected_returns: hierarchy unit tests
# ---------------------------------------------------------------------------

def test_lambda_zero_gives_pure_historical():
    """λ=0 → shrinkage has no effect; output equals historical."""
    tickers = ["A", "B"]
    mu_hist = np.array([0.08, -0.02])
    mu_final, sources = _estimate_expected_returns(tickers, mu_hist, 0.0, 0.06, {})
    np.testing.assert_allclose(mu_final, mu_hist)
    assert all(s == "historical" for s in sources.values())


def test_lambda_one_gives_pure_long_run():
    """λ=1 → all assets get exactly the long-run prior, regardless of history."""
    tickers = ["A", "B"]
    mu_hist = np.array([0.08, -0.02])
    long_run = 0.06
    mu_final, sources = _estimate_expected_returns(tickers, mu_hist, 1.0, long_run, {})
    np.testing.assert_allclose(mu_final, long_run)
    assert all(s == "shrinkage" for s in sources.values())


def test_shrinkage_blends_correctly():
    """λ=0.5 → output = average of historical and long-run prior."""
    tickers = ["A"]
    mu_hist = np.array([0.10])
    long_run = 0.02
    mu_final, _ = _estimate_expected_returns(tickers, mu_hist, 0.5, long_run, {})
    np.testing.assert_allclose(mu_final, np.array([0.06]), atol=1e-10)


def test_manual_override_wins_over_shrinkage():
    """Manual override takes precedence even when shrinkage is active."""
    tickers = ["A", "B"]
    mu_hist = np.array([0.08, 0.05])
    overrides = {"A": AssetOverride(expected_return=0.02)}
    mu_final, sources = _estimate_expected_returns(tickers, mu_hist, 0.5, 0.06, overrides)
    assert mu_final[0] == pytest.approx(0.02)
    assert sources["A"] == "manual"
    # B is untouched by override
    assert sources["B"] == "shrinkage"
    assert mu_final[1] != pytest.approx(0.02)


def test_partial_override_only_return():
    """Override with only expected_return leaves the other asset untouched."""
    tickers = ["A", "B"]
    mu_hist = np.array([0.08, 0.05])
    overrides = {"B": AssetOverride(expected_return=0.03, expected_volatility=None)}
    mu_final, sources = _estimate_expected_returns(tickers, mu_hist, 0.0, 0.06, overrides)
    assert mu_final[1] == pytest.approx(0.03)
    assert sources["B"] == "manual"
    # A uses historical (λ=0)
    assert mu_final[0] == pytest.approx(mu_hist[0])
    assert sources["A"] == "historical"


def test_override_with_negative_return_accepted():
    """A negative (but > -1) override return is valid."""
    tickers = ["A"]
    mu_hist = np.array([0.05])
    overrides = {"A": AssetOverride(expected_return=-0.50)}
    mu_final, sources = _estimate_expected_returns(tickers, mu_hist, 0.3, 0.06, overrides)
    assert mu_final[0] == pytest.approx(-0.50)
    assert sources["A"] == "manual"


def test_override_return_below_minus_one_rejected():
    with pytest.raises(Exception):
        AssetOverride(expected_return=-1.5)


def test_override_volatility_non_positive_rejected():
    with pytest.raises(Exception):
        AssetOverride(expected_volatility=-0.1)
    with pytest.raises(Exception):
        AssetOverride(expected_volatility=0.0)


# ---------------------------------------------------------------------------
# _apply_volatility_overrides: unit tests
# ---------------------------------------------------------------------------

def test_volatility_override_changes_diagonal():
    """Overriding an asset's vol changes the corresponding diagonal element."""
    tickers = ["A", "B"]
    cov = np.array([[0.04, 0.01], [0.01, 0.09]])  # vols: 0.2 and 0.3
    overrides = {"A": AssetOverride(expected_volatility=0.40)}  # override A to 40%
    cov_new = _apply_volatility_overrides(tickers, cov, overrides)
    assert np.sqrt(cov_new[0, 0]) == pytest.approx(0.40, rel=1e-5)
    # B diagonal unchanged
    assert np.sqrt(cov_new[1, 1]) == pytest.approx(0.30, rel=1e-5)


def test_volatility_override_preserves_correlation():
    """Overriding volatility should not change the correlation coefficient."""
    tickers = ["A", "B"]
    cov = np.array([[0.04, 0.012], [0.012, 0.09]])
    orig_corr = cov[0, 1] / (np.sqrt(cov[0, 0]) * np.sqrt(cov[1, 1]))
    overrides = {"A": AssetOverride(expected_volatility=0.50)}
    cov_new = _apply_volatility_overrides(tickers, cov, overrides)
    new_corr = cov_new[0, 1] / (np.sqrt(cov_new[0, 0]) * np.sqrt(cov_new[1, 1]))
    assert new_corr == pytest.approx(orig_corr, rel=1e-5)


def test_no_volatility_override_returns_original():
    """With no volatility overrides the covariance matrix is returned unchanged."""
    tickers = ["A", "B"]
    cov = np.array([[0.04, 0.01], [0.01, 0.09]])
    overrides = {"A": AssetOverride(expected_return=0.05)}  # only return override
    cov_new = _apply_volatility_overrides(tickers, cov, overrides)
    np.testing.assert_array_equal(cov_new, cov)


# ---------------------------------------------------------------------------
# Integration: shrinkage & overrides through run_monte_carlo
# ---------------------------------------------------------------------------

def test_shrinkage_lambda_one_used_in_simulation(prices_2asset):
    """With λ=1 the used return should equal long_run_return for non-overridden assets."""
    long_run = 0.06
    params = MonteCarloInput(
        weights={"VWCE": 0.6, "AGGH": 0.4},
        initial_capital=10_000.0,
        horizon_years=5,
        n_simulations=200,
        shrinkage_lambda=1.0,
        long_run_return=long_run,
    )
    rng = np.random.default_rng(42)
    with _patch_loader(prices_2asset):
        result = run_monte_carlo(params, rng=rng)

    for ticker in ["VWCE", "AGGH"]:
        assert result.annualized_returns[ticker] == pytest.approx(long_run * 100, rel=1e-3)
        assert result.return_sources[ticker] == "shrinkage"


def test_manual_override_appears_in_result(prices_2asset):
    """An overridden asset should show source='manual' and the exact override return."""
    override_ret = 0.02
    params = MonteCarloInput(
        weights={"VWCE": 0.6, "AGGH": 0.4},
        initial_capital=10_000.0,
        horizon_years=5,
        n_simulations=200,
        asset_overrides={"AGGH": AssetOverride(expected_return=override_ret)},
    )
    rng = np.random.default_rng(42)
    with _patch_loader(prices_2asset):
        result = run_monte_carlo(params, rng=rng)

    assert result.return_sources["AGGH"] == "manual"
    assert result.annualized_returns["AGGH"] == pytest.approx(override_ret * 100, rel=1e-3)
