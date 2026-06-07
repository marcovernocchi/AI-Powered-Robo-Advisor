import pandas as pd
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from backend.database import get_db
from backend.db.models import User, Portfolio, Holding
from backend.auth.router import get_current_user
from backend.services.market_data import get_multiple_prices, get_price_history
from backend.services.currency import get_ticker_currency, convert
from backend.models.optimizer import optimize_portfolio

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


class HoldingIn(BaseModel):
    ticker: str
    asset_name: Optional[str] = None
    asset_type: str = 'security'
    shares: float
    avg_buy_price: float
    purchase_date: Optional[str] = None   # ISO date string YYYY-MM-DD
    fees: Optional[float] = 0.0
    notes: Optional[str] = None
    portfolio_id: Optional[int] = None


class HoldingUpdate(BaseModel):
    shares: Optional[float] = None
    avg_buy_price: Optional[float] = None
    purchase_date: Optional[str] = None
    fees: Optional[float] = None
    notes: Optional[str] = None


class PortfolioCreate(BaseModel):
    name: str


class PortfolioUpdate(BaseModel):
    name: Optional[str] = None
    include_in_aggregated: Optional[bool] = None


def _build_holdings_out(holdings, display_currency: str) -> tuple[list, float]:
    if not holdings:
        return [], 0.0
    prices = get_multiple_prices([h.ticker for h in holdings])
    holdings_out = []
    total_value = 0.0
    for h in holdings:
        price_data = prices.get(h.ticker, {"price": None, "stale": False})
        current_price = price_data["price"] or h.avg_buy_price
        price_stale = price_data["stale"]
        native_currency = get_ticker_currency(h.ticker)
        value_native = h.shares * current_price
        value = convert(value_native, native_currency, display_currency)
        total_value += value
        pnl_pct = (current_price - h.avg_buy_price) / h.avg_buy_price * 100
        holdings_out.append({
            "id": h.id,
            "portfolio_id": h.portfolio_id,
            "ticker": h.ticker,
            "shares": h.shares,
            "avg_buy_price": h.avg_buy_price,
            "current_price": round(current_price, 2),
            "price_stale": price_stale,
            "native_currency": native_currency,
            "value": round(value, 2),
            "pnl_pct": round(pnl_pct, 2),
            "purchase_date": h.purchase_date.isoformat() if h.purchase_date else None,
        })
    return holdings_out, round(total_value, 2)


