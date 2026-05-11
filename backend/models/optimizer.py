import pandas as pd
from pypfopt import EfficientFrontier, risk_models, expected_returns


def optimize_portfolio(prices: pd.DataFrame, risk_score: int) -> dict:
    """
    prices  — DataFrame with tickers as columns and daily Close prices as rows
    risk_score — 1–10 from risk questionnaire
    Returns suggested weights and expected performance metrics.
    """
    mu = expected_returns.mean_historical_return(prices)
    S = risk_models.sample_cov(prices)
    ef = EfficientFrontier(mu, S)

    if risk_score <= 3:
        ef.min_volatility()
    elif risk_score <= 6:
        ef.max_sharpe()
    else:
        ef.max_quadratic_utility(risk_aversion=0.5)

    weights = ef.clean_weights()
    ret, vol, sharpe = ef.portfolio_performance(verbose=False)

    return {
        "weights": {k: round(v, 4) for k, v in weights.items()},
        "expected_annual_return_pct": round(ret * 100, 2),
        "annual_volatility_pct": round(vol * 100, 2),
        "sharpe_ratio": round(sharpe, 3),
    }
