from fastapi import FastAPI, Depends, HTTPException
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
from pydantic import BaseModel as _BaseModel
from backend.models.risk import RiskQuestion, calculate_risk_score, risk_label
from backend.services.llm_advisor import generate_risk_explanation, LLMServiceError

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
    result = calculate_risk_score(answers)
    score = result["total"]
    current_user.risk_score = score
    current_user.risk_section_scores = result["section_scores"]
    current_user.risk_bands = result["bands"]
    current_user.risk_prudence_applied = result["prudence_applied"]
    current_user.risk_knowledge_level = result["knowledge_level"]
    db.commit()
    return {
        "risk_score": score,
        "risk_profile": risk_label(score),
        "knowledge_level": result["knowledge_level"],
        "section_scores": result["section_scores"],
        "bands": result["bands"],
        "prudence_applied": result["prudence_applied"],
    }


class _RiskExplainRequest(_BaseModel):
    risk_score: int
    section_scores: dict
    bands: dict
    prudence_applied: bool
    knowledge_level: str


@app.post("/risk-profile/explain")
def explain_risk_profile(
    data: _RiskExplainRequest,
    current_user: User = Depends(get_current_user),
):
    """Calls the LLM to generate a plain-language explanation of the user's MiFID II profile.
    Only real scoring data is passed; the model is instructed not to invent numbers."""
    try:
        explanation = generate_risk_explanation(
            risk_score=data.risk_score,
            section_scores=data.section_scores,
            bands=data.bands,
            prudence_applied=data.prudence_applied,
            knowledge_level=data.knowledge_level,
        )
    except LLMServiceError as exc:
        raise HTTPException(status_code=503, detail=exc.code) from exc
    return {"explanation": explanation}
