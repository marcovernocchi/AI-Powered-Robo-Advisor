import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.db.models import User, Portfolio, Advice
from backend.auth.router import get_current_user
from backend.services.market_data import get_multiple_prices
from backend.services.llm_advisor import generate_advice

router = APIRouter(prefix="/advice", tags=["advice"])


@router.post("/generate")
def get_advice(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Returns investment advice based on the user's portfolio and risk score, generating and storing the advice in the database."""
    if not current_user.risk_score:
        raise HTTPException(status_code=400, detail="Complete the risk questionnaire first")

    portfolios = db.query(Portfolio).filter(
        Portfolio.user_id == current_user.id,
        Portfolio.include_in_aggregated == True,  # noqa: E712
    ).all()
    all_holdings = [h for p in portfolios for h in p.holdings]
    portfolio_summary = {}

    if all_holdings:
        prices = get_multiple_prices([h.ticker for h in all_holdings])
        total = sum(
            h.shares * ((prices.get(h.ticker) or {}).get("price") or h.avg_buy_price)
            for h in all_holdings
        )
        for h in all_holdings:
            price = (prices.get(h.ticker) or {}).get("price") or h.avg_buy_price
            value = h.shares * price
            portfolio_summary[h.ticker] = {
                "shares": h.shares,
                "value": round(value, 2),
                "allocation_pct": round(value / total * 100, 1) if total > 0 else 0,
            }

    content = generate_advice(portfolio_summary, current_user.risk_score)
    content_str = json.dumps(content)   # serialise dict → TEXT for DB storage

    db.add(Advice(user_id=current_user.id, content=content_str))
    db.commit()

    return {"advice": content}


@router.get("/history")
def advice_history(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Retrieves the 5 most recent advice history items for the current user."""
    items = (
        db.query(Advice)
        .filter(Advice.user_id == current_user.id)
        .order_by(Advice.created_at.desc())
        .limit(5)
        .all()
    )
    result = []
    for a in items:
        try:
            parsed_content = json.loads(a.content)
        except (json.JSONDecodeError, ValueError):
            # Legacy plain-text advice stored before structured output was introduced
            parsed_content = {"is_structured": False, "raw_text": a.content}
        result.append({"id": a.id, "content": parsed_content, "created_at": a.created_at.isoformat()})
    return result
