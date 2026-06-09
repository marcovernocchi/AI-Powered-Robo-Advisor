from __future__ import annotations

from datetime import date, timedelta

import numpy as np
from sklearn.covariance import OAS

from backend.backtesting.data_loader import load_prices, align_weights
from backend.monte_carlo.schemas import AssetOverride, MonteCarloInput, MonteCarloResult, PercentileSeries

# Steps per year for the simulation (monthly granularity)
STEPS_PER_YEAR = 12
# Minimum trading days of history required per asset
MIN_HISTORY_DAYS = 252


def _estimate_expected_returns(
    tickers: list[str],
    mu_annual_hist: np.ndarray,
    shrinkage_lambda: float,
    long_run_return: float,
    overrides: dict[str, AssetOverride],
) -> tuple[np.ndarray, dict[str, str]]:
    """Apply the three-level hierarchy to produce final expected returns.

    Hierarchy (highest priority first):
      1. Manual override (asset_overrides[ticker].expected_return)
      2. Shrinkage toward long-run prior: (1-λ)*r_hist + λ*long_run_return
      3. Pure historical (λ=0 case of shrinkage)

    Returns:
        mu_final: array of annual expected returns (decimal fractions)
        sources:  dict mapping ticker → "manual" | "shrinkage" | "historical"
    """
    # Step 1: apply shrinkage to all assets
    mu_final = (1.0 - shrinkage_lambda) * mu_annual_hist + shrinkage_lambda * long_run_return
    sources = {
        t: "historical" if shrinkage_lambda == 0.0 else "shrinkage"
        for t in tickers
    }

    # Step 2: override individual assets where the user has specified a manual return
    for i, ticker in enumerate(tickers):
        ov = overrides.get(ticker)
        if ov is not None and ov.expected_return is not None:
            mu_final[i] = ov.expected_return
            sources[ticker] = "manual"

    return mu_final, sources


def _apply_volatility_overrides(
    tickers: list[str],
    cov_annual: np.ndarray,
    overrides: dict[str, AssetOverride],
) -> np.ndarray:
    """Replace per-asset diagonal volatilities while preserving OAS correlations.

    Extracts the OAS correlation matrix, substitutes the overridden standard
    deviations, then reconstructs C = D @ corr @ D.  This keeps the
    cross-asset correlation structure intact.
    """
    if not any(
        ov.expected_volatility is not None
        for ov in overrides.values()
        if ov is not None
    ):
        return cov_annual

    # Extract current std-devs and correlation matrix
    std_devs = np.sqrt(np.diag(cov_annual))
    with np.errstate(invalid="ignore"):
        D_inv = np.diag(np.where(std_devs > 0, 1.0 / std_devs, 0.0))
    corr = D_inv @ cov_annual @ D_inv

    # Replace overridden volatilities
    new_std = std_devs.copy()
    for i, ticker in enumerate(tickers):
        ov = overrides.get(ticker)
        if ov is not None and ov.expected_volatility is not None:
            new_std[i] = ov.expected_volatility

    D_new = np.diag(new_std)
    return D_new @ corr @ D_new


