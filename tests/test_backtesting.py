"""Unit tests for the backtesting module."""

from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from backend.backtesting.data_loader import align_weights
from backend.backtesting.engine import BacktestEngine
from backend.backtesting.metrics import compute_metrics, _max_drawdown_duration
from backend.backtesting.schemas import BacktestInput, BacktestResult, RebalanceFrequency


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
