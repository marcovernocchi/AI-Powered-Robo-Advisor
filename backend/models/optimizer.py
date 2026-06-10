import pandas as pd
from pypfopt import EfficientFrontier, risk_models, expected_returns
from pypfopt.exceptions import OptimizationError


MIN_HISTORY_DAYS = 60
DEFAULT_MAX_WEIGHT = 0.30   # allows 3+ meaningful positions; 0.25 would pin the upper
                             # bound at the equal-weight point and disable upside tilts
MIN_WEIGHT = 0.05            # allocations below this are noise — exclude and re-run


def _effective_max_weight(n: int) -> float:
    """
    Ensure n * max_w > 1 so the sum-to-one constraint is always strictly feasible.
    For n >= 4 this returns DEFAULT_MAX_WEIGHT (0.30) unchanged.
    For n == 3 it auto-raises to 1/3 + epsilon to avoid the exactly-tight bound
    that makes cvxpy declare the problem infeasible due to floating-point.
    """
    return max(DEFAULT_MAX_WEIGHT, 1.0 / n + 1e-6)


def _run_ef(mu, S, risk_score: int):
    """Build and solve an EfficientFrontier; return (ef, objective_used)."""
    n = len(mu)
    max_w = _effective_max_weight(n)
    ef = EfficientFrontier(mu, S, weight_bounds=(0, max_w))
    try:
        if risk_score <= 3:
            ef.min_volatility()
            return ef, "min_volatility"
        elif risk_score <= 6:
            ef.max_sharpe()
            return ef, "max_sharpe"
        else:
            ef.max_quadratic_utility(risk_aversion=0.5)
            return ef, "max_quadratic_utility"
    except OptimizationError as exc:
        print(f"[optimizer] primary objective failed ({exc}); falling back to min_volatility")
        # Pass explicit copies: a failed cvxpy solve can leave internal numpy
        # buffers dirty; re-using the same objects causes a second infeasible error.
        ef = EfficientFrontier(mu.copy(), S.copy(), weight_bounds=(0, max_w))
        ef.min_volatility()
        return ef, "min_volatility (fallback)"


def optimize_portfolio(prices: pd.DataFrame, risk_score: int) -> dict:
    """
    prices     — DataFrame, tickers as columns, daily Close prices as rows.
                 Tickers with fewer than MIN_HISTORY_DAYS non-NaN values are
                 excluded before optimisation.
    risk_score — 1–10 from risk questionnaire
    """
    # --- 1. exclude tickers with insufficient history ---
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

    mu_full = expected_returns.mean_historical_return(prices)
    S_full  = risk_models.CovarianceShrinkage(prices).ledoit_wolf()

    # --- 2. diagnostic log ---
    n_assets = len(valid_cols)
    obs_per_asset = {c: int(prices[c].notna().sum()) for c in prices.columns}
    print("\n=== Portfolio Optimizer Inputs ===")
    print(f"Tickers        : {valid_cols}")
    if excluded_history:
        print(f"Excluded (short history): {excluded_history}")
    print(f"Lookback window: {prices.index[0].date()} → {prices.index[-1].date()}"
          f"  ({len(prices)} trading days after inner join)")
    print(f"Observations per asset : {obs_per_asset}")
    print(f"Expected returns (annualised):\n{mu_full.round(4)}")
    corr = prices.pct_change().dropna().corr().round(3)
    print(f"Correlation matrix:\n{corr}")
    print(f"Covariance matrix (Ledoit-Wolf):\n{S_full.round(6)}")
    eff_max_w = _effective_max_weight(n_assets)
    print(f"Max weight cap : {eff_max_w:.1%}  (default {DEFAULT_MAX_WEIGHT:.0%}"
          + (f", raised for n={n_assets})" if eff_max_w > DEFAULT_MAX_WEIGHT else ")")
          + f"   Min weight : {MIN_WEIGHT:.0%}")
    rule_of_thumb = 5 * n_assets
    if len(prices) < rule_of_thumb:
        print(f"[WARN] Only {len(prices)} observations for {n_assets} assets; "
              f"recommend >= {rule_of_thumb} (5× n_assets) for stable covariance estimates.")

    # --- 3. first-pass solve ---
    ef, objective_used = _run_ef(mu_full, S_full, risk_score)
    weights = ef.clean_weights()

    # --- 4. remove sliver allocations (0 < w < MIN_WEIGHT) and re-solve ---
    slivers = [k for k, v in weights.items() if 0 < v < MIN_WEIGHT]
    if slivers:
        print(f"[optimizer] sliver assets (0 < w < {MIN_WEIGHT:.0%}): {slivers} — excluding and re-solving")
        keep = [c for c in valid_cols if c not in slivers]
        if len(keep) >= 2:
            prices2 = prices[keep]
            mu2 = expected_returns.mean_historical_return(prices2)
            S2  = risk_models.CovarianceShrinkage(prices2).ledoit_wolf()
            ef, objective_used = _run_ef(mu2, S2, risk_score)
            weights = ef.clean_weights()
        else:
            print("[optimizer] too few assets after sliver removal; keeping first-pass result")
            slivers = []   # can't exclude further, report as-is

    ret, vol, sharpe = ef.portfolio_performance(verbose=False)

    zeroed = [k for k, v in weights.items() if v == 0]
    print(f"Objective      : {objective_used}")
    print(f"Active weights : { {k: f'{v:.1%}' for k, v in weights.items() if v > 0} }")
    print(f"Zero-weighted  : {zeroed}")
    if slivers:
        print(f"Sliver-excluded: {slivers}")
    print(f"Return={ret:.2%}  Vol={vol:.2%}  Sharpe={sharpe:.3f}")
    print("==================================\n")

    warnings = []
    if excluded_history:
        warnings.append(
            f"Excluded (insufficient history <{MIN_HISTORY_DAYS} days): {', '.join(excluded_history)}"
        )
    if slivers:
        warnings.append(
            f"Excluded (allocation below {MIN_WEIGHT:.0%} minimum): {', '.join(slivers)}"
        )
    if zeroed:
        warnings.append(
            f"Assigned 0% weight by optimizer (drag on Sharpe ratio): {', '.join(zeroed)}"
        )
    if "fallback" in objective_used:
        warnings.append(
            "Sharpe optimisation infeasible (all assets have negative expected returns). "
            "Showing minimum-volatility allocation instead."
        )

    result = {
        "weights": {k: float(round(v, 4)) for k, v in weights.items()},
        "expected_annual_return_pct": float(round(ret * 100, 2)),
        "annual_volatility_pct":      float(round(vol * 100, 2)),
        "sharpe_ratio":               float(round(sharpe, 3)),
    }
    if warnings:
        result["warnings"] = warnings
    return result
