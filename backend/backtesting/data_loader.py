"""Loads and aligns historical price data for backtesting."""

from __future__ import annotations

from datetime import date

import pandas as pd
import yfinance as yf


def load_prices(
    tickers: list[str],
    start_date: date,
    end_date: date,
) -> tuple[pd.DataFrame, list[str]]:
    """Download adjusted close prices and return an aligned DataFrame.

    Returns (prices_df, warnings) where prices_df has a DatetimeIndex and one
    column per ticker.  Missing trading days are forward-filled; tickers with no
    data at all are dropped and reported in warnings.
    """
    warnings: list[str] = []

    raw = yf.download(
        tickers=tickers,
        start=start_date.isoformat(),
        end=end_date.isoformat(),
        auto_adjust=True,
        progress=False,
        threads=True,
    )

    if raw.empty:
        raise ValueError(f"No price data returned for {tickers} in [{start_date}, {end_date}]")

    if isinstance(raw.columns, pd.MultiIndex):
        prices = raw["Close"].copy()
    else:
        prices = raw[["Close"]].copy()
        prices.columns = tickers

    prices.index = pd.to_datetime(prices.index).tz_localize(None).normalize()

    all_null = [c for c in prices.columns if prices[c].isna().all()]
    for t in all_null:
        warnings.append(f"Ticker '{t}' has no data in [{start_date}, {end_date}] — excluded.")
    prices.drop(columns=all_null, inplace=True)

    if prices.empty:
        raise ValueError("No usable price data after filtering tickers.")

    for t in prices.columns:
        first_valid = prices[t].first_valid_index()
        if first_valid is not None and first_valid.date() > start_date:
            warnings.append(
                f"Ticker '{t}' data starts on {first_valid.date()} (requested {start_date})."
            )

    prices = prices.ffill().dropna()
    return prices, warnings


def align_weights(
    weights: dict[str, float],
    available_tickers: list[str],
    warnings: list[str],
) -> dict[str, float]:
    """Remove tickers without data and re-normalise weights to sum to 1."""
    missing = [t for t in weights if t not in available_tickers]
    for t in missing:
        warnings.append(f"Ticker '{t}' removed from weights (no price data). Weights renormalised.")

    filtered = {t: w for t, w in weights.items() if t in available_tickers}
    if not filtered:
        raise ValueError("No tickers with price data remain after filtering.")

    total = sum(filtered.values())
    return {t: w / total for t, w in filtered.items()}
