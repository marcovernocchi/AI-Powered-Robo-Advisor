"""Black-Litterman portfolio optimisation (separate from the MVO optimizer)."""

from __future__ import annotations

import pandas as pd
from pypfopt import BlackLittermanModel, risk_models
from pypfopt.exceptions import OptimizationError  # noqa: F401 — imported so callers can catch it

from backend.models.optimizer import _run_ef, MIN_HISTORY_DAYS, MIN_WEIGHT
from backend.services.market_data import get_market_caps, get_price_history

_MARKET_PROXY = "^GSPC"
_DEFAULT_DELTA = 2.5        # He & Litterman (1999) classic value
_DEFAULT_TAU = 0.05         # standard BL scaling factor
_DELTA_CLAMP = (1.0, 5.0)   # plausible range per BL literature (He-Litterman ~2–4)


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _compute_delta(warnings: list[str]) -> float:
    """
    Estimate market-implied risk aversion (delta) from the S&P 500 proxy.

    Tries progressively shorter windows ("5y" → "2y" → "1y") to work around
    gaps in historical data.  Once a window returns enough data, delta is
    computed; if it falls outside _DELTA_CLAMP=[1, 5] the default 2.5 is used
    instead (shorter windows won't improve an implausible estimate).

    A warning is appended *and* printed so it is always visible during testing.
    """
    lo, hi = _DELTA_CLAMP
    for period in ("5y", "2y", "1y"):
        try:
            proxy_df = get_price_history(_MARKET_PROXY, period=period)
            if proxy_df.empty or len(proxy_df) < 30:
                continue                         # not enough data — try shorter window
            daily_ret = proxy_df["Close"].pct_change().dropna()
            ann_ret = float((1 + daily_ret.mean()) ** 252 - 1)
            ann_var = float((daily_ret.std() * 252 ** 0.5) ** 2)
            if ann_var <= 0:
                continue
            raw_delta = ann_ret / ann_var
            if lo <= raw_delta <= hi:
                print(f"[BL] delta ({period} window, {_MARKET_PROXY}): {raw_delta:.4f}")
                return raw_delta
            # Delta computed but out of plausible range — use default immediately;
            # shorter windows would use the same market and give similar results.
            msg = (
                f"Estimated delta={raw_delta:.2f} ({period} {_MARKET_PROXY} data) "
                f"outside plausible range [{lo}, {hi}]; "
                f"using default delta={_DEFAULT_DELTA}"
            )
            print(f"[BL] WARNING: {msg}")
            warnings.append(msg)
            return _DEFAULT_DELTA
        except Exception:
            continue                             # network / parse error — try shorter window

    msg = (
        f"Market proxy ({_MARKET_PROXY}) unavailable across all windows (5y/2y/1y); "
        f"using default delta={_DEFAULT_DELTA}"
    )
    print(f"[BL] WARNING: {msg}")
    warnings.append(msg)
    return _DEFAULT_DELTA


def _weights_from_caps(
    tickers: list[str],
    market_caps_raw: dict[str, float | None],
) -> pd.Series:
    """
    Return normalised prior weights using a mixed strategy:

    - Tickers with a known market cap: each receives a proportional share of
      the budget reserved for known-cap tickers (= n_known / n_total).
    - Tickers with a missing cap: each receives a flat equal share of 1 / n_total.

    This always sums to exactly 1:
        n_missing * (1/n) + sum_known(cap_i/total_cap * n_known/n) = 1
    """
    n = len(tickers)
    known = {t: float(market_caps_raw[t]) for t in tickers if market_caps_raw.get(t) is not None}
    missing = [t for t in tickers if market_caps_raw.get(t) is None]

    weights: dict[str, float] = {}

    for t in missing:
        weights[t] = 1.0 / n                             # flat equal share

    if known:
        remaining_budget = len(known) / n                # budget for cap-based tickers
        total_cap = sum(known.values())
        for t, cap in known.items():
            weights[t] = (cap / total_cap) * remaining_budget

    return pd.Series(weights)


