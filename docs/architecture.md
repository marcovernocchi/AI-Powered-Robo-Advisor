# Architecture

## Overview

```
Browser → Streamlit Frontend (port 8501)
                ↓ HTTP (requests)
        FastAPI Backend (port 8000)
          ↙           ↘          ↘
   SQLite DB      yfinance      Groq API
  (SQLAlchemy)   (market data)  (LLM advice)
```

## Backend layers

- **auth/** — JWT token issuance and validation, bcrypt password hashing
- **api/** — Thin route handlers; delegate business logic to services/models
- **models/** — Pure Python finance logic (optimizer, risk score); no DB calls
- **services/** — External API wrappers (yfinance, Groq); stateless functions
- **db/** — SQLAlchemy ORM models; migrations via `init_db()` on startup

## Portfolio optimization

Uses PyPortfolioOpt with three strategies selected by risk score:

| Risk score | Strategy |
|---|---|
| 1–3 (conservative) | Minimum volatility |
| 4–6 (moderate) | Maximum Sharpe ratio |
| 7–10 (aggressive) | Maximum quadratic utility (low risk aversion) |

Input: 1-year daily Close prices from yfinance.
Output: optimal weights, expected return, volatility, Sharpe ratio.

## LLM integration

Groq's `/chat/completions` endpoint with `llama-3.3-70b-versatile`.
The prompt includes the user's risk profile and current portfolio allocation.
Responses are stored in the `advice` table for history retrieval.

## Database schema

```
users (id, email, name, hashed_password, risk_score, created_at)
  └── portfolios (id, user_id, name, created_at)
        └── holdings (id, portfolio_id, ticker, shares, avg_buy_price)
  └── advice (id, user_id, content, created_at)
```
