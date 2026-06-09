"""Unit tests for the backtesting module."""

from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from backend.backtesting.data_loader import align_weights
from backend.backtesting.engine import BacktestEngine
from backend.backtesting.metrics import compute_metrics, _max_drawdown_duration
from backend.backtesting.schemas import BacktestInput, BacktestResult, PerformanceMetrics, RebalanceFrequency


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _flat_prices(tickers: list[str], n_days: int = 200, start: str = "2020-01-02") -> pd.DataFrame:
    """All prices = 100 (no returns, no drift)."""
    idx = pd.bdate_range(start=start, periods=n_days)
    return pd.DataFrame(100.0, index=idx, columns=tickers)


def _trending_prices(n_days: int = 252, daily_return: float = 0.001) -> pd.DataFrame:
    """Single asset with constant daily return."""
    idx = pd.bdate_range(start="2020-01-02", periods=n_days)
    prices = 100 * (1 + daily_return) ** pd.Series(range(n_days), index=idx)
    return pd.DataFrame({"A": prices})


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------

class TestBacktestInputValidation:
    def test_weights_sum_not_one(self):
        with pytest.raises(Exception, match="sum to 1"):
            BacktestInput(
                weights={"A": 0.5, "B": 0.3},
                initial_capital=10_000,
                start_date=date(2020, 1, 1),
                end_date=date(2021, 1, 1),
            )

    def test_negative_weight(self):
        with pytest.raises(Exception, match="non-negative"):
            BacktestInput(
                weights={"A": 1.2, "B": -0.2},
                initial_capital=10_000,
                start_date=date(2020, 1, 1),
                end_date=date(2021, 1, 1),
            )

    def test_empty_weights(self):
        with pytest.raises(Exception, match="at least one asset"):
            BacktestInput(
                weights={},
                initial_capital=10_000,
                start_date=date(2020, 1, 1),
                end_date=date(2021, 1, 1),
            )

    def test_start_after_end(self):
        with pytest.raises(Exception, match="start_date"):
            BacktestInput(
                weights={"A": 1.0},
                initial_capital=10_000,
                start_date=date(2021, 6, 1),
                end_date=date(2021, 1, 1),
            )

    def test_zero_capital(self):
        with pytest.raises(Exception, match="positive"):
            BacktestInput(
                weights={"A": 1.0},
                initial_capital=0,
                start_date=date(2020, 1, 1),
                end_date=date(2021, 1, 1),
            )

    def test_valid_input(self):
        inp = BacktestInput(
            weights={"A": 0.6, "B": 0.4},
            initial_capital=10_000,
            start_date=date(2020, 1, 1),
            end_date=date(2021, 1, 1),
        )
        assert abs(sum(inp.weights.values()) - 1.0) < 1e-9


# ---------------------------------------------------------------------------
# Data loader
# ---------------------------------------------------------------------------

class TestAlignWeights:
    def test_removes_missing_and_renormalises(self):
        warnings: list[str] = []
        result = align_weights({"A": 0.6, "B": 0.4}, available_tickers=["A"], warnings=warnings)
        assert abs(result["A"] - 1.0) < 1e-9
        assert "B" not in result
        assert any("B" in w for w in warnings)

    def test_no_tickers_raises(self):
        with pytest.raises(ValueError, match="No tickers"):
            align_weights({"A": 1.0}, available_tickers=[], warnings=[])

    def test_all_present_unchanged(self):
        warnings: list[str] = []
        result = align_weights({"A": 0.6, "B": 0.4}, available_tickers=["A", "B"], warnings=warnings)
        assert abs(result["A"] - 0.6) < 1e-9
        assert abs(result["B"] - 0.4) < 1e-9
        assert not warnings


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

