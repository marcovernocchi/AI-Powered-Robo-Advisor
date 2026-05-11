import pytest
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


def test_optimize_returns_correct_keys():
    result = optimize_portfolio(make_prices(), risk_score=5)
    assert "weights" in result
    assert "expected_annual_return_pct" in result
    assert "annual_volatility_pct" in result
    assert "sharpe_ratio" in result


def test_weights_sum_to_one():
    result = optimize_portfolio(make_prices(), risk_score=5)
    assert abs(sum(result["weights"].values()) - 1.0) < 0.01


def test_conservative_has_lower_volatility_than_aggressive():
    prices = make_prices()
    conservative = optimize_portfolio(prices, risk_score=2)
    aggressive = optimize_portfolio(prices, risk_score=9)
    assert conservative["annual_volatility_pct"] <= aggressive["annual_volatility_pct"]


def test_risk_score_bounds():
    for age in [20, 40, 65]:
        for horizon in [2, 15, 30]:
            q = RiskQuestion(age=age, investment_horizon=horizon, income_stability=3, loss_tolerance=3, investment_experience=3)
            score = calculate_risk_score(q)
            assert 1 <= score <= 10


def test_risk_label():
    assert risk_label(1) == "Conservative"
    assert risk_label(5) == "Moderate"
    assert risk_label(9) == "Aggressive"
