"""
Walk-forward out-of-sample comparison of six portfolio construction methods.

Methods compared
----------------
1. MVO max-Sharpe      (risk_score=7 → max_sharpe branch in optimizer.py)
2. MVO min-variance    (risk_score=2 → min_volatility branch)
3. Risk Parity         (inverse-volatility weighting, no pypfopt dependency)
4. Equal-Weight 1/N    (uniform weights)
5. HRP                 (Hierarchical Risk Parity via pypfopt)
6. Black-Litterman     (market-cap prior only — no LLM views, no look-ahead)

No look-ahead bias guarantee
-----------------------------
At every rebalance date t the weight vector is computed from
    prices.loc[:t].iloc[:-1]           # history strictly BEFORE t
and evaluated on returns over
    prices.loc[t:next_t]               # out-of-sample window starting AT t

The critical separation point is marked with "# ← NO LOOK-AHEAD" comments.
"""

from __future__ import annotations

import inspect
import math
import warnings as _py_warnings
from functools import partial
from typing import Literal

import numpy as np
import pandas as pd
from pypfopt import EfficientFrontier, HRPOpt, expected_returns, risk_models

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_TRADING_DAYS = 252
_DEFAULT_TAU = 0.05
_DEFAULT_DELTA = 2.5
_BPS = 1e-4


# ---------------------------------------------------------------------------
# Internal weight-computation helpers (all operate on in-sample data only)
# ---------------------------------------------------------------------------

def _weights_mvo_max_sharpe(prices_in: pd.DataFrame) -> dict[str, float]:
    mu = expected_returns.mean_historical_return(prices_in)
    S = risk_models.CovarianceShrinkage(prices_in).ledoit_wolf()
    n = len(mu)
    max_w = max(0.30, 1.0 / n + 1e-6)
    ef = EfficientFrontier(mu, S, weight_bounds=(0, max_w))
    try:
        ef.max_sharpe()
    except Exception:
        ef = EfficientFrontier(mu.copy(), S.copy(), weight_bounds=(0, max_w))
        ef.min_volatility()
    return dict(ef.clean_weights())


def _weights_mvo_min_var(prices_in: pd.DataFrame) -> dict[str, float]:
    mu = expected_returns.mean_historical_return(prices_in)
    S = risk_models.CovarianceShrinkage(prices_in).ledoit_wolf()
    n = len(mu)
    max_w = max(0.30, 1.0 / n + 1e-6)
    ef = EfficientFrontier(mu, S, weight_bounds=(0, max_w))
    ef.min_volatility()
    return dict(ef.clean_weights())


def _weights_risk_parity(prices_in: pd.DataFrame) -> dict[str, float]:
    """Inverse-volatility (risk parity) weights, normalised to sum to 1."""
    rets = prices_in.pct_change().dropna()
    vol = rets.std()
    vol = vol.replace(0, np.nan).dropna()
    inv_vol = 1.0 / vol
    w = inv_vol / inv_vol.sum()
    return {t: float(w.get(t, 0.0)) for t in prices_in.columns}


def _weights_equal(prices_in: pd.DataFrame) -> dict[str, float]:
    n = len(prices_in.columns)
    return {t: 1.0 / n for t in prices_in.columns}


def _weights_hrp(prices_in: pd.DataFrame) -> dict[str, float]:
    rets = prices_in.pct_change().dropna()
    hrp = HRPOpt(rets)
    hrp.optimize()
    return dict(hrp.clean_weights())