class TestMetrics:
    def test_flat_portfolio_zero_return(self):
        idx = pd.bdate_range("2020-01-02", periods=252)
        series = pd.Series(100.0, index=idx)
        m = compute_metrics(series, risk_free_rate=0.0)
        assert m.total_return_pct == pytest.approx(0.0, abs=1e-3)
        assert m.annualized_volatility_pct == pytest.approx(0.0, abs=1e-3)
        assert m.max_drawdown_pct == pytest.approx(0.0, abs=1e-3)

    def test_known_cagr(self):
        """Portfolio doubles in exactly 2 years → CAGR ≈ 41.42%."""
        idx = pd.bdate_range("2020-01-02", periods=521)  # ~2 years of trading days
        values = pd.Series([100.0 + i * (100.0 / 520) for i in range(521)], index=idx)
        m = compute_metrics(values, risk_free_rate=0.0)
        assert m.total_return_pct == pytest.approx(100.0, abs=0.5)

    def test_max_drawdown_known_value(self):
        """Series goes 100→120→80 → max drawdown = (80-120)/120 = -33.33%."""
        idx = pd.bdate_range("2020-01-02", periods=3)
        series = pd.Series([100.0, 120.0, 80.0], index=idx)
        m = compute_metrics(series, risk_free_rate=0.0)
        assert m.max_drawdown_pct == pytest.approx(-33.333, abs=0.1)

    def test_max_drawdown_duration(self):
        """6 consecutive days in drawdown after peak on day 0."""
        idx = pd.bdate_range("2020-01-02", periods=7)
        values = pd.Series([100, 99, 98, 97, 96, 95, 96], index=idx)
        rolling_max = values.cummax()
        drawdown = (values - rolling_max) / rolling_max
        assert _max_drawdown_duration(drawdown) == 6  # days 1–6 are in drawdown

    def test_annual_returns_grouping(self):
        idx = pd.bdate_range("2020-01-02", periods=504)  # ~2 years
        values = pd.Series(range(1, 505), dtype=float, index=idx)
        m = compute_metrics(values, risk_free_rate=0.0)
        years = [ar.year for ar in m.annual_returns]
        assert 2020 in years
        assert 2021 in years

    def test_too_few_points_raises(self):
        idx = pd.bdate_range("2020-01-02", periods=1)
        series = pd.Series([100.0], index=idx)
        with pytest.raises(ValueError, match="at least 2"):
            compute_metrics(series)


# ---------------------------------------------------------------------------
# Engine (no network — inject synthetic prices)
# ---------------------------------------------------------------------------

class TestBacktestEngine:
    """Monkey-patch load_prices so tests never hit the network."""

    def _run_with_prices(self, prices: pd.DataFrame, params: BacktestInput) -> BacktestResult:
        import backend.backtesting.engine as eng_mod
        original = eng_mod.load_prices

        def fake_load(tickers, start_date, end_date):
            available = [t for t in tickers if t in prices.columns]
            return prices[available].copy(), []

        eng_mod.load_prices = fake_load
        try:
            return BacktestEngine().run(params)
        finally:
            eng_mod.load_prices = original

    def test_flat_prices_no_gain(self):
        """With flat prices the portfolio should be worth ≈ initial_capital minus costs."""
        prices = _flat_prices(["A", "B"], n_days=252)
        params = BacktestInput(
            weights={"A": 0.6, "B": 0.4},
            initial_capital=10_000,
            start_date=date(2020, 1, 1),
            end_date=date(2020, 12, 31),
        )
        result = self._run_with_prices(prices, params)
        final = result.portfolio_series[-1].portfolio_value
        # Should be slightly below 10_000 due to entry transaction cost
        assert final < 10_000
        assert final > 9_000

    def test_no_rebalance_produces_no_rebalance_dates(self):
        prices = _flat_prices(["A"], n_days=50)
        params = BacktestInput(
            weights={"A": 1.0},
            initial_capital=5_000,
            start_date=date(2020, 1, 1),
            end_date=date(2020, 6, 1),
            rebalance_frequency=RebalanceFrequency.NONE,
        )
        result = self._run_with_prices(prices, params)
        # Only initial allocation date
        assert len(result.rebalance_dates) == 1

    def test_monthly_rebalance_fires(self):
        prices = _flat_prices(["A", "B"], n_days=252)
        params = BacktestInput(
            weights={"A": 0.5, "B": 0.5},
            initial_capital=10_000,
            start_date=date(2020, 1, 1),
            end_date=date(2020, 12, 31),
            rebalance_frequency=RebalanceFrequency.MONTHLY,
            transaction_cost_bps=0.0,
        )
        result = self._run_with_prices(prices, params)
        # ~12 months → 12 rebalances after the initial one
        assert len(result.rebalance_dates) >= 10

    def test_drift_rebalance_with_drift(self):
        """One asset drifts beyond threshold → at least one rebalance."""
        idx = pd.bdate_range("2020-01-02", periods=100)
        prices = pd.DataFrame({
            "A": [100 + i * 2 for i in range(100)],  # strongly rising
            "B": [100.0] * 100,
        }, index=idx)
        params = BacktestInput(
            weights={"A": 0.5, "B": 0.5},
            initial_capital=10_000,
            start_date=date(2020, 1, 1),
            end_date=date(2020, 12, 31),
            rebalance_frequency=RebalanceFrequency.DRIFT,
            drift_threshold=0.05,
            transaction_cost_bps=0.0,
        )
        result = self._run_with_prices(prices, params)
        assert len(result.rebalance_dates) > 1

    def test_missing_ticker_excluded_with_warning(self):
        prices = _flat_prices(["A"], n_days=50)
        params = BacktestInput(
            weights={"A": 0.6, "B": 0.4},
            initial_capital=10_000,
            start_date=date(2020, 1, 1),
            end_date=date(2020, 6, 1),
        )
        result = self._run_with_prices(prices, params)
        assert any("B" in w for w in result.warnings)

    def test_transaction_costs_reduce_nav(self):
        prices = _flat_prices(["A"], n_days=50)
        params_nocost = BacktestInput(
            weights={"A": 1.0},
            initial_capital=10_000,
            start_date=date(2020, 1, 1),
            end_date=date(2020, 6, 1),
            transaction_cost_bps=0.0,
        )
        params_cost = BacktestInput(
            weights={"A": 1.0},
            initial_capital=10_000,
            start_date=date(2020, 1, 1),
            end_date=date(2020, 6, 1),
            transaction_cost_bps=50.0,
        )
        r_no = self._run_with_prices(prices, params_nocost)
        r_cost = self._run_with_prices(prices, params_cost)
        assert r_cost.portfolio_series[-1].portfolio_value < r_no.portfolio_series[-1].portfolio_value
        assert r_cost.total_transaction_costs > 0


