import yfinance as yf
import pandas as pd
import requests
from datetime import datetime, timedelta
from backend.config import settings
from backend.database import SessionLocal
from backend.db.models import PriceCache

_AV_BASE = "https://www.alphavantage.co/query"
_CACHE_TTL_HOURS = 72
_CACHE_FRESH_MINUTES = 15


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
    outputsize = "full" if period in ("5y", "max") else "compact"
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


# ---------- Price cache helpers ----------

def _save_price_cache(ticker: str, price: float) -> None:
    db = SessionLocal()
    try:
        entry = db.query(PriceCache).filter(PriceCache.ticker == ticker).first()
        if entry:
            entry.price = price
            entry.updated_at = datetime.utcnow()
        else:
            db.add(PriceCache(ticker=ticker, price=price, updated_at=datetime.utcnow()))
        db.commit()
    except Exception:
        pass
    finally:
        db.close()


def _get_price_cache(ticker: str) -> tuple[float | None, bool, bool]:
    """Returns (price, is_fresh, is_stale).
    is_fresh=True if updated within 5 min (skip live API).
    is_stale=True if older than 72h (show warning in UI).
    """
    db = SessionLocal()
    try:
        entry = db.query(PriceCache).filter(PriceCache.ticker == ticker).first()
        if entry is None:
            return None, False, True
        age = datetime.utcnow() - entry.updated_at
        is_fresh = age < timedelta(minutes=_CACHE_FRESH_MINUTES)
        is_stale = age > timedelta(hours=_CACHE_TTL_HOURS)
        return entry.price, is_fresh, is_stale
    except Exception:
        return None, False, True
    finally:
        db.close()


def _fetch_live_price(ticker: str) -> float | None:
    """Try Alpha Vantage then yfinance. Returns None if both fail."""
    price = _av_get_current_price(ticker)
    if price is not None:
        return price
    try:
        fast_info = yf.Ticker(ticker).fast_info
        price = fast_info.last_price
        if not price:
            return None
        # LSE quotes are often in pence (GBp/GBX); convert to pounds
        if fast_info.currency in ('GBp', 'GBX'):
            price = price / 100
        return float(price)
    except Exception:
        return None


# ---------- Public API ----------

def get_current_price(ticker: str) -> float:
    """Fresh cache → live API → stale cache. Raises if nothing available."""
    cached_price, is_fresh, _ = _get_price_cache(ticker)
    if is_fresh and cached_price is not None:
        return cached_price
    price = _fetch_live_price(ticker)
    if price is not None:
        _save_price_cache(ticker, price)
        return price
    if cached_price is not None:
        return cached_price
    raise ValueError(f"No price available for {ticker}")


def _fetch_and_cache(ticker: str) -> tuple[str, dict]:
    cached_price, is_fresh, is_stale = _get_price_cache(ticker)
    if is_fresh and cached_price is not None:
        return ticker, {"price": cached_price, "stale": False}
    price = _fetch_live_price(ticker)
    if price is not None:
        _save_price_cache(ticker, price)
        return ticker, {"price": price, "stale": False}
    return ticker, {"price": cached_price, "stale": cached_price is not None}


def get_multiple_prices(tickers: list) -> dict:
    """Returns {ticker: {"price": float | None, "stale": bool}}. Fetches in parallel."""
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(len(tickers), 10)) as ex:
        return dict(ex.map(_fetch_and_cache, tickers))


def get_price_history(ticker: str, period: str = "1y", start_date: str = None) -> pd.DataFrame:
    """Alpha Vantage first, yfinance fallback."""
    df = _av_get_history(ticker, period)
    if df is not None and not df.empty:
        if start_date:
            df = df[df.index >= pd.to_datetime(start_date)]
        return df.dropna()

    ticker_obj = yf.Ticker(ticker)
    if start_date:
        from datetime import date
        hist = ticker_obj.history(start=start_date, end=date.today().isoformat())
    else:
        hist = ticker_obj.history(period=period)
    return hist[["Close", "Volume"]].dropna()


def get_dividend_history(ticker: str, start_date: str = None) -> pd.DataFrame:
    """Returns dividend history with Date index and Dividend column."""
    try:
        divs = yf.Ticker(ticker).dividends
        if divs.empty:
            return pd.DataFrame(columns=['Dividend'])
        divs = divs.reset_index()
        divs.columns = ['Date', 'Dividend']
        divs['Date'] = pd.to_datetime(divs['Date']).dt.tz_localize(None).dt.normalize()
        if start_date:
            divs = divs[divs['Date'] >= pd.to_datetime(start_date)]
        return divs.set_index('Date')
    except Exception:
        return pd.DataFrame(columns=['Dividend'])


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
