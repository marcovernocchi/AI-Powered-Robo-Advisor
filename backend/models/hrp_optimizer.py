"""Hierarchical Risk Parity (HRP) portfolio optimisation — baseline diversifier."""

from __future__ import annotations

import pandas as pd
from pypfopt import HRPOpt

from backend.models.optimizer import MIN_HISTORY_DAYS, MIN_WEIGHT


def optimize_hrp(prices: pd.DataFrame, risk_score: int) -> dict:  # noqa: ARG001
    """
    HRP portfolio optimisation via pypfopt.HRPOpt.

    risk_score is accepted for API parity with optimize_portfolio but is not
    used by the HRP algorithm itself (HRP is purely return-correlation-driven).

    Output format is identical to optimize_portfolio plus "method": "hrp".
    All numeric values are native Python float (not np.float64).

    prices     — DataFrame, tickers as columns, daily Close prices
    risk_score — 1–10 (accepted for signature compatibility, unused)
    """
    warnings: list[str] = []

    # 1. exclude tickers with insufficient history (same guard as optimize_portfolio)
    valid_cols = [c for c in prices.columns if prices[c].notna().sum() >= MIN_HISTORY_DAYS]
    excluded_history = [c for c in prices.columns if c not in valid_cols]
    prices = prices[valid_cols].dropna()

    if len(valid_cols) < 2:
        return {
            "error": (
                f"Not enough tickers with {MIN_HISTORY_DAYS}+ trading days of history "
                f"after excluding: {excluded_history or 'none'}. Add more holdings."
            )
        }

    print("\n=== HRP Optimizer ===")
    print(f"Tickers : {list(prices.columns)}")
    if excluded_history:
        print(f"Excluded (short history): {excluded_history}")

    # 2. HRP optimisation — operates on returns, not prices
    returns = prices.pct_change().dropna()
    hrp = HRPOpt(returns)
    hrp.optimize()
    weights = hrp.clean_weights()

    # 3. portfolio performance
    ret, vol, sharpe = hrp.portfolio_performance(verbose=False)

    zeroed  = [k for k, v in weights.items() if v == 0]
    slivers = [k for k, v in weights.items() if 0 < v < MIN_WEIGHT]

    print(f"Active weights : { {k: f'{v:.1%}' for k, v in weights.items() if v > 0} }")
    if zeroed:
        print(f"Zero-weighted  : {zeroed}")
    print(f"Return={ret:.2%}  Vol={vol:.2%}  Sharpe={sharpe:.3f}")
    print("=====================\n")

    if excluded_history:
        warnings.append(
            f"Excluded (insufficient history <{MIN_HISTORY_DAYS} days): {', '.join(excluded_history)}"
        )
    if slivers:
        warnings.append(
            f"Allocation below {MIN_WEIGHT:.0%} (HRP noise floor): {', '.join(slivers)}"
        )
    if zeroed:
        warnings.append(f"Assigned 0% weight by HRP: {', '.join(zeroed)}")

    result: dict = {
        "weights":                    {k: float(round(v, 4)) for k, v in weights.items()},
        "expected_annual_return_pct": float(round(ret * 100, 2)),
        "annual_volatility_pct":      float(round(vol * 100, 2)),
        "sharpe_ratio":               float(round(sharpe, 3)),
        "method":                     "hrp",
    }
    if warnings:
        result["warnings"] = warnings
    return result
