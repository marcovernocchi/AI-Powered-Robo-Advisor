from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from backend.database import init_db, migrate_db, get_db
from backend.db.models import User
from backend.auth.router import router as auth_router, get_current_user
from backend.api.portfolio import router as portfolio_router
from backend.api.import_portfolio import router as import_router
from backend.api.market import router as market_router
from backend.api.advice import router as advice_router
from backend.api.backtesting import router as backtesting_router
from backend.api.monte_carlo import router as monte_carlo_router
from backend.models.risk import RiskQuestion, calculate_risk_score, risk_label

app = FastAPI(title="AI Robo-Advisor API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(portfolio_router)
app.include_router(import_router)
app.include_router(market_router)
app.include_router(advice_router)
app.include_router(backtesting_router)
app.include_router(monte_carlo_router)


@app.on_event("startup")
def startup():
    init_db()
    migrate_db()


@app.get("/")
def root():
    return {"status": "ok", "message": "AI Robo-Advisor API is running"}


@app.post("/risk-profile")
def set_risk_profile(
    answers: RiskQuestion,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    score, kl = calculate_risk_score(answers)
    current_user.risk_score = score
    db.commit()
    return {"risk_score": score, "risk_profile": risk_label(score), "knowledge_level": kl}
