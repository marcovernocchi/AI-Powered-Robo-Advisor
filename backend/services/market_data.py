import yfinance as yf
import pandas as pd
import requests
from backend.config import settings

_AV_BASE = "https://www.alphavantage.co/query"


def _av_key() -> str:
    return settings.alpha_vantage_api_key


# ---------- Alpha Vantage helpers ----------

def _av_get_current_price(ticker: str) -> float | None:
    """Fetch latest price from Alpha Vantage (GLOBAL_QUOTE)."""
    if not _av_key():
        return None
    try:
        r = requests.get(_AV_BASE, params={
            "function": "GLOBAL_QUOTE",
            "symbol": ticker,
            "apikey": _av_key(),
        }, timeout=8)
        data = r.json().get("Global Quote", {})
        price = data.get("05. price")
        return float(price) if price else None
    except Exception:
        return None


def _av_get_history(ticker: str, period: str = "1y") -> pd.DataFrame | None:
    """Fetch daily adjusted history from Alpha Vantage."""
    if not _av_key():
        return None
    # Map yfinance period names to AV output size
    outputsize = "full" if period in ("5y", "max") else "compact"  # compact = last 100 days
    try:
        r = requests.get(_AV_BASE, params={
            "function": "TIME_SERIES_DAILY",
            "symbol": ticker,
            "outputsize": outputsize,
            "apikey": _av_key(),
        }, timeout=10)
        ts = r.json().get("Time Series (Daily)", {})
        if not ts:
            return None
        df = pd.DataFrame([
            {"Date": date, "Close": float(v["4. close"]), "Volume": float(v["5. volume"])}
            for date, v in ts.items()
        ])
        df["Date"] = pd.to_datetime(df["Date"])
        df = df.sort_values("Date").set_index("Date")
        return df[["Close", "Volume"]]
    except Exception:
        return None


# ---------- Public API ----------

def get_current_price(ticker: str) -> float:
    """Alpha Vantage first, yfinance fallback."""
    price = _av_get_current_price(ticker)
    if price is not None:
        return price
    return yf.Ticker(ticker).fast_info.last_price


def get_price_history(ticker: str, period: str = "1y", start_date: str = None) -> pd.DataFrame:
    """Alpha Vantage first, yfinance fallback."""
    df = _av_get_history(ticker, period)
    if df is not None and not df.empty:
        if start_date:
            df = df[df.index >= pd.to_datetime(start_date)]
        return df.dropna()

    # yfinance fallback
    ticker_obj = yf.Ticker(ticker)
    if start_date:
        from datetime import date
        hist = ticker_obj.history(start=start_date, end=date.today().isoformat())
    else:
        hist = ticker_obj.history(period=period)
    return hist[["Close", "Volume"]].dropna()


def get_stock_info(ticker: str) -> dict:
    """yfinance for company info (AV overview costs credits)."""
    info = yf.Ticker(ticker).info
    return {
        "name": info.get("longName", ticker),
        "sector": info.get("sector", "N/A"),
        "market_cap": info.get("marketCap", 0),
        "pe_ratio": info.get("trailingPE"),
        "dividend_yield": info.get("dividendYield"),
        "52w_high": info.get("fiftyTwoWeekHigh"),
        "52w_low": info.get("fiftyTwoWeekLow"),
        "description": info.get("longBusinessSummary", "")[:400],
    }


def get_multiple_prices(tickers: list) -> dict:
    result = {}
    for ticker in tickers:
        try:
            result[ticker] = get_current_price(ticker)
        except Exception:
            result[ticker] = None
    return result
