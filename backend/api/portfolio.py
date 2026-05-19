import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from backend.database import get_db
from backend.db.models import User, Portfolio, Holding
from backend.auth.router import get_current_user
from backend.services.market_data import get_multiple_prices, get_price_history
from backend.models.optimizer import optimize_portfolio

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


class HoldingIn(BaseModel):
    ticker: str
    shares: float
    avg_buy_price: float


def _get_or_create_portfolio(user_id: int, db: Session) -> Portfolio:
    portfolio = db.query(Portfolio).filter(Portfolio.user_id == user_id).first()
    if not portfolio:
        portfolio = Portfolio(user_id=user_id)
        db.add(portfolio)
        db.commit()
        db.refresh(portfolio)
    return portfolio


@router.get("/")
def get_portfolio(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    portfolio = db.query(Portfolio).filter(Portfolio.user_id == current_user.id).first()
    if not portfolio or not portfolio.holdings:
        return {"holdings": [], "total_value": 0.0}

    prices = get_multiple_prices([h.ticker for h in portfolio.holdings])
    holdings_out = []
    total_value = 0.0

    for h in portfolio.holdings:
        current_price = prices.get(h.ticker) or h.avg_buy_price
        value = h.shares * current_price
        total_value += value
        pnl_pct = (current_price - h.avg_buy_price) / h.avg_buy_price * 100
        holdings_out.append({
            "id": h.id,
            "ticker": h.ticker,
            "shares": h.shares,
            "avg_buy_price": h.avg_buy_price,
            "current_price": round(current_price, 2),
            "value": round(value, 2),
            "pnl_pct": round(pnl_pct, 2),
        })

    return {"holdings": holdings_out, "total_value": round(total_value, 2)}


@router.post("/holdings", status_code=201)
def add_holding(
    data: HoldingIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    portfolio = _get_or_create_portfolio(current_user.id, db)
    holding = Holding(
        portfolio_id=portfolio.id,
        ticker=data.ticker.upper(),
        shares=data.shares,
        avg_buy_price=data.avg_buy_price,
    )
    db.add(holding)
    db.commit()
    return {"message": "Holding added"}


@router.delete("/holdings/{holding_id}")
def delete_holding(
    holding_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    portfolio = db.query(Portfolio).filter(Portfolio.user_id == current_user.id).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    holding = db.query(Holding).filter(
        Holding.id == holding_id, Holding.portfolio_id == portfolio.id
    ).first()
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")
    db.delete(holding)
    db.commit()
    return {"message": "Holding removed"}


@router.get("/optimize")
def optimize(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    portfolio = db.query(Portfolio).filter(Portfolio.user_id == current_user.id).first()
    if not portfolio or not portfolio.holdings:
        raise HTTPException(status_code=400, detail="No holdings to optimize")
    if len(portfolio.holdings) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 holdings to optimize")

    price_series = {}
    for h in portfolio.holdings:
        hist = get_price_history(h.ticker, period="1y")
        series = hist["Close"]
        series.index = series.index.normalize().tz_localize(None)
        price_series[h.ticker] = series

    prices_df = pd.DataFrame(price_series).dropna()
    if len(prices_df) < 60:
        raise HTTPException(status_code=400, detail="Not enough historical data (need 60+ trading days)")

    risk_score = current_user.risk_score or 5
    return optimize_portfolio(prices_df, risk_score)
