import json
import re

from groq import Groq
from backend.config import settings

_client = None


def _get_client() -> Groq:
    global _client
    if _client is None:
        _client = Groq(api_key=settings.groq_api_key)
    return _client


def _risk_label(score: int) -> str:
    if score <= 26:
        return "defensive (low risk)"
    elif score <= 42:
        return "conservative (medium risk)"
    elif score <= 56:
        return "balanced (medium-high risk)"
    return "aggressive (high risk)"


def generate_advice(portfolio_data: dict, risk_score: int) -> str:
    profile = _risk_label(risk_score)
    portfolio_str = (
        "\n".join(
            f"  - {ticker}: {data['shares']} shares, ${data['value']:.2f} ({data['allocation_pct']}% of portfolio)"
            for ticker, data in portfolio_data.items()
        )
        if portfolio_data
        else "  No holdings yet."
    )

    prompt = f"""You are a professional financial advisor providing personalized investment advice.

User profile:
- Risk tolerance: {profile} (score {risk_score}/68)
- Current portfolio:
{portfolio_str}

Write 3 short paragraphs:
1. Assessment: how well does this portfolio match the user's risk profile?
2. Suggestions: concrete rebalancing or diversification actions
3. Outlook: key market considerations for a {profile} investor right now

Keep language clear and jargon-free. End with a one-sentence disclaimer that this is AI-generated educational content, not professional financial advice."""

    response = _get_client().chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=500,
        temperature=0.6,
    )
    return response.choices[0].message.content


# ---------------------------------------------------------------------------
# MiFID II risk profile plain-language explanation
# ---------------------------------------------------------------------------

def generate_risk_explanation(
    risk_score: int,
    section_scores: dict,
    bands: dict,
    prudence_applied: bool,
    knowledge_level: str,
) -> str:
    """Generate a personalised plain-language explanation of the user's MiFID II risk profile.

    Only real scoring data from the algorithm is passed.
    The model is explicitly instructed not to invent numbers or percentages.
    """
    profile = _risk_label(risk_score)

    if prudence_applied:
        prudence_note = (
            f"The prudence rule WAS applied: Financial Situation (band {bands['A']}) "
            f"and Risk Attitude (band {bands['C']}) diverged by more than one band, "
            f"so the total score was capped to band {min(bands['A'], bands['C'])}."
        )
    else:
        prudence_note = (
            f"The prudence rule was NOT triggered: Financial Situation (band {bands['A']}) "
            f"and Risk Attitude (band {bands['C']}) are within one band of each other."
        )

    prompt = f"""You are a financial educator explaining a MiFID II suitability assessment to a retail investor.
Be plain, concrete, and honest. Do NOT invent any numbers, percentages, or return figures beyond what is given below.

Assessment results (do not alter these numbers):
- Total risk score: {risk_score}/68  →  Profile: {profile}
- Section A – Financial Situation (max 32): {section_scores['A']} points
- Section B – Investment Experience (max 12): {section_scores['B']} points
- Section C – Risk Attitude (max 24): {section_scores['C']} points
- Section D – Financial Knowledge (max 5 correct): {section_scores['D']} correct  →  {knowledge_level} level
- {prudence_note}

Write exactly 2 paragraphs (4–5 sentences each):
1. What this profile means in practical terms: what investment types fit, what level of price swings to expect, and a typical time horizon for this profile.
2. What the investor should pay attention to given their specific sub-scores — highlight any notable mismatch or gap (e.g. if knowledge is low relative to risk attitude, or if financial situation limits room for risky assets).

Plain English only. No bullet points. No invented numbers. End the second paragraph with one sentence reminding the reader this is educational content, not personalised financial advice."""

    response = _get_client().chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=420,
        temperature=0.5,
    )
    return response.choices[0].message.content


# ---------------------------------------------------------------------------
# Black-Litterman views from LLM
# ---------------------------------------------------------------------------

def _extract_json_block(raw: str) -> str:
    """
    Best-effort extraction of a JSON object from raw LLM text.
    Handles markdown code fences (```json ... ```) and plain embedded braces.
    """
    fence = re.search(r'```(?:json)?\s*(.*?)\s*```', raw, re.DOTALL)
    if fence:
        return fence.group(1).strip()
    start, end = raw.find('{'), raw.rfind('}')
    if start != -1 and end > start:
        return raw[start:end + 1]
    return raw.strip()


