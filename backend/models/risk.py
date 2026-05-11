from pydantic import BaseModel, Field


class RiskQuestion(BaseModel):
    age: int = Field(..., ge=18, le=100)
    investment_horizon: int = Field(..., ge=1, le=50, description="Years you plan to stay invested")
    income_stability: int = Field(..., ge=1, le=5, description="1=very unstable, 5=very stable")
    loss_tolerance: int = Field(..., ge=1, le=5, description="1=sell everything, 5=buy more on dips")
    investment_experience: int = Field(..., ge=1, le=5, description="1=beginner, 5=expert")


def calculate_risk_score(q: RiskQuestion) -> int:
    """Returns integer 1–10: 1–3 conservative, 4–6 moderate, 7–10 aggressive."""
    age_score = max(1.0, 10.0 - (q.age - 20) / 5.0)
    horizon_score = min(10.0, q.investment_horizon / 3.0)

    raw = (
        age_score * 0.20
        + horizon_score * 0.30
        + q.income_stability * 2.0 * 0.15
        + q.loss_tolerance * 2.0 * 0.25
        + q.investment_experience * 2.0 * 0.10
    )
    return max(1, min(10, round(raw)))


def risk_label(score: int) -> str:
    if score <= 3:
        return "Conservative"
    elif score <= 6:
        return "Moderate"
    return "Aggressive"
