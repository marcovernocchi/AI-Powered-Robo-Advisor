"""
Tests for generate_bl_views.

All LLM calls (Groq) are mocked — no real network calls.
"""

from unittest.mock import MagicMock, patch

from backend.services.llm_advisor import generate_bl_views


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _mock_response(content: str) -> MagicMock:
    """Build a MagicMock that mimics a Groq completion response."""
    msg = MagicMock()
    msg.content = content
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    return resp


TICKERS = ["AAPL", "MSFT", "GOOGL"]

_VALID_JSON = (
    '{"views": {"AAPL": 0.15, "MSFT": 0.10}, '
    '"confidences": {"AAPL": 0.8, "MSFT": 0.6}}'
)

# ---------------------------------------------------------------------------
# (a) Valid JSON response
# ---------------------------------------------------------------------------

@patch("backend.services.llm_advisor._get_client")
def test_valid_json_response(mock_get_client):
    mock_get_client.return_value.chat.completions.create.return_value = (
        _mock_response(_VALID_JSON)
    )
    result = generate_bl_views(TICKERS, risk_score=5)

    assert result["views"] == {"AAPL": 0.15, "MSFT": 0.10}
    assert result["view_confidences"] == {"AAPL": 0.8, "MSFT": 0.6}
    assert result["warnings"] == []


@patch("backend.services.llm_advisor._get_client")
def test_json_wrapped_in_markdown_is_parsed(mock_get_client):
    """LLMs often wrap JSON in ```json ... ``` — must handle it silently."""
    markdown = '```json\n{"views": {"GOOGL": 0.08}, "confidences": {"GOOGL": 0.65}}\n```'
    mock_get_client.return_value.chat.completions.create.return_value = (
        _mock_response(markdown)
    )
    result = generate_bl_views(TICKERS, risk_score=5)

    assert result["views"] == {"GOOGL": 0.08}
    assert result["view_confidences"]["GOOGL"] == 0.65
    assert result["warnings"] == []


@patch("backend.services.llm_advisor._get_client")
def test_missing_confidences_key_defaults_to_half(mock_get_client):
    """If 'confidences' key is absent, every accepted view gets confidence=0.5."""
    mock_get_client.return_value.chat.completions.create.return_value = (
        _mock_response('{"views": {"AAPL": 0.12}}')
    )
    result = generate_bl_views(TICKERS, risk_score=5)

    assert result["views"] == {"AAPL": 0.12}
    assert result["view_confidences"]["AAPL"] == 0.5


# ---------------------------------------------------------------------------
# (b) Malformed JSON — must not raise, must return empty views + warning
# ---------------------------------------------------------------------------

@patch("backend.services.llm_advisor._get_client")
def test_malformed_json_returns_empty_views_with_warning(mock_get_client):
    mock_get_client.return_value.chat.completions.create.return_value = (
        _mock_response("Sorry, I cannot provide investment advice in this format.")
    )
    result = generate_bl_views(TICKERS, risk_score=5)

    assert result["views"] == {}
    assert result["view_confidences"] == {}
    assert len(result["warnings"]) > 0
    assert any(
        "malformed" in w.lower() or "json" in w.lower()
        for w in result["warnings"]
    ), f"Expected JSON-related warning; got: {result['warnings']}"


@patch("backend.services.llm_advisor._get_client")
def test_non_object_json_returns_empty_views(mock_get_client):
    """Top-level JSON array, not an object → empty views + warning."""
    mock_get_client.return_value.chat.completions.create.return_value = (
        _mock_response('[{"AAPL": 0.15}]')
    )
    result = generate_bl_views(TICKERS, risk_score=5)

    assert result["views"] == {}
    assert len(result["warnings"]) > 0


@patch("backend.services.llm_advisor._get_client")
def test_null_views_field_returns_empty(mock_get_client):
    mock_get_client.return_value.chat.completions.create.return_value = (
        _mock_response('{"views": null, "confidences": {}}')
    )
    result = generate_bl_views(TICKERS, risk_score=5)

    assert result["views"] == {}
    assert len(result["warnings"]) > 0


# ---------------------------------------------------------------------------
# (c) Ticker validation — unknown tickers discarded
# ---------------------------------------------------------------------------

@patch("backend.services.llm_advisor._get_client")
def test_unknown_ticker_is_discarded_with_warning(mock_get_client):
    payload = (
        '{"views": {"NVDA": 0.20, "AAPL": 0.12}, '
        '"confidences": {"NVDA": 0.9, "AAPL": 0.7}}'
    )
    mock_get_client.return_value.chat.completions.create.return_value = (
        _mock_response(payload)
    )
    result = generate_bl_views(TICKERS, risk_score=5)

    assert "NVDA" not in result["views"], "NVDA is not in portfolio — should be discarded"
    assert "AAPL" in result["views"]
    assert any("NVDA" in w for w in result["warnings"])


