import yfinance as yf
from fastapi import APIRouter, Query
from backend.services.market_data import get_price_history, get_stock_info, get_current_price, get_dividend_history

router = APIRouter(prefix="/market", tags=["market"])

PERIODS = ["5d", "1mo", "3mo", "6mo", "ytd", "1y", "2y", "5y", "max"]


@router.get("/price/{ticker}")
def price(ticker: str):
    try:
        return {"ticker": ticker.upper(), "price": get_current_price(ticker)}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


@router.get("/history/{ticker}")
def history(ticker: str, period: str = Query(default="1y", enum=PERIODS), start_date: str = Query(default=None)):
    hist = get_price_history(ticker.upper(), period=period, start_date=start_date)
    return {
        "ticker": ticker.upper(),
        "data": hist.reset_index().to_dict(orient="records"),
    }


@router.get("/dividends/{ticker}")
def dividends(ticker: str, start_date: str = Query(default=None)):
    df = get_dividend_history(ticker.upper(), start_date=start_date)
    if df.empty:
        return {"ticker": ticker.upper(), "dividends": []}
    records = df.reset_index().rename(columns={"Date": "date", "Dividend": "amount"})
    records["date"] = records["date"].dt.strftime("%Y-%m-%d")
    return {"ticker": ticker.upper(), "dividends": records.to_dict(orient="records")}


@router.get("/info/{ticker}")
def info(ticker: str):
    return get_stock_info(ticker.upper())


_ALLOWED_TYPES = {"EQUITY", "ETF", "CRYPTOCURRENCY", "MUTUALFUND", "INDEX"}


@router.get("/search")
def search(q: str = Query(default="", min_length=1, max_length=20)):
    """Prefix-match symbol search backed by Yahoo Finance. Returns up to 8 results."""
    try:
        quotes = yf.Search(
            q,
            max_results=8,
            news_count=0,
            lists_count=0,
            include_cb=False,
        ).quotes
        results = []
        for r in quotes:
            symbol = r.get("symbol", "")
            qtype  = r.get("quoteType", "")
            name   = r.get("shortname") or r.get("longname") or ""
            if symbol and qtype in _ALLOWED_TYPES:
                results.append({"symbol": symbol, "name": name, "type": qtype})
        return results[:8]
    except Exception:  # noqa: BLE001
        return []
