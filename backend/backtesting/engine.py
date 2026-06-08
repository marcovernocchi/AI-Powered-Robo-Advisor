"""Core backtesting simulation engine."""

from __future__ import annotations


import pandas as pd

from .data_loader import align_weights, load_prices
from .metrics import compute_metrics
from .schemas import (
    BacktestInput,
    BacktestResult,
    PerformanceMetrics,
    RebalanceFrequency,
    TimeSeriesPoint,
)

_BPS = 1e-4  # 1 basis point = 0.0001


class BacktestEngine:
    """Simulates a rebalanced multi-asset portfolio over a historical period."""

    def run(self, params: BacktestInput) -> BacktestResult:
        """Execute the backtest and return a BacktestResult.

        Args:
            params: Validated BacktestInput instance.
        """
        warnings: list[str] = []

        # --- Load prices ---
        tickers = list(params.weights.keys())
        prices, load_warnings = load_prices(tickers, params.start_date, params.end_date)
        warnings.extend(load_warnings)

        weights = align_weights(params.weights, list(prices.columns), warnings)

        # --- Simulate portfolio ---
        portfolio_values, rebalance_dates, tx_costs, ter_costs = self._simulate(
            prices=prices,
            weights=weights,
            initial_capital=params.initial_capital,
            rebalance_frequency=params.rebalance_frequency,
            drift_threshold=params.drift_threshold,
            transaction_cost_bps=params.transaction_cost_bps,
            annual_ter_bps=params.annual_ter_bps,
            spread_bps=params.spread_bps,
        )

        metrics = compute_metrics(portfolio_values, params.risk_free_rate)

        # --- Benchmark ---
        benchmark_metrics: PerformanceMetrics | None = None
        bench_series: pd.Series | None = None

        if params.benchmark_ticker:
            try:
                bench_prices, _ = load_prices(
                    [params.benchmark_ticker], params.start_date, params.end_date
                )
                bench_col = bench_prices.columns[0]
                bench_prices = bench_prices.reindex(portfolio_values.index).ffill().dropna()
                bench_series = (
                    bench_prices[bench_col] / bench_prices[bench_col].iloc[0] * params.initial_capital
                )
                benchmark_metrics = compute_metrics(bench_series, params.risk_free_rate)
            except Exception as exc:
                warnings.append(f"Benchmark '{params.benchmark_ticker}' could not be loaded: {exc}")

        # --- Build time series output ---
        series: list[TimeSeriesPoint] = []
        for dt, val in portfolio_values.items():
            bval = float(bench_series.get(dt)) if bench_series is not None and dt in bench_series.index else None
            series.append(TimeSeriesPoint(date=dt.date(), portfolio_value=round(val, 4), benchmark_value=round(bval, 4) if bval is not None else None))

        return BacktestResult(
            portfolio_series=series,
            metrics=metrics,
            benchmark_metrics=benchmark_metrics,
            total_transaction_costs=round(tx_costs, 4),
            total_ter_costs=round(ter_costs, 4),
            rebalance_dates=[d.date() for d in rebalance_dates],
            warnings=warnings,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _simulate(
        self,
        prices: pd.DataFrame,
        weights: dict[str, float],
        initial_capital: float,
        rebalance_frequency: RebalanceFrequency,
        drift_threshold: float,
        transaction_cost_bps: float,
        annual_ter_bps: float,
        spread_bps: float,
    ) -> tuple[pd.Series, list[pd.Timestamp], float, float]:
        tickers = list(weights.keys())
        target_weights = {t: weights[t] for t in tickers}

        # Initial allocation on first day (pay transaction costs + spread)
        first_day = prices.index[0]
        nav = initial_capital
        tx_costs = 0.0
        ter_costs = 0.0

        entry_cost = nav * (transaction_cost_bps + spread_bps) * _BPS
        tx_costs += entry_cost
        nav -= entry_cost

        holdings: dict[str, float] = {}
        for t in tickers:
            holdings[t] = (nav * target_weights[t]) / prices.loc[first_day, t]

        rebalance_dates: list[pd.Timestamp] = [first_day]
        portfolio_values: dict[pd.Timestamp, float] = {}

        prev_date = first_day

        for day in prices.index:
            # --- Daily TER deduction ---
            daily_ter = (annual_ter_bps * _BPS) / 365
            nav_before_ter = sum(holdings[t] * prices.loc[day, t] for t in tickers)
            ter_today = nav_before_ter * daily_ter
            # Distribute TER deduction proportionally across holdings
            if nav_before_ter > 0:
                for t in tickers:
                    holdings[t] -= holdings[t] * (ter_today / nav_before_ter)
            ter_costs += ter_today

            # --- Current NAV and weights ---
            current_values = {t: holdings[t] * prices.loc[day, t] for t in tickers}
            current_nav = sum(current_values.values())
            current_weights = {t: current_values[t] / current_nav for t in tickers} if current_nav > 0 else target_weights.copy()

            portfolio_values[day] = current_nav

            # --- Rebalance decision ---
            if self._should_rebalance(
                day, prev_date, rebalance_frequency, current_weights, target_weights, drift_threshold
            ) and day != first_day:
                cost = current_nav * (transaction_cost_bps + spread_bps) * _BPS
                tx_costs += cost
                current_nav -= cost
                for t in tickers:
                    holdings[t] = (current_nav * target_weights[t]) / prices.loc[day, t]
                rebalance_dates.append(day)

            prev_date = day

        values_series = pd.Series(portfolio_values)
        return values_series, rebalance_dates, tx_costs, ter_costs

    @staticmethod
    def _should_rebalance(
        day: pd.Timestamp,
        prev_date: pd.Timestamp,
        frequency: RebalanceFrequency,
        current_weights: dict[str, float],
        target_weights: dict[str, float],
        drift_threshold: float,
    ) -> bool:
        if frequency == RebalanceFrequency.NONE:
            return False
        if frequency == RebalanceFrequency.MONTHLY:
            return day.month != prev_date.month
        if frequency == RebalanceFrequency.QUARTERLY:
            return (day.month - 1) // 3 != (prev_date.month - 1) // 3
        if frequency == RebalanceFrequency.ANNUAL:
            return day.year != prev_date.year
        if frequency == RebalanceFrequency.DRIFT:
            return any(
                abs(current_weights.get(t, 0) - target_weights.get(t, 0)) > drift_threshold
                for t in target_weights
            )
        return False