@patch("backend.services.llm_advisor._get_client")
def test_all_tickers_unknown_returns_empty_views(mock_get_client):
    payload = '{"views": {"TSLA": 0.30, "AMZN": 0.20}, "confidences": {"TSLA": 0.8, "AMZN": 0.5}}'
    mock_get_client.return_value.chat.completions.create.return_value = (
        _mock_response(payload)
    )
    result = generate_bl_views(TICKERS, risk_score=5)

    assert result["views"] == {}
    assert result["view_confidences"] == {}
    assert len(result["warnings"]) >= 2   # one warning per discarded ticker


# ---------------------------------------------------------------------------
# (d) Value validation — out-of-range values clamped
# ---------------------------------------------------------------------------

@patch("backend.services.llm_advisor._get_client")
def test_return_above_one_is_clamped_to_one(mock_get_client):
    payload = '{"views": {"AAPL": 2.5}, "confidences": {"AAPL": 0.5}}'
    mock_get_client.return_value.chat.completions.create.return_value = (
        _mock_response(payload)
    )
    result = generate_bl_views(TICKERS, risk_score=5)

    assert result["views"]["AAPL"] == 1.0
    assert any("clamped" in w.lower() for w in result["warnings"])


@patch("backend.services.llm_advisor._get_client")
def test_return_below_minus_one_is_clamped(mock_get_client):
    payload = '{"views": {"MSFT": -3.0}, "confidences": {"MSFT": 0.4}}'
    mock_get_client.return_value.chat.completions.create.return_value = (
        _mock_response(payload)
    )
    result = generate_bl_views(TICKERS, risk_score=5)

    assert result["views"]["MSFT"] == -1.0
    assert any("clamped" in w.lower() for w in result["warnings"])


@patch("backend.services.llm_advisor._get_client")
def test_confidence_above_one_is_clamped_to_one(mock_get_client):
    payload = '{"views": {"AAPL": 0.10}, "confidences": {"AAPL": 1.5}}'
    mock_get_client.return_value.chat.completions.create.return_value = (
        _mock_response(payload)
    )
    result = generate_bl_views(TICKERS, risk_score=5)

    assert result["view_confidences"]["AAPL"] == 1.0
    assert any("confidence" in w.lower() for w in result["warnings"])


@patch("backend.services.llm_advisor._get_client")
def test_confidence_below_zero_is_clamped_to_zero(mock_get_client):
    payload = '{"views": {"GOOGL": 0.05}, "confidences": {"GOOGL": -0.2}}'
    mock_get_client.return_value.chat.completions.create.return_value = (
        _mock_response(payload)
    )
    result = generate_bl_views(TICKERS, risk_score=5)

    assert result["view_confidences"]["GOOGL"] == 0.0
    assert any("confidence" in w.lower() for w in result["warnings"])


@patch("backend.services.llm_advisor._get_client")
def test_non_numeric_return_is_discarded(mock_get_client):
    payload = '{"views": {"AAPL": "fifteen percent"}, "confidences": {"AAPL": 0.7}}'
    mock_get_client.return_value.chat.completions.create.return_value = (
        _mock_response(payload)
    )
    result = generate_bl_views(TICKERS, risk_score=5)

    assert "AAPL" not in result["views"]
    assert any("not a number" in w.lower() or "discarded" in w.lower() for w in result["warnings"])


# ---------------------------------------------------------------------------
# (e) LLM API failure — must not raise
# ---------------------------------------------------------------------------

@patch("backend.services.llm_advisor._get_client")
def test_llm_api_exception_returns_empty_views(mock_get_client):
    mock_get_client.return_value.chat.completions.create.side_effect = Exception("API timeout")
    result = generate_bl_views(TICKERS, risk_score=5)

    assert result["views"] == {}
    assert result["view_confidences"] == {}
    assert len(result["warnings"]) > 0
    assert any("failed" in w.lower() for w in result["warnings"])


# ---------------------------------------------------------------------------
# (f) Return type — views and confidences must be native float
# ---------------------------------------------------------------------------

@patch("backend.services.llm_advisor._get_client")
def test_views_values_are_native_float(mock_get_client):
    mock_get_client.return_value.chat.completions.create.return_value = (
        _mock_response(_VALID_JSON)
    )
    result = generate_bl_views(TICKERS, risk_score=5)

    for v in result["views"].values():
        assert type(v) is float, f"view value {v!r} is {type(v).__name__}, expected float"
    for v in result["view_confidences"].values():
        assert type(v) is float, f"confidence {v!r} is {type(v).__name__}, expected float"
