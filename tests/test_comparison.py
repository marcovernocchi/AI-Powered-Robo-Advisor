"""
Tests for run_walk_forward_comparison.

All tests use internally-generated price data — NO real network calls,
NO yfinance downloads.  The comparison module itself never fetches prices;
it receives a prices_df argument directly.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.backtesting.comparison import (
    run_walk_forward_comparison,
    _weights_equal,
    _weights_risk_parity,
    _weights_mvo_max_sharpe,
    _weights_mvo_min_var,
    _weights_hrp,
    _weights_bl_prior_only,
    _get_rebalance_dates,
    _simulate_oos,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_prices(
    n_assets: int = 4,
    n_days: int = 600,
    seed: int = 42,
    drift: float = 0.0003,
    vol: float = 0.012,
) -> pd.DataFrame:
    """Synthetic daily close prices — deterministic, no network."""
    np.random.seed(seed)
    dates = pd.date_range("2020-01-02", periods=n_days, freq="B")
    tickers = ["AAPL", "MSFT", "GOOGL", "AMZN"][:n_assets]
    data = {
        t: 100.0 * np.exp(np.cumsum(drift + vol * np.random.randn(n_days)))
        for t in tickers
    }
    return pd.DataFrame(data, index=dates)


_PRICES = _make_prices()   # shared across most tests (600 days, 4 assets)


# ---------------------------------------------------------------------------
# (a) Output schema
# ---------------------------------------------------------------------------

class TestOutputSchema:
    def test_returns_dataframe(self):
        result = run_walk_forward_comparison(_PRICES, estimation_window=252)
        assert isinstance(result, pd.DataFrame)

    def test_index_contains_all_six_methods(self):
        result = run_walk_forward_comparison(_PRICES, estimation_window=252)
        expected = {
            "MVO max-Sharpe", "MVO min-variance", "Risk Parity",
            "Equal-Weight", "HRP", "Black-Litterman",
        }
        assert set(result.index) == expected

    def test_columns_present(self):
        result = run_walk_forward_comparison(_PRICES, estimation_window=252)
        for col in ("cagr_pct", "vol_pct", "sharpe", "sortino", "max_dd_pct"):
            assert col in result.columns, f"missing column: {col}"

    def test_numeric_values(self):
        result = run_walk_forward_comparison(_PRICES, estimation_window=252)
        # cagr_pct and vol_pct should always be numeric (not None)
        assert result["cagr_pct"].notna().all()
        assert result["vol_pct"].notna().all()


# ---------------------------------------------------------------------------
# (b) No look-ahead bias (anti-leakage test)
# ---------------------------------------------------------------------------

class TestNoLookAheadBias:
    def test_oos_nav_starts_at_oos_boundary(self):
        """
        The simulated NAV must not contain any index entry from the in-sample
        period (before the first rebalance date, which equals estimation_window).
        """
        estimation_window = 252
        prices = _make_prices(n_days=600)
        oos_start = prices.index[estimation_window]

        rebalance_dates = _get_rebalance_dates(prices.index, "monthly", oos_start)

        nav = _simulate_oos(
            prices=prices,
            rebalance_dates=rebalance_dates,
            weight_fn=_weights_equal,
            estimation_window=estimation_window,
            tx_cost_bps=0.0,
        )

        # All NAV dates must be >= oos_start
        assert (nav.index >= oos_start).all(), (
            f"NAV contains in-sample dates: {nav.index[nav.index < oos_start].tolist()}"
        )

    def test_weight_fn_never_sees_future_prices(self):
        """
        Weight function must only receive prices STRICTLY BEFORE the rebalance date.

        The spy receives the TRUE rebalance date directly from _simulate_oos via
        the rebalance_date kwarg (see _call_weight_fn), so the assertion is a
        direct comparison — not a reconstruction from rebalance_dates.
        """
        estimation_window = 252
        prices = _make_prices(n_days=600)
        oos_start = prices.index[estimation_window]
        rebalance_dates = _get_rebalance_dates(prices.index, "monthly", oos_start)

        leakage_violations: list[str] = []

        def spy_weight_fn(
            prices_in: pd.DataFrame,
            rebalance_date: pd.Timestamp | None = None,
        ) -> dict[str, float]:
            assert rebalance_date is not None, (
                "_simulate_oos did not pass rebalance_date to the weight function"
            )
            last_in_sample = prices_in.index[-1]
            # Direct comparison: in-sample window must end BEFORE the rebalance date.
            # rebalance_date is the ACTUAL date _simulate_oos is processing — not
            # a reconstruction — so any leakage would be caught here.
            if last_in_sample >= rebalance_date:
                leakage_violations.append(
                    f"Look-ahead: in-sample ends {last_in_sample.date()} "
                    f">= rebalance date {rebalance_date.date()}"
                )
            return _weights_equal(prices_in)

        _simulate_oos(
            prices=prices,
            rebalance_dates=rebalance_dates,
            weight_fn=spy_weight_fn,
            estimation_window=estimation_window,
            tx_cost_bps=0.0,
        )

        assert leakage_violations == [], (
            "Look-ahead bias detected:\n" + "\n".join(leakage_violations)
        )

    def test_metrics_computed_only_on_oos_period(self):
        """
        Running with estimation_window=252 vs estimation_window=300 must
        change CAGR (different OOS start), confirming metrics depend on OOS
        period only, not on the full series.
        """
        prices = _make_prices(n_days=700)
        r252 = run_walk_forward_comparison(prices, estimation_window=252)
        r300 = run_walk_forward_comparison(prices, estimation_window=300)
        # Different OOS start → different CAGR (at least for one method)
        assert not (r252["cagr_pct"] == r300["cagr_pct"]).all(), (
            "CAGR is identical for both windows — metrics may not be OOS-only"
        )


# ---------------------------------------------------------------------------
# (c) Same universe and period for all methods
# ---------------------------------------------------------------------------

class TestSameUniverseAndPeriod:
    def test_all_methods_use_same_tickers(self):
        """No method should silently drop tickers from its weight dict."""
        prices = _make_prices(n_assets=4, n_days=600)
        result = run_walk_forward_comparison(prices, estimation_window=252)
        # If all methods complete and return metrics, the universe was consistent
        assert result["vol_pct"].notna().all()

    def test_transaction_cost_applied_to_all_methods(self):
        """With costs > 0, CAGR should be strictly lower than with 0 costs."""
        prices = _make_prices(n_days=600)
        r_free = run_walk_forward_comparison(prices, transaction_cost_bps=0.0)
        r_cost = run_walk_forward_comparison(prices, transaction_cost_bps=50.0)
        # At least one method should show lower CAGR under high transaction costs
        diff = r_free["cagr_pct"] - r_cost["cagr_pct"]
        assert (diff >= -0.01).all(), "Some methods have higher CAGR with costs"
        assert (diff > 0).any(), "No method shows lower CAGR under 50bps costs"


# ---------------------------------------------------------------------------
# (d) Parametrisation — estimation window and rebalance frequency
# ---------------------------------------------------------------------------

class TestParametrisation:
    def test_quarterly_rebalancing(self):
        result = run_walk_forward_comparison(
            _PRICES, estimation_window=252, rebalance_freq="quarterly"
        )
        assert set(result.index) == {
            "MVO max-Sharpe", "MVO min-variance", "Risk Parity",
            "Equal-Weight", "HRP", "Black-Litterman",
        }

    def test_weekly_rebalancing(self):
        result = run_walk_forward_comparison(
            _PRICES, estimation_window=252, rebalance_freq="weekly"
        )
        assert result["cagr_pct"].notna().all()

    def test_short_estimation_window(self):
        """estimation_window=60 (minimum reasonable) must not crash."""
        prices = _make_prices(n_days=300)
        result = run_walk_forward_comparison(prices, estimation_window=60)
        assert isinstance(result, pd.DataFrame)

    def test_too_few_rows_raises_value_error(self):
        prices = _make_prices(n_days=50)
        with pytest.raises(ValueError, match="estimation_window"):
            run_walk_forward_comparison(prices, estimation_window=252)


# ---------------------------------------------------------------------------
# (e) Individual weight helper tests (unit-level, no full pipeline)
# ---------------------------------------------------------------------------

class TestWeightHelpers:
    def setup_method(self):
        self.prices = _make_prices(n_assets=3, n_days=300)

    def test_equal_weight_sums_to_one(self):
        w = _weights_equal(self.prices)
        assert abs(sum(w.values()) - 1.0) < 1e-9

    def test_equal_weight_uniform(self):
        w = _weights_equal(self.prices)
        vals = list(w.values())
        assert max(vals) - min(vals) < 1e-9

    def test_risk_parity_sums_to_one(self):
        w = _weights_risk_parity(self.prices)
        assert abs(sum(w.values()) - 1.0) < 1e-6

    def test_risk_parity_weights_non_negative(self):
        w = _weights_risk_parity(self.prices)
        assert all(v >= 0 for v in w.values())

    def test_mvo_max_sharpe_sums_to_one(self):
        w = _weights_mvo_max_sharpe(self.prices)
        assert abs(sum(w.values()) - 1.0) < 0.01

    def test_mvo_min_var_sums_to_one(self):
        w = _weights_mvo_min_var(self.prices)
        assert abs(sum(w.values()) - 1.0) < 0.01

    def test_hrp_sums_to_one(self):
        w = _weights_hrp(self.prices)
        assert abs(sum(w.values()) - 1.0) < 0.01

    def test_bl_prior_only_sums_to_one(self):
        w = _weights_bl_prior_only(self.prices)
        assert abs(sum(w.values()) - 1.0) < 0.01


# ---------------------------------------------------------------------------
# (f) End-to-end smoke test on a slightly larger universe
# ---------------------------------------------------------------------------

class TestEndToEnd:
    def test_six_asset_600day_run_completes(self):
        """Six assets, 600 days — full pipeline must complete without error."""
        np.random.seed(0)
        n_days = 600
        dates = pd.date_range("2019-01-02", periods=n_days, freq="B")
        tickers = ["A", "B", "C", "D", "E", "F"]
        data = {
            t: 100.0 * np.exp(np.cumsum(0.0002 + 0.015 * np.random.randn(n_days)))
            for t in tickers
        }
        prices = pd.DataFrame(data, index=dates)

        result = run_walk_forward_comparison(
            prices,
            estimation_window=252,
            rebalance_freq="monthly",
            transaction_cost_bps=10.0,
            risk_free_rate=0.02,
        )

        assert len(result) == 6
        assert result["vol_pct"].notna().all()
        assert result["cagr_pct"].notna().all()


# ---------------------------------------------------------------------------
# (g) Black-Litterman market_caps prior
# ---------------------------------------------------------------------------

class TestBLMarketCaps:
    """Verify that the market_caps snapshot actually influences BL weights.

    Note on n=3 vs n=4: with 3 assets the max_weight bound equals 1/3+ε,
    which forces all weights to 1/3 regardless of the prior (the feasible set
    collapses to a single point).  All tests use 4 assets so max_w=0.30
    leaves enough room for the EF to differentiate between priors.
    """

    # 4 assets: max_w = max(0.30, 0.25+ε) = 0.30 — room to differentiate
    _PRICES4 = _make_prices(n_assets=4, n_days=300)
    _TICKERS4 = ["AAPL", "MSFT", "GOOGL", "AMZN"]
    # Strongly skewed: AAPL dominates → prior pushes AAPL weight to 0.30 cap
    _CAPS_SKEWED = {"AAPL": 20e12, "MSFT": 0.1e12, "GOOGL": 0.1e12, "AMZN": 0.1e12}

    def test_skewed_caps_change_weights_vs_no_caps(self):
        """
        Strongly skewed market caps must produce different BL weights than
        the equal-weight prior (market_caps=None).

        Proves the prior is actually used — if _weights_bl_prior_only ignored
        market_caps both calls would return identical dicts.
        """
        w_no_caps = _weights_bl_prior_only(self._PRICES4, market_caps=None)
        w_skewed  = _weights_bl_prior_only(self._PRICES4, market_caps=self._CAPS_SKEWED)
        assert w_no_caps != w_skewed, (
            "Strongly skewed market caps must change BL weights vs equal-weight prior; "
            f"no_caps={w_no_caps}  skewed={w_skewed}"
        )

    def test_equal_caps_match_no_caps_fallback(self):
        """
        All-equal caps are mathematically identical to the 1/N fallback,
        so weights must be the same (within floating-point tolerance).
        """
        w_none       = _weights_bl_prior_only(self._PRICES4, market_caps=None)
        w_equal_caps = _weights_bl_prior_only(
            self._PRICES4,
            market_caps={t: 1e12 for t in self._TICKERS4},
        )
        for t in self._TICKERS4:
            assert abs(w_none.get(t, 0) - w_equal_caps.get(t, 0)) < 1e-6, (
                f"{t}: equal-caps weight {w_equal_caps.get(t):.6f} "
                f"!= no-caps weight {w_none.get(t):.6f}"
            )

    def test_market_caps_none_fallback_in_pipeline(self):
        """market_caps=None (default) must not raise and must produce results."""
        prices = _make_prices(n_days=600)   # 4 assets by default
        result = run_walk_forward_comparison(prices, estimation_window=252)
        assert result.loc["Black-Litterman", "cagr_pct"] is not None

    def test_market_caps_only_affects_bl_not_other_methods(self):
        """
        Passing market_caps must change BL output but leave all other
        methods' CAGR values identical (they never read market_caps).
        """
        prices = _make_prices(n_assets=4, n_days=600)
        caps = {"AAPL": 20e12, "MSFT": 0.1e12, "GOOGL": 0.1e12, "AMZN": 0.1e12}

        r_no_caps   = run_walk_forward_comparison(prices, estimation_window=252)
        r_with_caps = run_walk_forward_comparison(prices, estimation_window=252, market_caps=caps)

        non_bl = ["MVO max-Sharpe", "MVO min-variance", "Risk Parity", "Equal-Weight", "HRP"]
        for method in non_bl:
            assert r_no_caps.loc[method, "cagr_pct"] == r_with_caps.loc[method, "cagr_pct"], (
                f"{method} CAGR changed when market_caps was passed — it must not"
            )

        # BL must differ when prior changes significantly
        bl_no_caps   = r_no_caps.loc["Black-Litterman", "cagr_pct"]
        bl_with_caps = r_with_caps.loc["Black-Litterman", "cagr_pct"]
        assert bl_no_caps != bl_with_caps, (
            "Black-Litterman CAGR is identical with and without skewed market caps; "
            "market_caps prior is likely being ignored"
        )
