import yfinance as yf
import pandas as pd


def get_price_history(ticker: str, period: str = "1y", start_date: str = None) -> pd.DataFrame:
    ticker_obj = yf.Ticker(ticker)
    if start_date:
        from datetime import date
        hist = ticker_obj.history(start=start_date, end=date.today().isoformat())
    else:
        hist = ticker_obj.history(period=period)
    return hist[["Close", "Volume"]].dropna()


def get_current_price(ticker: str) -> float:
    return yf.Ticker(ticker).fast_info.last_price


def get_stock_info(ticker: str) -> dict:
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
