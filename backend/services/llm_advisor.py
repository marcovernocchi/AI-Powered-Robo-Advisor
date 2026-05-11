from groq import Groq
from backend.config import settings

_client = None


def _get_client() -> Groq:
    global _client
    if _client is None:
        _client = Groq(api_key=settings.groq_api_key)
    return _client


def _risk_label(score: int) -> str:
    if score <= 3:
        return "conservative"
    elif score <= 6:
        return "moderate"
    return "aggressive"


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
- Risk tolerance: {profile} (score {risk_score}/10)
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
