from __future__ import annotations

from pydantic import BaseModel, field_validator, model_validator


class MonteCarloInput(BaseModel):
    weights: dict[str, float]
    initial_capital: float
    horizon_years: int = 10
    n_simulations: int = 1000
    monthly_contribution: float = 0.0
    target_value: float | None = None
    # Number of years of historical data to estimate returns/covariance
    lookback_years: int = 5

    @field_validator("n_simulations")
    @classmethod
    def cap_simulations(cls, v: int) -> int:
        if v < 10:
            raise ValueError("n_simulations must be at least 10")
        return min(v, 10_000)

    @field_validator("horizon_years")
    @classmethod
    def check_horizon(cls, v: int) -> int:
        if v < 1 or v > 50:
            raise ValueError("horizon_years must be between 1 and 50")
        return v

    @field_validator("initial_capital")
    @classmethod
    def check_capital(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("initial_capital must be positive")
        return v

    @model_validator(mode="after")
    def check_weights_sum(self) -> "MonteCarloInput":
        total = sum(self.weights.values())
        if abs(total - 1.0) > 0.01:
            raise ValueError(f"weights must sum to 1.0 (got {total:.4f})")
        return self


class PercentileSeries(BaseModel):
    """One percentile band: a list of values, one per time step."""
    p5: list[float]
    p25: list[float]
    p50: list[float]
    p75: list[float]
    p95: list[float]


class MonteCarloResult(BaseModel):
    # Time axis: year fractions (0, 1/steps, 2/steps, … horizon_years)
    time_labels: list[str]          # e.g. "2025", "2026", …
    percentiles: PercentileSeries
    mean_final: float
    median_final: float
    prob_target: float | None       # None if no target was given
    # Estimation metadata
    annualized_returns: dict[str, float]   # per-asset, %
    annualized_volatilities: dict[str, float]  # per-asset, %
    warnings: list[str]