def _weights_bl_prior_only(
    prices_in: pd.DataFrame,
    market_caps: dict[str, float | None] | None = None,
) -> dict[str, float]:
    """
    Black-Litterman with market-cap prior only (no LLM views, no network calls).

    Prior weights are built from the market_caps snapshot supplied by
    run_walk_forward_comparison (fetched once outside the walk-forward loop).
    Delta is fixed at _DEFAULT_DELTA=2.5 (He & Litterman, 1999) — stable
    enough for a rolling comparison and avoids repeated proxy downloads.
    Covariance S is estimated from the in-sample window only — no look-ahead.

    Posterior without views collapses analytically to:
        mu_bl = delta * S * w_market
        S_bl  = (1 + tau) * S
    We then solve a max-Sharpe EF on (mu_bl, S_bl).

    market_caps : snapshot dict {ticker: float|None}, or None.
        None  → equal-weight prior 1/N (explicit fallback, no market data used).
        Mixed → missing tickers receive 1/N flat share; known tickers split the
                remaining budget proportionally by cap (same logic as bl_optimizer._weights_from_caps).
    """
    S = risk_models.CovarianceShrinkage(prices_in).ledoit_wolf()
    tickers = list(prices_in.columns)
    n = len(tickers)

    if market_caps is not None:
        # Mixed prior: missing tickers get equal share 1/n,
        # known tickers share the remaining budget by market cap.
        known = {t: float(market_caps[t]) for t in tickers if market_caps.get(t) is not None}
        missing = [t for t in tickers if market_caps.get(t) is None]
        w_dict: dict[str, float] = {t: 1.0 / n for t in missing}
        if known:
            total_cap = sum(known.values())
            remaining = len(known) / n
            for t, cap in known.items():
                w_dict[t] = (cap / total_cap) * remaining
        w_market = pd.Series(w_dict).reindex(tickers).fillna(1.0 / n)
    else:
        # Fallback: equal-weight prior (no market cap snapshot available)
        w_market = pd.Series(1.0 / n, index=tickers)

    # Equilibrium returns: pi = delta * S * w_market  (Black-Litterman prior)
    pi = _DEFAULT_DELTA * S.values @ w_market.values
    mu_bl = pd.Series(pi, index=tickers)
    S_bl = (1 + _DEFAULT_TAU) * S

    max_w = max(0.30, 1.0 / n + 1e-6)
    ef = EfficientFrontier(mu_bl, S_bl, weight_bounds=(0, max_w))
    try:
        ef.max_sharpe()
    except Exception:
        ef = EfficientFrontier(mu_bl.copy(), S_bl.copy(), weight_bounds=(0, max_w))
        ef.min_volatility()
    return dict(ef.clean_weights())


# ---------------------------------------------------------------------------
# Transaction cost application
# ---------------------------------------------------------------------------

def _apply_tx_cost(
    portfolio_value: float,
    old_weights: dict[str, float],
    new_weights: dict[str, float],
    tx_cost_bps: float,
) -> float:
    """Deduct round-trip transaction costs for weight changes.  Returns new NAV."""
    tickers = set(old_weights) | set(new_weights)
    turnover = sum(
        abs(new_weights.get(t, 0.0) - old_weights.get(t, 0.0))
        for t in tickers
    )
    cost = portfolio_value * turnover * tx_cost_bps * _BPS
    return portfolio_value - cost


# ---------------------------------------------------------------------------
# Weight-function calling helper
# ---------------------------------------------------------------------------

def _call_weight_fn(
    fn,
    prices_in: pd.DataFrame,
    rebalance_date: pd.Timestamp,
) -> dict[str, float]:
    """
    Call fn(prices_in), optionally passing rebalance_date as a keyword argument.

    If fn's signature includes 'rebalance_date', it is passed so that test spies
    and future weight functions can assert the true rebalance date directly.
    Functions that do not declare the parameter are called without it — fully
    retrocompatible with all existing weight helpers.
    """
    try:
        params = inspect.signature(fn).parameters
    except (ValueError, TypeError):
        params = {}
    if "rebalance_date" in params:
        return fn(prices_in, rebalance_date=rebalance_date)
    return fn(prices_in)


# ---------------------------------------------------------------------------
# Out-of-sample NAV simulation for a single method
# ---------------------------------------------------------------------------