# Must come before /{portfolio_id} routes
@router.get("/list")
def list_portfolios(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    portfolios = db.query(Portfolio).filter(Portfolio.user_id == current_user.id).all()
    display_currency = current_user.display_currency or 'USD'
    result = []
    for p in portfolios:
        _, total = _build_holdings_out(p.holdings, display_currency)
        result.append({
            "id": p.id,
            "name": p.name,
            "holdings_count": len(p.holdings),
            "total_value": total,
            "include_in_aggregated": p.include_in_aggregated,
        })
    return result


@router.get("/")
def get_portfolio_aggregated(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    portfolios = db.query(Portfolio).filter(
        Portfolio.user_id == current_user.id,
        Portfolio.include_in_aggregated == True,  # noqa: E712
    ).all()
    display_currency = current_user.display_currency or 'USD'
    all_holdings = [h for p in portfolios for h in p.holdings]
    holdings_out, total_value = _build_holdings_out(all_holdings, display_currency)
    return {"holdings": holdings_out, "total_value": total_value, "display_currency": display_currency}


@router.post("/create", status_code=201)
def create_portfolio(
    data: PortfolioCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    portfolio = Portfolio(user_id=current_user.id, name=data.name)
    db.add(portfolio)
    db.commit()
    db.refresh(portfolio)
    return {"id": portfolio.id, "name": portfolio.name}


@router.post("/holdings", status_code=201)
def add_holding(
    data: HoldingIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if data.portfolio_id:
        portfolio = db.query(Portfolio).filter(
            Portfolio.id == data.portfolio_id,
            Portfolio.user_id == current_user.id,
        ).first()
        if not portfolio:
            raise HTTPException(status_code=404, detail="Portfolio not found")
    else:
        portfolio = db.query(Portfolio).filter(Portfolio.user_id == current_user.id).first()
        if not portfolio:
            portfolio = Portfolio(user_id=current_user.id, name="My Portfolio")
            db.add(portfolio)
            db.commit()
            db.refresh(portfolio)
    from datetime import date as date_type
    purchase_date = None
    if data.purchase_date:
        try:
            purchase_date = date_type.fromisoformat(data.purchase_date)
        except ValueError:
            pass
    holding = Holding(
        portfolio_id=portfolio.id,
        ticker=data.ticker.upper(),
        asset_name=data.asset_name,
        asset_type=data.asset_type,
        shares=data.shares,
        avg_buy_price=data.avg_buy_price,
        purchase_date=purchase_date,
        fees=data.fees or 0.0,
        notes=data.notes,
    )
    db.add(holding)
    db.commit()
    return {"message": "Holding added"}


@router.patch("/holdings/{holding_id}")
def update_holding(
    holding_id: int,
    data: HoldingUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_portfolio_ids = [
        p.id for p in db.query(Portfolio).filter(Portfolio.user_id == current_user.id).all()
    ]
    holding = db.query(Holding).filter(
        Holding.id == holding_id,
        Holding.portfolio_id.in_(user_portfolio_ids),
    ).first()
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")
    if data.shares is not None:
        holding.shares = data.shares
    if data.avg_buy_price is not None:
        holding.avg_buy_price = data.avg_buy_price
    if data.purchase_date is not None:
        from datetime import date as date_type
        try:
            holding.purchase_date = date_type.fromisoformat(data.purchase_date)
        except ValueError:
            pass
    if data.fees is not None:
        holding.fees = data.fees
    if data.notes is not None:
        holding.notes = data.notes
    db.commit()
    return {"message": "Holding updated"}


@router.delete("/holdings/{holding_id}")
def delete_holding(
    holding_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_portfolio_ids = [
        p.id for p in db.query(Portfolio).filter(Portfolio.user_id == current_user.id).all()
    ]
    holding = db.query(Holding).filter(
        Holding.id == holding_id,
        Holding.portfolio_id.in_(user_portfolio_ids),
    ).first()
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")
    db.delete(holding)
    db.commit()
    return {"message": "Holding removed"}


@router.get("/{portfolio_id}")
def get_portfolio_by_id(
    portfolio_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    portfolio = db.query(Portfolio).filter(
        Portfolio.id == portfolio_id,
        Portfolio.user_id == current_user.id,
    ).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    display_currency = current_user.display_currency or 'USD'
    holdings_out, total_value = _build_holdings_out(portfolio.holdings, display_currency)
    return {
        "id": portfolio.id,
        "name": portfolio.name,
        "holdings": holdings_out,
        "total_value": total_value,
        "display_currency": display_currency,
    }


@router.patch("/{portfolio_id}")
def update_portfolio(
    portfolio_id: int,
    data: PortfolioUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    portfolio = db.query(Portfolio).filter(
        Portfolio.id == portfolio_id,
        Portfolio.user_id == current_user.id,
    ).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    if data.name is not None:
        portfolio.name = data.name
    if data.include_in_aggregated is not None:
        portfolio.include_in_aggregated = data.include_in_aggregated
    db.commit()
    db.refresh(portfolio)
    return {"id": portfolio.id, "name": portfolio.name, "include_in_aggregated": portfolio.include_in_aggregated}


@router.delete("/{portfolio_id}")
def delete_portfolio(
    portfolio_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    portfolio = db.query(Portfolio).filter(
        Portfolio.id == portfolio_id,
        Portfolio.user_id == current_user.id,
    ).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    db.delete(portfolio)
    db.commit()
    return {"message": "Portfolio deleted"}


@router.get("/optimize/{portfolio_id}")
def optimize(
    portfolio_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    portfolio = db.query(Portfolio).filter(
        Portfolio.id == portfolio_id,
        Portfolio.user_id == current_user.id,
    ).first()
    if not portfolio or not portfolio.holdings:
        raise HTTPException(status_code=400, detail="No holdings to optimize")
    if len(portfolio.holdings) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 holdings to optimize")

    unique_tickers = list(dict.fromkeys(h.ticker for h in portfolio.holdings))
    price_series = {}
    fetch_errors = []
    for ticker in unique_tickers:
        try:
            hist = get_price_history(ticker, period="1y")
            if hist.empty or len(hist) < 10:
                fetch_errors.append(ticker)
                continue
            series = hist["Close"]
            series.index = series.index.normalize().tz_localize(None)
            price_series[ticker] = series
        except Exception as exc:  # noqa: BLE001
            fetch_errors.append(ticker)
            print(f"[optimize] failed to fetch history for {ticker}: {exc}")

    if len(price_series) < 2:
        detail = "Could not fetch enough price history to optimise."
        if fetch_errors:
            detail += f" Failed tickers: {', '.join(fetch_errors)}."
        raise HTTPException(status_code=400, detail=detail)

    prices_df = pd.DataFrame(price_series)

    risk_score = current_user.risk_score or 5
    result = optimize_portfolio(prices_df, risk_score)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result
