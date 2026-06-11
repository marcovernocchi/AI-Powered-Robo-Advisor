"""
Tests for generate_advice structured output, fallback, and weight verification.
These tests stub the Groq client so no real API call is made.
"""
import json
from unittest.mock import MagicMock, patch

import pytest

from backend.services.llm_advisor import generate_advice


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PORTFOLIO = {
    "AAPL": {"shares": 10, "value": 1800.00, "allocation_pct": 60.0},
    "MSFT": {"shares": 5,  "value": 1200.00, "allocation_pct": 40.0},
}
RISK_SCORE = 50  # balanced profile


def _make_llm_response(content: str):
    """Wrap a string in the minimal Groq response shape."""
    msg = MagicMock()
    msg.content = content
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    return resp


# ---------------------------------------------------------------------------
# 1. Valid JSON → structured output
# ---------------------------------------------------------------------------

def test_structured_output_valid_json():
    payload = {
        "assessment": "Portfolio aligns with balanced profile.",
        "suggestions": ["Add bonds", "Reduce AAPL", "Add ETF"],
        "outlook": "Moderate growth expected.",
        "disclaimer": "This is educational content.",
        "referenced_weights": [
            {"ticker": "AAPL", "weight_pct": 60.0},
            {"ticker": "MSFT", "weight_pct": 40.0},
        ],
    }
    with patch("backend.services.llm_advisor._get_client") as mock_client:
        mock_client.return_value.chat.completions.create.return_value = (
            _make_llm_response(json.dumps(payload))
        )
        result = generate_advice(PORTFOLIO, RISK_SCORE)

    assert result["is_structured"] is True
    assert result["assessment"] == "Portfolio aligns with balanced profile."
    assert len(result["suggestions"]) == 3
    assert result["outlook"] == "Moderate growth expected."
    assert result["disclaimer"] == "This is educational content."
    assert result["weights_verified"] is True
    assert result["weights_note"] is None


# ---------------------------------------------------------------------------
# 2. Malformed JSON → fallback to raw text
# ---------------------------------------------------------------------------

def test_fallback_on_malformed_json():
    raw_text = "Here is my advice: buy low, sell high."
    with patch("backend.services.llm_advisor._get_client") as mock_client:
        mock_client.return_value.chat.completions.create.return_value = (
            _make_llm_response(raw_text)
        )
        result = generate_advice(PORTFOLIO, RISK_SCORE)

    assert result["is_structured"] is False
    assert result["raw_text"] == raw_text


# ---------------------------------------------------------------------------
# 3a. Weight mismatch → weights_verified = False
# ---------------------------------------------------------------------------

def test_weight_mismatch_sets_verified_false():
    payload = {
        "assessment": "Good.",
        "suggestions": ["s1", "s2", "s3"],
        "outlook": "Neutral.",
        "disclaimer": "Educational only.",
        # AAPL declared as 20% but actual is 60% — delta = 40pp > 5pp tolerance
        "referenced_weights": [{"ticker": "AAPL", "weight_pct": 20.0}],
    }
    with patch("backend.services.llm_advisor._get_client") as mock_client:
        mock_client.return_value.chat.completions.create.return_value = (
            _make_llm_response(json.dumps(payload))
        )
        result = generate_advice(PORTFOLIO, RISK_SCORE)

    assert result["is_structured"] is True
    assert result["weights_verified"] is False
    assert result["weights_note"] == "[Note: AI figures may differ from your actual data]"


# ---------------------------------------------------------------------------
# 3b. Weights within tolerance → weights_verified = True
# ---------------------------------------------------------------------------

def test_weight_within_tolerance_verified_true():
    payload = {
        "assessment": "Good.",
        "suggestions": ["s1", "s2", "s3"],
        "outlook": "Neutral.",
        "disclaimer": "Educational only.",
        # AAPL declared as 62% — delta 2pp from actual 60% → within 5pp tolerance
        "referenced_weights": [{"ticker": "AAPL", "weight_pct": 62.0}],
    }
    with patch("backend.services.llm_advisor._get_client") as mock_client:
        mock_client.return_value.chat.completions.create.return_value = (
            _make_llm_response(json.dumps(payload))
        )
        result = generate_advice(PORTFOLIO, RISK_SCORE)

    assert result["is_structured"] is True
    assert result["weights_verified"] is True


# ---------------------------------------------------------------------------
# 4. referenced_weights absent → weights_verified = None (check skipped)
# ---------------------------------------------------------------------------

def test_missing_referenced_weights_skips_check():
    payload = {
        "assessment": "Good.",
        "suggestions": ["s1", "s2", "s3"],
        "outlook": "Neutral.",
        "disclaimer": "Educational only.",
        # no referenced_weights key at all
    }
    with patch("backend.services.llm_advisor._get_client") as mock_client:
        mock_client.return_value.chat.completions.create.return_value = (
            _make_llm_response(json.dumps(payload))
        )
        result = generate_advice(PORTFOLIO, RISK_SCORE)

    assert result["is_structured"] is True
    assert result["weights_verified"] is None
    assert result["weights_note"] is None
