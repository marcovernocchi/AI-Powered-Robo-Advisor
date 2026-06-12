import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base, get_db
from backend.main import app


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


# A balanced-ish set of answers for the MiFID II questionnaire
_RISK_ANSWERS = {
    "section_a": {"a1": 3, "a2": 3, "a3": 3, "a4": 3, "a5": 3, "a6": 3, "a7": 3, "a8": 3},
    "section_b": {"b1": 3, "b2": 3, "b3": 3, "b4": ""},
    "section_c": {"c1": 3, "c2": 3, "c3": 3, "c4": 3, "c5": 3, "c6": 3},
    "section_d": {"d11": True, "d12": True, "d13": True, "d14": False, "d15": False},
}


# ---------------------------------------------------------------------------
# 1. After POST /risk-profile, GET /auth/me returns matching sub-scores
# ---------------------------------------------------------------------------

def test_me_reflects_risk_subscores_after_questionnaire(client):
    test_client, _ = client
    headers = _register(test_client, "withrisk@example.com")

    risk_res = test_client.post("/risk-profile", json=_RISK_ANSWERS, headers=headers)
    assert risk_res.status_code == 200, risk_res.text
    risk_body = risk_res.json()

    me_res = test_client.get("/auth/me", headers=headers)
    assert me_res.status_code == 200, me_res.text
    me_body = me_res.json()

    assert me_body["risk_score"] == risk_body["risk_score"]
    assert me_body["risk_section_scores"] == risk_body["section_scores"]
    assert me_body["risk_bands"] == risk_body["bands"]
    assert me_body["risk_prudence_applied"] == risk_body["prudence_applied"]
    assert me_body["risk_knowledge_level"] == risk_body["knowledge_level"]


# ---------------------------------------------------------------------------
# 2. A user who never completed the questionnaire has these fields as None
# ---------------------------------------------------------------------------

def test_me_has_null_risk_subscores_before_questionnaire(client):
    test_client, _ = client
    headers = _register(test_client, "norisk@example.com")

    me_res = test_client.get("/auth/me", headers=headers)
    assert me_res.status_code == 200, me_res.text
    me_body = me_res.json()

    assert me_body["risk_score"] is None
    assert me_body["risk_section_scores"] is None
    assert me_body["risk_bands"] is None
    # risk_prudence_applied has a model-level default of False for new users
    assert me_body["risk_prudence_applied"] is False
    assert me_body["risk_knowledge_level"] is None
