import numpy as np
import pandas as pd
from backend.models.optimizer import optimize_portfolio
from backend.models.risk import RiskQuestion, calculate_risk_score, risk_label


def make_prices(n_assets=3, n_days=252):
    np.random.seed(42)
    dates = pd.date_range("2023-01-01", periods=n_days)
    tickers = ["AAPL", "MSFT", "GOOGL"][:n_assets]
    data = {t: 100 * (1 + np.random.randn(n_days) * 0.015).cumprod() for t in tickers}
    return pd.DataFrame(data, index=dates)


def make_skewed_prices(n_days=504):
    """
    Four assets with *deterministic* drifts and controlled noise (4 assets so the
    30% cap applies directly and the optimizer can meaningfully differentiate):

      A — high return, moderate vol  (daily drift +0.08%, daily noise 1.0%)
      B — low  return, very low vol  (daily drift +0.01%, daily noise 0.2%)
      C — negative return, high vol  (daily drift -0.02%, daily noise 2.0%)
      D — medium return, medium vol  (daily drift +0.04%, daily noise 0.8%)

    Max-Sharpe at a 30% cap must give A and D more weight than C.
    Equal weight (25/25/25/25) is not the optimum.
    """
    np.random.seed(1)
    dates = pd.date_range("2021-01-01", periods=n_days)
    params = {
        "A": (0.0008, 0.010),
        "B": (0.0001, 0.002),
        "C": (-0.0002, 0.020),
        "D": (0.0004, 0.008),
    }
    data = {}
    for t, (drift, vol) in params.items():
        noise = vol * np.random.randn(n_days)
        data[t] = 100 * np.exp(np.cumsum(drift + noise))
    return pd.DataFrame(data, index=dates)


def test_optimize_returns_correct_keys():
    result = optimize_portfolio(make_prices(), risk_score=5)
    assert "weights" in result
    assert "expected_annual_return_pct" in result
    assert "annual_volatility_pct" in result
    assert "sharpe_ratio" in result


def test_weights_sum_to_one():
    result = optimize_portfolio(make_prices(), risk_score=5)
    assert abs(sum(result["weights"].values()) - 1.0) < 0.01


def test_weights_are_not_equal_weight():
    """Optimizer must produce unequal weights on assets with different risk/return."""
    prices = make_skewed_prices()
    result = optimize_portfolio(prices, risk_score=5)
    weights = list(result["weights"].values())
    n = len(weights)
    equal_w = 1.0 / n
    # At least one weight must deviate from 1/N by more than 5 percentage points
    max_deviation = max(abs(w - equal_w) for w in weights)
    assert max_deviation > 0.05, (
        f"Weights look like equal-weight (1/N={equal_w:.3f}): {result['weights']}. "
        "Optimizer is not differentiating between assets."
    )
    # Asset C (negative drift, highest vol) must be lower weight than A
    assert result["weights"].get("C", 0) < result["weights"].get("A", 0), (
        f"High-vol negative-return asset C should not outweigh high-return asset A. "
        f"Weights: {result['weights']}"
    )


def test_conservative_has_lower_volatility_than_aggressive():
    prices = make_prices()
    conservative = optimize_portfolio(prices, risk_score=2)
    aggressive = optimize_portfolio(prices, risk_score=9)
    assert conservative["annual_volatility_pct"] <= aggressive["annual_volatility_pct"]


def _make_risk_question(a_val=2, b_val=2, c_val=2, d_correct=True):
    from backend.models.risk import SectionA, SectionB, SectionC, SectionD
    return RiskQuestion(
        section_a=SectionA(a1=a_val, a2=a_val, a3=a_val, a4=a_val, a5=a_val, a6=a_val, a7=a_val, a8=a_val),
        section_b=SectionB(b1=b_val, b2=b_val, b3=b_val, b4=""),
        section_c=SectionC(c1=c_val, c2=c_val, c3=c_val, c4=c_val, c5=c_val, c6=c_val),
        section_d=SectionD(d11=d_correct, d12=d_correct, d13=d_correct, d14=d_correct, d15=d_correct),
    )


def test_risk_score_bounds():
    for val in [1, 2, 3, 4]:
        q = _make_risk_question(a_val=val, b_val=val, c_val=val)
        score, kl = calculate_risk_score(q)
        assert 8 <= score <= 68
        assert kl in ("none", "basic", "expert")


def test_risk_label():
    assert risk_label(26) == "Low (Defensive)"
    assert risk_label(42) == "Medium (Conservative)"
    assert risk_label(56) == "Medium-High (Balanced)"
    assert risk_label(68) == "High (Aggressive)"
