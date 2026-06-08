"""Pydantic schemas for backtesting input and output."""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Optional

from pydantic import BaseModel, field_validator, model_validator


class RebalanceFrequency(str, Enum):
    NONE = "none"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUAL = "annual"
    DRIFT = "drift"


class BacktestInput(BaseModel):
    weights: dict[str, float]
    initial_capital: float
    start_date: date
    end_date: date
    rebalance_frequency: RebalanceFrequency = RebalanceFrequency.NONE
    drift_threshold: float = 0.05
    transaction_cost_bps: float = 10.0
    annual_ter_bps: float = 0.0
    spread_bps: float = 0.0
    benchmark_ticker: Optional[str] = None
    risk_free_rate: float = 0.02

    @field_validator("weights")
    @classmethod
    def weights_not_empty(cls, v: dict[str, float]) -> dict[str, float]:
        if not v:
            raise ValueError("weights must contain at least one asset")
        if any(w < 0 for w in v.values()):
            raise ValueError("all weights must be non-negative")
        return v

    @model_validator(mode="after")
    def validate_inputs(self) -> "BacktestInput":
        total = sum(self.weights.values())
        if abs(total - 1.0) > 1e-6:
            raise ValueError(f"weights must sum to 1.0, got {total:.6f}")
        if self.start_date >= self.end_date:
            raise ValueError("start_date must be before end_date")
        if self.initial_capital <= 0:
            raise ValueError("initial_capital must be positive")
        return self


class AnnualReturn(BaseModel):
    year: int
    return_pct: float


class PerformanceMetrics(BaseModel):
    total_return_pct: float
    cagr_pct: float
    annualized_volatility_pct: float
    sharpe_ratio: Optional[float]
    sortino_ratio: Optional[float]
    max_drawdown_pct: float
    max_drawdown_duration_days: int
    annual_returns: list[AnnualReturn]


class TimeSeriesPoint(BaseModel):
    date: date
    portfolio_value: float
    benchmark_value: Optional[float] = None


class BacktestResult(BaseModel):
    portfolio_series: list[TimeSeriesPoint]
    metrics: PerformanceMetrics
    benchmark_metrics: Optional[PerformanceMetrics] = None
    total_transaction_costs: float
    total_ter_costs: float
    rebalance_dates: list[date]
    warnings: list[str]
