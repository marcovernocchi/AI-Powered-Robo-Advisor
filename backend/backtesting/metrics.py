"""Portfolio performance metrics calculations."""

from __future__ import annotations

import math
from typing import Optional

import pandas as pd

from .schemas import AnnualReturn, PerformanceMetrics

TRADING_DAYS_PER_YEAR = 252


def compute_metrics(
    portfolio_values: pd.Series,
    risk_free_rate: float = 0.02,
) -> PerformanceMetrics:
    """Compute all performance metrics from a daily portfolio value series.

    Args:
        portfolio_values: DatetimeIndex Series of portfolio NAV.
        risk_free_rate: Annual risk-free rate (e.g. 0.02 for 2%).
    """
    values = portfolio_values.dropna()
    if len(values) < 2:
        raise ValueError("Need at least 2 data points to compute metrics.")

    daily_returns = values.pct_change().dropna()

    # Total return
    total_return = (values.iloc[-1] / values.iloc[0]) - 1.0

    # CAGR
    n_years = (values.index[-1] - values.index[0]).days / 365.25
    cagr = (values.iloc[-1] / values.iloc[0]) ** (1 / n_years) - 1 if n_years > 0 else 0.0

    # Annualised volatility
    ann_vol = daily_returns.std() * math.sqrt(TRADING_DAYS_PER_YEAR)

    # Sharpe ratio
    daily_rf = (1 + risk_free_rate) ** (1 / TRADING_DAYS_PER_YEAR) - 1
    excess = daily_returns - daily_rf
    sharpe: Optional[float] = (
        float((excess.mean() / excess.std()) * math.sqrt(TRADING_DAYS_PER_YEAR))
        if excess.std() > 0
        else None
    )

    # Sortino ratio
    downside = daily_returns[daily_returns < daily_rf]
    downside_std = downside.std() * math.sqrt(TRADING_DAYS_PER_YEAR) if len(downside) > 1 else None
    sortino: Optional[float] = (
        float((cagr - risk_free_rate) / downside_std)
        if downside_std and downside_std > 0
        else None
    )

    # Max drawdown
    rolling_max = values.cummax()
    drawdown = (values - rolling_max) / rolling_max
    max_dd = float(drawdown.min())
    max_dd_duration = _max_drawdown_duration(drawdown)

    # Annual returns
    annual_returns = _annual_returns(values)

    return PerformanceMetrics(
        total_return_pct=round(total_return * 100, 4),
        cagr_pct=round(cagr * 100, 4),
        annualized_volatility_pct=round(ann_vol * 100, 4),
        sharpe_ratio=round(sharpe, 4) if sharpe is not None else None,
        sortino_ratio=round(sortino, 4) if sortino is not None else None,
        max_drawdown_pct=round(max_dd * 100, 4),
        max_drawdown_duration_days=max_dd_duration,
        annual_returns=annual_returns,
    )


def _max_drawdown_duration(drawdown: pd.Series) -> int:
    """Return the longest streak of consecutive days in drawdown (value < 0)."""
    in_dd = (drawdown < 0).astype(int)
    max_streak = 0
    streak = 0
    for v in in_dd:
        streak = streak + 1 if v else 0
        max_streak = max(max_streak, streak)
    return max_streak


def _annual_returns(values: pd.Series) -> list[AnnualReturn]:
    annual = []
    years = values.index.year
    for year in sorted(set(years)):
        year_vals = values[years == year]
        if len(year_vals) < 2:
            continue
        ret = (year_vals.iloc[-1] / year_vals.iloc[0] - 1) * 100
        annual.append(AnnualReturn(year=int(year), return_pct=round(float(ret), 4)))
    return annual