def _simulate_oos(
    prices: pd.DataFrame,
    rebalance_dates: list[pd.Timestamp],
    weight_fn,
    estimation_window: int,
    tx_cost_bps: float,
) -> pd.Series:
    """
    Simulate a daily NAV series using walk-forward rebalancing.

    At each rebalance date t the weight vector is estimated from the
    estimation_window days of prices ENDING THE DAY BEFORE t.   # ← NO LOOK-AHEAD

    weight_fn is called via _call_weight_fn, which passes the true rebalance
    date as a keyword argument when the function's signature accepts it.

    Returns a daily NAV Series aligned to the out-of-sample period
    (from the first rebalance date onward).
    """
    nav = 1.0
    current_weights: dict[str, float] = {}
    nav_series: dict[pd.Timestamp, float] = {}

    all_dates = prices.index
    rebalance_set = set(rebalance_dates)

    for i, date in enumerate(all_dates):
        # On rebalance dates: compute new weights from in-sample history only
        if date in rebalance_set:
            # In-sample slice: strictly BEFORE current date  # ← NO LOOK-AHEAD
            in_sample = prices.loc[prices.index < date].tail(estimation_window)  # ← NO LOOK-AHEAD

            if len(in_sample) < 30 or len(in_sample.columns) < 2:
                # Not enough history yet — fall back to equal weight
                new_weights = _weights_equal(in_sample)
            else:
                try:
                    with _py_warnings.catch_warnings():
                        _py_warnings.simplefilter("ignore")
                        new_weights = _call_weight_fn(weight_fn, in_sample, date)
                except Exception:
                    new_weights = _weights_equal(in_sample)

            # Apply transaction cost for rebalancing
            if current_weights:
                nav = _apply_tx_cost(nav, current_weights, new_weights, tx_cost_bps)
            current_weights = new_weights

        if not current_weights:
            continue

        # Record NAV at start of day (before returns)
        nav_series[date] = nav

        # Apply daily returns
        if i + 1 < len(all_dates):
            next_date = all_dates[i + 1]
            day_ret = 0.0
            for ticker, w in current_weights.items():
                if ticker in prices.columns:
                    p0 = prices.loc[date, ticker]
                    p1 = prices.loc[next_date, ticker]
                    if pd.notna(p0) and pd.notna(p1) and p0 > 0:
                        day_ret += w * (p1 / p0 - 1)
            nav *= (1 + day_ret)

    return pd.Series(nav_series)


# ---------------------------------------------------------------------------
# Metrics computed on an OOS NAV series
# ---------------------------------------------------------------------------

def _compute_row_metrics(nav: pd.Series, risk_free_rate: float) -> dict:
    daily_rets = nav.pct_change().dropna()
    if len(daily_rets) < 10:
        return {"cagr_pct": None, "vol_pct": None, "sharpe": None, "sortino": None, "max_dd_pct": None}

    n_years = (nav.index[-1] - nav.index[0]).days / 365.25
    cagr = (nav.iloc[-1] / nav.iloc[0]) ** (1 / n_years) - 1 if n_years > 0 else 0.0
    vol = daily_rets.std() * math.sqrt(_TRADING_DAYS)

    daily_rf = (1 + risk_free_rate) ** (1 / _TRADING_DAYS) - 1
    excess = daily_rets - daily_rf
    sharpe = float((excess.mean() / excess.std()) * math.sqrt(_TRADING_DAYS)) if excess.std() > 0 else None

    downside = daily_rets[daily_rets < daily_rf]
    downside_std = downside.std() * math.sqrt(_TRADING_DAYS) if len(downside) > 1 else None
    sortino = float((cagr - risk_free_rate) / downside_std) if downside_std and downside_std > 0 else None

    rolling_max = nav.cummax()
    max_dd = float(((nav - rolling_max) / rolling_max).min())

    return {
        "cagr_pct":   round(cagr * 100, 2),
        "vol_pct":    round(vol * 100, 2),
        "sharpe":     round(sharpe, 3) if sharpe is not None else None,
        "sortino":    round(sortino, 3) if sortino is not None else None,
        "max_dd_pct": round(max_dd * 100, 2),
    }


# ---------------------------------------------------------------------------
# Rebalance date generation
# ---------------------------------------------------------------------------