def generate_bl_views(portfolio_tickers: list[str], risk_score: int) -> dict:
    """
    Ask the LLM for Black-Litterman absolute views on the given portfolio tickers.

    Returns:
        {
            "views":            {ticker: float},   # expected annual return per asset
            "view_confidences": {ticker: float},   # Idzorek confidence in [0, 1]
            "warnings":         [str],
        }

    Never raises — malformed or partial responses degrade gracefully to empty views.
    Validation rules applied to each ticker before acceptance:
      - ticker must be in portfolio_tickers
      - expected return must be a number in [-1, 1]  (clamped if outside)
      - confidence must be a number in [0, 1]        (clamped if outside)
    """
    warnings: list[str] = []
    _empty = {"views": {}, "view_confidences": {}, "warnings": warnings}

    profile = _risk_label(risk_score)
    tickers_str = ", ".join(portfolio_tickers) if portfolio_tickers else "(none)"

    prompt = f"""You are a quantitative portfolio analyst. The investor has a {profile} profile (risk score {risk_score}/10).

Portfolio tickers: {tickers_str}

Provide your market views as a single JSON object with this exact structure:
{{"views": {{"TICKER": expected_annual_return}}, "confidences": {{"TICKER": confidence_level}}}}

Rules:
- Include only tickers from the list above that you have a strong directional view on
- expected_annual_return: decimal in [-1.0, 1.0]  (e.g. 0.12 = +12%, -0.05 = -5%)
- confidence_level: decimal in [0.0, 1.0]  (0 = no confidence, 1 = maximum confidence)
- Respond with ONLY the JSON object — no explanation, no markdown

Example: {{"views": {{"AAPL": 0.15}}, "confidences": {{"AAPL": 0.70}}}}"""

    try:
        response = _get_client().chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
            temperature=0.3,
        )
        raw = response.choices[0].message.content.strip()
    except Exception as exc:
        warnings.append(f"LLM call failed ({exc}); returning empty views")
        return _empty

    candidate = _extract_json_block(raw)
    try:
        parsed = json.loads(candidate)
    except (json.JSONDecodeError, ValueError) as exc:
        warnings.append(
            f"LLM returned malformed JSON ({exc}); returning empty views. "
            f"Raw response: {raw[:200]!r}"
        )
        return _empty

    if not isinstance(parsed, dict):
        warnings.append("LLM response is not a JSON object; returning empty views")
        return _empty

    raw_views = parsed.get("views")
    raw_confs = parsed.get("confidences", {})

    if not isinstance(raw_views, dict):
        warnings.append(
            "LLM JSON missing or invalid 'views' key; returning empty views"
        )
        return _empty

    if not isinstance(raw_confs, dict):
        raw_confs = {}

    valid_tickers = set(portfolio_tickers)
    views: dict[str, float] = {}
    view_confidences: dict[str, float] = {}

    for ticker, val in raw_views.items():
        # --- ticker validation ---
        if ticker not in valid_tickers:
            warnings.append(
                f"LLM view for '{ticker}' discarded — ticker not in portfolio"
            )
            continue

        # --- return validation ---
        try:
            ret = float(val)
        except (TypeError, ValueError):
            warnings.append(
                f"LLM view for '{ticker}' ({val!r}) is not a number; discarded"
            )
            continue

        if not (-1.0 <= ret <= 1.0):
            warnings.append(
                f"LLM view for '{ticker}' ({ret:.4f}) outside [-1, 1]; clamped"
            )
            ret = max(-1.0, min(1.0, ret))
        views[ticker] = ret

        # --- confidence validation ---
        conf_val = raw_confs.get(ticker)
        if conf_val is None:
            view_confidences[ticker] = 0.5          # neutral default
            continue
        try:
            conf = float(conf_val)
        except (TypeError, ValueError):
            warnings.append(
                f"LLM confidence for '{ticker}' ({conf_val!r}) is not a number; "
                "defaulting to 0.5"
            )
            view_confidences[ticker] = 0.5
            continue
        if not (0.0 <= conf <= 1.0):
            warnings.append(
                f"LLM confidence for '{ticker}' ({conf:.4f}) outside [0, 1]; clamped"
            )
            conf = max(0.0, min(1.0, conf))
        view_confidences[ticker] = conf

    return {"views": views, "view_confidences": view_confidences, "warnings": warnings}