def _bl_ef_pass(
    prices: pd.DataFrame,
    S: pd.DataFrame,
    pi: pd.Series,
    views: dict[str, float] | None,
    view_confidences: dict[str, float] | None,
    risk_score: int,
) -> tuple:
    """
    Run one full Black-Litterman + EfficientFrontier pass.

    S and pi must be consistent (both derived from prices passed here).
    Returns (ef, objective_used).

    When no views apply to the current ticker set, the BL posterior collapses
    to the prior (pi, S) — we skip BlackLittermanModel entirely since pypfopt
    requires at least one view to build the Q matrix.
    """
    tickers = list(prices.columns)
    pi_sub = pi.reindex(tickers)

    # Filter views to the tickers actually present in this pass
    active_views: dict[str, float] = {}
    if views:
        active_views = {t: v for t, v in views.items() if t in tickers}

    if active_views:
        bl_kwargs: dict = {
            "cov_matrix": S,
            "pi": pi_sub,
            "tau": _DEFAULT_TAU,
            "absolute_views": active_views,
        }
        if view_confidences:
            # Idzorek omega requires one confidence value per view
            bl_kwargs["omega"] = "idzorek"
            bl_kwargs["view_confidences"] = [
                view_confidences.get(t, 0.5) for t in active_views
            ]
        else:
            bl_kwargs["omega"] = "default"

        bl_model = BlackLittermanModel(**bl_kwargs)
        mu_bl = bl_model.bl_returns()
        S_bl = bl_model.bl_cov()
    else:
        # No views for this ticker set — posterior == prior
        # BL covariance posterior without views: (tau^-1 * S^-1)^-1 = (1+tau)*S
        mu_bl = pi_sub
        S_bl = (1 + _DEFAULT_TAU) * S

    return _run_ef(mu_bl, S_bl, risk_score)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def optimize_black_litterman(
    prices: pd.DataFrame,
    risk_score: int,
    views: dict | None = None,
    view_confidences: dict | None = None,
) -> dict:
    """
    Black-Litterman portfolio optimisation.

    Output format matches optimize_portfolio, with the addition of
    "method": "black_litterman".

    prices           — DataFrame, tickers as columns, daily Close prices
    risk_score       — 1–10 from the risk questionnaire
    views            — absolute views {ticker: expected_annual_return} (optional)
    view_confidences — Idzorek confidence per view {ticker: 0..1} (optional,
                       defaults to 0.5 for any view without an explicit entry)
    """
    warnings: list[str] = []

    # 1. exclude tickers with insufficient history (mirrors optimize_portfolio)
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

    tickers = list(prices.columns)
    print("\n=== Black-Litterman Optimizer ===")
    print(f"Tickers : {tickers}")
    if excluded_history:
        print(f"Excluded (short history): {excluded_history}")
    if views:
        print(f"Views   : {views}")
        print(f"Conf.   : {view_confidences or 'default 0.5 per view'}")

    # 2. delta (market-implied risk aversion)
    delta = _compute_delta(warnings)

    # 3. market caps — one network call, reused for all passes
    market_caps_raw = get_market_caps(tickers)
    missing_caps = [t for t in tickers if market_caps_raw.get(t) is None]

    if missing_caps:
        msg = (
            f"Market cap unavailable for {missing_caps}; "
            f"equal-weight share (1/{len(tickers)}) applied to those tickers, "
            "cap-based weights used for the rest"
        )
        print(f"[BL] WARNING: {msg}")
        warnings.append(msg)

    w_prior = _weights_from_caps(tickers, market_caps_raw)
    print(f"[BL] prior weights: { {t: f'{v:.3f}' for t, v in w_prior.items()} }")

    # 4. first-pass: covariance + pi + BL + EF
    S_full = risk_models.CovarianceShrinkage(prices).ledoit_wolf()
    pi = delta * S_full.dot(w_prior)

    ef, objective_used = _bl_ef_pass(prices, S_full, pi, views, view_confidences, risk_score)
    weights = ef.clean_weights()

    # 5. sliver removal — recompute BL from scratch for the reduced ticker set
    slivers = [k for k, v in weights.items() if 0 < v < MIN_WEIGHT]
    if slivers:
        print(f"[BL] sliver assets: {slivers} — excluding and re-solving")
        keep = [c for c in tickers if c not in slivers]
        if len(keep) >= 2:
            prices2 = prices[keep]
            S2 = risk_models.CovarianceShrinkage(prices2).ledoit_wolf()
            w_prior2 = _weights_from_caps(keep, market_caps_raw)
            pi2 = delta * S2.dot(w_prior2)
            ef, objective_used = _bl_ef_pass(prices2, S2, pi2, views, view_confidences, risk_score)
            weights = ef.clean_weights()
        else:
            print("[BL] too few assets after sliver removal; keeping first-pass result")
            slivers = []

    ret, vol, sharpe = ef.portfolio_performance(verbose=False)

    zeroed = [k for k, v in weights.items() if v == 0]
    print(f"Objective      : {objective_used}")
    print(f"Active weights : { {k: f'{v:.1%}' for k, v in weights.items() if v > 0} }")
    print(f"Return={ret:.2%}  Vol={vol:.2%}  Sharpe={sharpe:.3f}")
    print("=================================\n")

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
            f"Assigned 0% weight by optimizer: {', '.join(zeroed)}"
        )
    if "fallback" in objective_used:
        warnings.append(
            "Sharpe optimisation infeasible (all assets have negative expected returns). "
            "Showing minimum-volatility allocation instead."
        )

    result: dict = {
        "weights":                    {k: float(round(v, 4)) for k, v in weights.items()},
        "expected_annual_return_pct": float(round(ret * 100, 2)),
        "annual_volatility_pct":      float(round(vol * 100, 2)),
        "sharpe_ratio":               float(round(sharpe, 3)),
        "method":                     "black_litterman",
    }
    if warnings:
        result["warnings"] = warnings
    return result
