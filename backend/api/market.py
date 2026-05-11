from fastapi import APIRouter, Query
from backend.services.market_data import get_price_history, get_stock_info, get_current_price

router = APIRouter(prefix="/market", tags=["market"])

PERIODS = ["1mo", "3mo", "6mo", "1y", "2y", "5y"]


@router.get("/price/{ticker}")
def price(ticker: str):
    try:
        return {"ticker": ticker.upper(), "price": get_current_price(ticker)}
    except Exception as e:
        return {"error": str(e)}


@router.get("/history/{ticker}")
def history(ticker: str, period: str = Query(default="1y", enum=PERIODS)):
    hist = get_price_history(ticker.upper(), period=period)
    return {
        "ticker": ticker.upper(),
        "data": hist.reset_index().to_dict(orient="records"),
    }


@router.get("/info/{ticker}")
def info(ticker: str):
    return get_stock_info(ticker.upper())