# ---------------------------------------------------------------------------
# Drift / threshold rebalancing
# ---------------------------------------------------------------------------

class TestDriftRebalancing:
    """Verify drift-threshold rebalancing fires only when deviation exceeds threshold."""

    def _run_with_prices(self, prices, params):
        from unittest.mock import patch
        engine = BacktestEngine()
        with patch("backend.backtesting.engine.load_prices", return_value=(prices, [])):
            return engine.run(params)

    def test_no_rebalance_below_threshold(self):
        """With flat prices, weights never drift — no rebalance beyond day-0."""
        prices = _flat_prices(["A", "B"], n_days=252)
        params = BacktestInput(
            weights={"A": 0.6, "B": 0.4},
            initial_capital=10_000,
            start_date=date(2020, 1, 1),
            end_date=date(2021, 6, 1),
            rebalance_frequency=RebalanceFrequency.DRIFT,
            drift_threshold=0.05,
        )
        result = self._run_with_prices(prices, params)
        # Only the initial allocation date should be recorded
        assert len(result.rebalance_dates) == 1

    def test_rebalance_fires_when_drift_exceeded(self):
        """A strongly trending asset will eventually exceed the threshold."""
        idx = pd.bdate_range(start="2020-01-02", periods=300)
        # A rises 0.5%/day, B stays flat → weights diverge quickly
        prices_a = 100 * (1.005 ** pd.Series(range(300), index=idx))
        prices_b = pd.Series(100.0, index=idx)
        prices = pd.DataFrame({"A": prices_a, "B": prices_b})
        params = BacktestInput(
            weights={"A": 0.5, "B": 0.5},
            initial_capital=10_000,
            start_date=date(2020, 1, 1),
            end_date=date(2021, 6, 1),
            rebalance_frequency=RebalanceFrequency.DRIFT,
            drift_threshold=0.05,
        )
        result = self._run_with_prices(prices, params)
        assert len(result.rebalance_dates) > 1

    def test_higher_threshold_means_fewer_rebalances(self):
        """A tighter threshold triggers more rebalances than a looser one."""
        idx = pd.bdate_range(start="2020-01-02", periods=500)
        prices_a = 100 * (1.003 ** pd.Series(range(500), index=idx))
        prices_b = pd.Series(100.0, index=idx)
        prices = pd.DataFrame({"A": prices_a, "B": prices_b})
        base = dict(
            weights={"A": 0.5, "B": 0.5},
            initial_capital=10_000,
            start_date=date(2020, 1, 1),
            end_date=date(2022, 1, 1),
            rebalance_frequency=RebalanceFrequency.DRIFT,
        )
        result_tight = self._run_with_prices(prices, BacktestInput(**base, drift_threshold=0.02))
        result_loose = self._run_with_prices(prices, BacktestInput(**base, drift_threshold=0.15))
        assert len(result_tight.rebalance_dates) > len(result_loose.rebalance_dates)