def run_monte_carlo(params: MonteCarloInput, rng: np.random.Generator | None = None) -> MonteCarloResult:
    if rng is None:
        rng = np.random.default_rng()

    warnings: list[str] = []

    # --- 1. Load historical prices ---
    end_date = date.today()
    start_date = end_date - timedelta(days=int(params.lookback_years * 365.25) + 10)
    tickers = list(params.weights.keys())

    prices, load_warnings = load_prices(tickers, start_date, end_date)
    warnings.extend(load_warnings)

    weights = align_weights(params.weights, list(prices.columns), warnings)

    # Drop assets with insufficient history
    enough = [t for t in prices.columns if prices[t].count() >= MIN_HISTORY_DAYS]
    dropped = [t for t in prices.columns if t not in enough]
    if dropped:
        warnings.append(f"Insufficient history for {', '.join(dropped)} — excluded from simulation")
    prices = prices[enough]
    weights = align_weights(weights, enough, warnings)

    if prices.empty or not weights:
        raise ValueError("No assets with sufficient historical data to run simulation")

    ordered_tickers = list(weights.keys())
    prices = prices[ordered_tickers]
    w = np.array([weights[t] for t in ordered_tickers])

    # --- 2. Estimate returns and covariance from log-returns ---
    log_ret = np.log(prices / prices.shift(1)).dropna()

    # Annualised mean (arithmetic from log-return mean + variance correction, GBM Itô formula)
    mu_daily = log_ret.mean().values
    sigma2_daily = log_ret.var().values
    mu_annual_hist = np.exp((mu_daily + 0.5 * sigma2_daily) * 252) - 1

    # OAS regularised covariance of daily log-returns → scale to annual
    oas = OAS()
    oas.fit(log_ret.values)
    cov_daily = oas.covariance_
    cov_annual = cov_daily * 252

    # Apply volatility overrides: replace diagonal vols while keeping OAS correlations
    cov_annual = _apply_volatility_overrides(ordered_tickers, cov_annual, params.asset_overrides)

    # Apply return estimation hierarchy: manual override > shrinkage > historical
    mu_annual, return_sources = _estimate_expected_returns(
        ordered_tickers,
        mu_annual_hist,
        params.shrinkage_lambda,
        params.long_run_return,
        params.asset_overrides,
    )

    # Cholesky decomposition for correlated draws
    try:
        L = np.linalg.cholesky(cov_annual)
    except np.linalg.LinAlgError:
        # Fall back to nearest positive-definite via eigenvalue clipping
        eigvals, eigvecs = np.linalg.eigh(cov_annual)
        eigvals = np.clip(eigvals, 1e-8, None)
        cov_annual = eigvecs @ np.diag(eigvals) @ eigvecs.T
        L = np.linalg.cholesky(cov_annual)
        warnings.append("Covariance matrix was not positive-definite; eigenvalue clipping applied")

    n_assets = len(ordered_tickers)
    n_steps = params.horizon_years * STEPS_PER_YEAR

    # Monthly parameters derived from annual
    mu_monthly = (1 + mu_annual) ** (1 / STEPS_PER_YEAR) - 1
    # Covariance scales linearly with time
    cov_monthly = cov_annual / STEPS_PER_YEAR
    # Re-cholesky on monthly cov
    try:
        L_m = np.linalg.cholesky(cov_monthly)
    except np.linalg.LinAlgError:
        L_m = L / np.sqrt(STEPS_PER_YEAR)

    # --- 3. Simulate ---
    # portfolio_paths shape: (n_simulations, n_steps + 1)
    portfolio_paths = np.empty((params.n_simulations, n_steps + 1))
    portfolio_paths[:, 0] = params.initial_capital

    # Pre-draw all random numbers at once for performance
    # z shape: (n_steps, n_simulations, n_assets)
    z = rng.standard_normal((n_steps, params.n_simulations, n_assets))

    # Correlated returns: shape (n_steps, n_simulations, n_assets)
    # r_t = mu_monthly + L_m @ z_t  (for each simulation step)
    # Using einsum for the matrix multiply across simulations
    corr_z = z @ L_m.T  # (n_steps, n_simulations, n_assets)

    # Asset returns each step: mu_monthly + corr_z
    asset_returns = mu_monthly[np.newaxis, np.newaxis, :] + corr_z  # (n_steps, n_sims, n_assets)

    # Portfolio return at each step: dot with weights
    port_returns = asset_returns @ w  # (n_steps, n_sims)

    # Simulate portfolio value with optional monthly contribution
    values = portfolio_paths[:, 0].copy()  # (n_sims,)
    for step in range(n_steps):
        values = values * (1 + port_returns[step]) + params.monthly_contribution
        portfolio_paths[:, step + 1] = values

    # --- 4. Compute output statistics ---
    # Time labels: start from today's year, one label per year
    current_year = date.today().year
    # We output one value per year (12 steps apart) + t=0
    yearly_indices = list(range(0, n_steps + 1, STEPS_PER_YEAR))
    # Ensure last step is included
    if yearly_indices[-1] != n_steps:
        yearly_indices.append(n_steps)

    yearly_paths = portfolio_paths[:, yearly_indices]  # (n_sims, n_years+1)

    time_labels = [str(current_year + i) for i in range(len(yearly_indices))]

    p5  = np.percentile(yearly_paths, 5,  axis=0).tolist()
    p25 = np.percentile(yearly_paths, 25, axis=0).tolist()
    p50 = np.percentile(yearly_paths, 50, axis=0).tolist()
    p75 = np.percentile(yearly_paths, 75, axis=0).tolist()
    p95 = np.percentile(yearly_paths, 95, axis=0).tolist()

    final_values = portfolio_paths[:, -1]
    mean_final = float(np.mean(final_values))
    median_final = float(np.median(final_values))

    prob_target = None
    if params.target_value is not None:
        prob_target = float(np.mean(final_values >= params.target_value))

    ann_ret = {t: round(float(mu_annual[i]) * 100, 2) for i, t in enumerate(ordered_tickers)}
    ann_vol = {t: round(float(np.sqrt(cov_annual[i, i])) * 100, 2) for i, t in enumerate(ordered_tickers)}

    return MonteCarloResult(
        time_labels=time_labels,
        percentiles=PercentileSeries(p5=p5, p25=p25, p50=p50, p75=p75, p95=p95),
        mean_final=mean_final,
        median_final=median_final,
        prob_target=prob_target,
        annualized_returns=ann_ret,
        annualized_volatilities=ann_vol,
        return_sources=return_sources,
        warnings=warnings,
    )
