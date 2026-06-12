from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base, get_db
from backend.db.models import User
from backend.main import app
from backend.api.portfolio import MODEL_PORTFOLIOS, FALLBACK_EXPLANATIONS


@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app), TestingSessionLocal
    finally:
        app.dependency_overrides.clear()


def _register(test_client, email):
    res = test_client.post("/auth/register", json={
        "email": email,
        "name": "Test User",
        "password": "testpass123",
        "country": "US",
    })
    assert res.status_code == 200, res.text
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _set_risk_score(session_factory, email, score):
    db = session_factory()
    try:
        user = db.query(User).filter(User.email == email).first()
        user.risk_score = score
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# 1. The four model portfolios sum to 1.0 (within tolerance)
# ---------------------------------------------------------------------------

def test_model_portfolios_sum_to_one():
    assert set(MODEL_PORTFOLIOS.keys()) == {"defensive", "conservative", "balanced", "aggressive"}
    for band, allocation in MODEL_PORTFOLIOS.items():
        total = sum(weight for _, weight in allocation)
        assert total == pytest.approx(1.0, abs=1e-9), f"{band} portfolio sums to {total}, not 1.0"


# ---------------------------------------------------------------------------
# 2. 400 if the user has not completed the risk questionnaire
# ---------------------------------------------------------------------------

def test_suggestions_requires_risk_score(client):
    test_client, _ = client
    headers = _register(test_client, "norisk@example.com")

    res = test_client.get("/portfolio/suggestions", headers=headers)

    assert res.status_code == 400
    assert res.json()["detail"] == "Complete the risk questionnaire first"


# ---------------------------------------------------------------------------
# 3. Correct risk_band returned for each risk score band
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("score, expected_band", [
    (20, "defensive"),
    (35, "conservative"),
    (50, "balanced"),
    (65, "aggressive"),
])
def test_suggestions_returns_correct_risk_band(client, score, expected_band):
    test_client, session_factory = client
    email = f"user{score}@example.com"
    headers = _register(test_client, email)
    _set_risk_score(session_factory, email, score)

    with patch(
        "backend.api.portfolio.generate_portfolio_suggestion_explanation",
        return_value="MOCK EXPLANATION",
    ):
        res = test_client.get("/portfolio/suggestions", headers=headers)

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["risk_band"] == expected_band
    assert body["risk_score"] == score
    assert body["explanation"] == "MOCK EXPLANATION"

    # Allocation matches the fixed model portfolio for this band
    allocation = body["allocation"]
    assert sum(item["weight"] for item in allocation) == pytest.approx(1.0, abs=1e-9)

    cash_entries = [item for item in allocation if item["asset_class"] == "cash"]
    assert len(cash_entries) == 1
    assert cash_entries[0]["ticker"] is None
    assert cash_entries[0]["asset_name"] == "Cash / Liquidity"

    for item in allocation:
        if item["asset_class"] != "cash":
            assert item["ticker"] is not None
            assert item["asset_name"]


# ---------------------------------------------------------------------------
# 4. Falls back to static text when the LLM call fails
# ---------------------------------------------------------------------------

def test_suggestions_falls_back_when_llm_fails(client):
    test_client, session_factory = client
    email = "llmfail@example.com"
    headers = _register(test_client, email)
    _set_risk_score(session_factory, email, 50)  # balanced

    with patch(
        "backend.api.portfolio.generate_portfolio_suggestion_explanation",
        side_effect=Exception("LLM unavailable"),
    ):
        res = test_client.get("/portfolio/suggestions", headers=headers)

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["risk_band"] == "balanced"
    assert body["explanation"] == FALLBACK_EXPLANATIONS["balanced"]
