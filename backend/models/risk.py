from pydantic import BaseModel, Field


class SectionA(BaseModel):
    a1: int = Field(..., ge=1, le=4)
    a2: int = Field(..., ge=1, le=4)
    a3: int = Field(..., ge=1, le=4)
    a4: int = Field(..., ge=1, le=4)
    a5: int = Field(..., ge=1, le=4)
    a6: int = Field(..., ge=1, le=4)
    a7: int = Field(..., ge=1, le=4)
    a8: int = Field(..., ge=1, le=4)


class SectionB(BaseModel):
    b1: int = Field(..., ge=1, le=4)
    b2: int = Field(..., ge=1, le=4)
    b3: int = Field(..., ge=1, le=4)
    b4: str = ""


class SectionC(BaseModel):
    c1: int = Field(..., ge=1, le=4)
    c2: int = Field(..., ge=1, le=4)
    c3: int = Field(..., ge=1, le=4)
    c4: int = Field(..., ge=1, le=4)
    c5: int = Field(..., ge=1, le=4)
    c6: int = Field(..., ge=1, le=4)


class SectionD(BaseModel):
    d11: bool
    d12: bool
    d13: bool
    d14: bool
    d15: bool


class RiskQuestion(BaseModel):
    section_a: SectionA
    section_b: SectionB
    section_c: SectionC
    section_d: SectionD


# Upper bound of each risk band (used by prudence rule)
_BAND_MAX = {1: 26, 2: 42, 3: 56, 4: 68}


def _section_band(score: int, max_score: int) -> int:
    """Maps a section score to band 1 (Low) – 4 (High), proportional to the 68-pt scale."""
    pct = score / max_score
    if pct <= 26 / 68:
        return 1
    elif pct <= 42 / 68:
        return 2
    elif pct <= 56 / 68:
        return 3
    return 4


def knowledge_level(d: SectionD) -> str:
    """Returns the knowledge level based on the number of correct answers in SectionD."""
    correct = sum([d.d11, d.d12, d.d13, d.d14, d.d15])
    if correct <= 2:
        return "none"
    elif correct <= 4:
        return "basic"
    return "expert"


def calculate_risk_score(q: RiskQuestion) -> tuple[int, str]:
    """Returns (total_score 8–68, knowledge_level).

    Prudence rule: if Section A and Section C implied bands diverge by more than
    one band, the total is capped at the upper bound of the more conservative band.
    """
    score_a = (q.section_a.a1 + q.section_a.a2 + q.section_a.a3 + q.section_a.a4
               + q.section_a.a5 + q.section_a.a6 + q.section_a.a7 + q.section_a.a8)
    score_b = q.section_b.b1 + q.section_b.b2 + q.section_b.b3
    score_c = (q.section_c.c1 + q.section_c.c2 + q.section_c.c3
               + q.section_c.c4 + q.section_c.c5 + q.section_c.c6)

    band_a = _section_band(score_a, 32)
    band_c = _section_band(score_c, 24)

    total = score_a + score_b + score_c

    if abs(band_a - band_c) > 1:
        conservative_band = min(band_a, band_c)
        total = min(total, _BAND_MAX[conservative_band])

    kl = knowledge_level(q.section_d)
    return total, kl


def risk_label(score: int) -> str:
    """Returns a risk label based on the given score, categorizing it as Low, Medium, Medium-High, or High."""
    if score <= 26:
        return "Low (Defensive)"
    elif score <= 42:
        return "Medium (Conservative)"
    elif score <= 56:
        return "Medium-High (Balanced)"
    return "High (Aggressive)"