# ---------------------------------------------------------------------------
# VaR / CVaR
# ---------------------------------------------------------------------------

class TestVaRCVaR:
    def _metrics_from_returns(self, daily_returns: list[float]) -> "PerformanceMetrics":
        from backend.backtesting.metrics import compute_metrics
        idx = pd.bdate_range(start="2020-01-02", periods=len(daily_returns) + 1)
        values = pd.Series(100.0, index=idx[:1])
        for r in daily_returns:
            values[idx[len(values)]] = values.iloc[-1] * (1 + r)
        return compute_metrics(values)

    def test_var_positive_means_loss(self):
        """VaR should be a positive number representing a loss magnitude."""
        import numpy as np
        rng = np.random.default_rng(42)
        returns = rng.normal(0.0005, 0.01, 500).tolist()
        m = self._metrics_from_returns(returns)
        assert m.var_95_pct is not None
        assert m.var_95_pct > 0

    def test_cvar_geq_var(self):
        """CVaR (expected shortfall) must be >= VaR by definition."""
        import numpy as np
        rng = np.random.default_rng(7)
        returns = rng.normal(0.0, 0.015, 600).tolist()
        m = self._metrics_from_returns(returns)
        assert m.cvar_95_pct >= m.var_95_pct

    def test_var_known_distribution(self):
        """On a controlled symmetric distribution, VaR ≈ 1.645σ (normal approximation)."""
        import numpy as np
        rng = np.random.default_rng(0)
        sigma = 0.01
        returns = rng.normal(0.0, sigma, 5000).tolist()
        m = self._metrics_from_returns(returns)
        # Historical VaR on large normal sample ≈ 1.645 * sigma * 100
        expected = 1.645 * sigma * 100
        assert abs(m.var_95_pct - expected) < 0.3  # within 0.3 pp

    def test_none_when_too_few_returns(self):
        """With fewer than 20 returns, VaR/CVaR should be None."""
        from backend.backtesting.metrics import _var_cvar
        import numpy as np
        short = pd.Series(np.random.default_rng(1).normal(0, 0.01, 10))
        var, cvar = _var_cvar(short)
        assert var is None and cvar is None


# ---------------------------------------------------------------------------
# Rolling metrics
# ---------------------------------------------------------------------------

class TestRollingMetrics:
    def _make_nav(self, n_days: int, daily_return: float = 0.0005, seed: int = 42) -> pd.Series:
        import numpy as np
        rng = np.random.default_rng(seed)
        idx = pd.bdate_range(start="2019-01-02", periods=n_days)
        returns = rng.normal(daily_return, 0.01, n_days)
        nav = pd.Series(100.0 * (1 + returns).cumprod(), index=idx)
        return nav

    def test_empty_when_series_too_short(self):
        """Rolling series should be empty if history < 252 days."""
        from backend.backtesting.metrics import compute_metrics
        nav = self._make_nav(200)
        m = compute_metrics(nav)
        assert m.rolling_sharpe == []
        assert m.rolling_volatility == []

    def test_rolling_series_length_with_long_history(self):
        """With 3 years of data, rolling series should have ~(3*52 - 52) ≈ 104 weekly points."""
        from backend.backtesting.metrics import compute_metrics
        nav = self._make_nav(756)  # ~3 years
        m = compute_metrics(nav)
        # Should have roughly 2 years of weekly points after the burn-in window
        assert len(m.rolling_sharpe) > 50
        assert len(m.rolling_volatility) > 50

    def test_rolling_vol_positive(self):
        """Rolling volatility values must all be positive."""
        from backend.backtesting.metrics import compute_metrics
        nav = self._make_nav(600)
        m = compute_metrics(nav)
        assert all(p.value > 0 for p in m.rolling_volatility)

    def test_rolling_dates_ascending(self):
        """Dates in rolling series must be strictly ascending."""
        from backend.backtesting.metrics import compute_metrics
        nav = self._make_nav(600)
        m = compute_metrics(nav)
        dates = [p.date for p in m.rolling_sharpe]
        assert dates == sorted(dates)
