"""Portfolio performance metrics calculations."""

from __future__ import annotations

import math
from typing import Optional

import numpy as np
import pandas as pd

from .schemas import AnnualReturn, MonthlyReturn, PerformanceMetrics, RollingPoint

TRADING_DAYS_PER_YEAR = 252
ROLLING_WINDOW = TRADING_DAYS_PER_YEAR  # 12-month rolling window


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

    # --- Rolling metrics (252-day window, weekly-sampled) ---
    rolling_sharpe = _rolling_sharpe(daily_returns, risk_free_rate)
    rolling_vol = _rolling_volatility(daily_returns)

    # --- VaR / CVaR (historical, 95% confidence) ---
    var_95, cvar_95 = _var_cvar(daily_returns, confidence=0.95)

    # --- Monthly return heatmap ---
    monthly_returns = _monthly_returns(values)

    return PerformanceMetrics(
        total_return_pct=round(total_return * 100, 4),
        cagr_pct=round(cagr * 100, 4),
        annualized_volatility_pct=round(ann_vol * 100, 4),
        sharpe_ratio=round(sharpe, 4) if sharpe is not None else None,
        sortino_ratio=round(sortino, 4) if sortino is not None else None,
        max_drawdown_pct=round(max_dd * 100, 4),
        max_drawdown_duration_days=max_dd_duration,
        annual_returns=annual_returns,
        rolling_sharpe=rolling_sharpe,
        rolling_volatility=rolling_vol,
        var_95_pct=var_95,
        cvar_95_pct=cvar_95,
        monthly_returns=monthly_returns,
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


def _rolling_sharpe(daily_returns: pd.Series, risk_free_rate: float) -> list[RollingPoint]:
    """Annualised Sharpe on a rolling 252-day window, sampled weekly."""
    if len(daily_returns) < ROLLING_WINDOW + 1:
        return []
    daily_rf = (1 + risk_free_rate) ** (1 / TRADING_DAYS_PER_YEAR) - 1
    excess = daily_returns - daily_rf
    roll_mean = excess.rolling(ROLLING_WINDOW).mean()
    roll_std = excess.rolling(ROLLING_WINDOW).std()
    sharpe_series = (roll_mean / roll_std) * math.sqrt(TRADING_DAYS_PER_YEAR)
    # Weekly sampling to keep response size manageable
    sampled = sharpe_series.resample("W").last().dropna()
    return [
        RollingPoint(date=ts.date(), value=round(float(v), 4))
        for ts, v in sampled.items()
    ]


def _rolling_volatility(daily_returns: pd.Series) -> list[RollingPoint]:
    """Annualised volatility on a rolling 252-day window, sampled weekly."""
    if len(daily_returns) < ROLLING_WINDOW + 1:
        return []
    roll_vol = daily_returns.rolling(ROLLING_WINDOW).std() * math.sqrt(TRADING_DAYS_PER_YEAR) * 100
    sampled = roll_vol.resample("W").last().dropna()
    return [
        RollingPoint(date=ts.date(), value=round(float(v), 4))
        for ts, v in sampled.items()
    ]


def _var_cvar(daily_returns: pd.Series, confidence: float = 0.95) -> tuple[Optional[float], Optional[float]]:
    """Historical VaR and CVaR at the given confidence level.

    Returns (var, cvar) as positive percentages representing losses.
    E.g. var=1.5 means a 1.5% daily loss is not exceeded with 95% probability.
    """
    if len(daily_returns) < 20:
        return None, None
    r = daily_returns.values
    cutoff = np.percentile(r, (1 - confidence) * 100)  # e.g. 5th percentile
    var = -cutoff * 100                                  # flip sign: positive = loss
    tail = r[r <= cutoff]
    cvar = -float(tail.mean()) * 100 if len(tail) > 0 else var
    return round(float(var), 4), round(float(cvar), 4)


def _monthly_returns(values: pd.Series) -> list[MonthlyReturn]:
    """Monthly portfolio returns for the heatmap grid.

    Uses month-end NAV values. Partial first/last months are included as-is.
    """
    monthly_nav = values.resample("ME").last().dropna()
    if len(monthly_nav) < 2:
        return []
    # Shift by 1 to get start-of-month NAV for each period
    prev_nav = monthly_nav.shift(1)
    monthly_ret = ((monthly_nav - prev_nav) / prev_nav).dropna()
    result = []
    for ts, ret in monthly_ret.items():
        result.append(MonthlyReturn(
            year=int(ts.year),
            month=int(ts.month),
            return_pct=round(float(ret) * 100, 4),
        ))
    return result


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