def _get_rebalance_dates(
    index: pd.DatetimeIndex,
    freq: Literal["monthly", "quarterly", "weekly"],
    start_from: pd.Timestamp,
) -> list[pd.Timestamp]:
    """Return trading dates that fall on the first trading day of each period."""
    subset = index[index >= start_from]
    if freq == "weekly":
        period_key = subset.to_period("W")
    elif freq == "quarterly":
        period_key = subset.to_period("Q")
    else:
        period_key = subset.to_period("M")

    seen: set = set()
    dates: list[pd.Timestamp] = []
    for dt, pk in zip(subset, period_key):
        if pk not in seen:
            seen.add(pk)
            dates.append(dt)
    return dates


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_walk_forward_comparison(
    prices_df: pd.DataFrame,
    estimation_window: int = 252,
    rebalance_freq: Literal["monthly", "quarterly", "weekly"] = "monthly",
    transaction_cost_bps: float = 10.0,
    risk_free_rate: float = 0.02,
    market_caps: dict[str, float | None] | None = None,
) -> pd.DataFrame:
    """
    Walk-forward out-of-sample comparison of six portfolio methods.

    Parameters
    ----------
    prices_df : pd.DataFrame
        Daily Close prices.  Rows = trading days (DatetimeIndex), columns = tickers.
        Must contain at least estimation_window + 30 rows.
    estimation_window : int
        Number of trading days used to estimate weights at each rebalance date.
        Default 252 (one year).
    rebalance_freq : {"monthly", "quarterly", "weekly"}
        How often weights are recalculated.  Default "monthly".
    transaction_cost_bps : float
        Round-trip transaction cost in basis points applied at each rebalance.
        Default 10 bps.
    risk_free_rate : float
        Annual risk-free rate for Sharpe / Sortino.  Default 0.02.
    market_caps : dict[str, float | None] | None
        Optional market-cap snapshot for the Black-Litterman prior.
        Fetch this ONCE before calling (e.g. via get_market_caps(tickers)) so
        the walk-forward loop never makes network calls.
        None → BL falls back to equal-weight prior (1/N).

    Returns
    -------
    pd.DataFrame
        One row per method, columns: method, cagr_pct, vol_pct, sharpe,
        sortino, max_dd_pct.
    """
    prices_df = prices_df.dropna(axis=1, how="all").copy()

    if len(prices_df) < estimation_window + 30:
        raise ValueError(
            f"prices_df has only {len(prices_df)} rows; need at least "
            f"{estimation_window + 30} (estimation_window + 30)."
        )

    # Out-of-sample starts after the first full estimation window.
    # This date is the FIRST rebalance date.
    oos_start_idx = estimation_window
    oos_start_date = prices_df.index[oos_start_idx]  # ← NO LOOK-AHEAD boundary

    rebalance_dates = _get_rebalance_dates(prices_df.index, rebalance_freq, oos_start_date)

    # BL prior is fixed once from the market_caps snapshot — no network call inside the loop.
    # partial binds market_caps into the function so _simulate_oos needs no special handling.
    bl_fn = partial(_weights_bl_prior_only, market_caps=market_caps)

    methods: dict[str, object] = {
        "MVO max-Sharpe":   _weights_mvo_max_sharpe,
        "MVO min-variance": _weights_mvo_min_var,
        "Risk Parity":      _weights_risk_parity,
        "Equal-Weight":     _weights_equal,
        "HRP":              _weights_hrp,
        "Black-Litterman":  bl_fn,
    }

    rows = []
    for method_name, weight_fn in methods.items():
        nav = _simulate_oos(
            prices=prices_df,           # full series (in-sample slice enforced inside)
            rebalance_dates=rebalance_dates,
            weight_fn=weight_fn,
            estimation_window=estimation_window,
            tx_cost_bps=transaction_cost_bps,
        )
        # Metrics computed only on OOS period                    # ← NO LOOK-AHEAD
        oos_nav = nav.loc[nav.index >= oos_start_date]
        metrics = _compute_row_metrics(oos_nav, risk_free_rate)
        rows.append({"method": method_name, **metrics})

    return pd.DataFrame(rows).set_index("method")
