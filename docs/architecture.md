# Architecture

## Overview

```
Browser → React Frontend (port 3000)
                ↓ HTTP (fetch, proxied by Vite)
        FastAPI Backend (port 8000)
          ↙           ↘          ↘
   SQLite DB      yfinance      Groq API
  (SQLAlchemy)   (market data)  (LLM advice)
```

The legacy Streamlit frontend (port 8501) communicates with the same backend via the `requests` library and is still functional locally, but is not used for deployment.

## Frontend (React)

Built with **React 18 + Vite + Tremor + Tailwind CSS**.

| File | Responsibility |
|---|---|
| `src/api/client.js` | All fetch calls to the backend; attaches JWT from localStorage |
| `src/context/AuthContext.jsx` | Global auth state; persists token to localStorage |
| `src/context/ThemeContext.jsx` | Dark/light toggle; persists to localStorage; sets `dark` class on `<html>` |
| `src/components/Layout.jsx` | Sidebar navigation, theme toggle, logout |
| `src/pages/` | One file per page: Login, Dashboard, Portfolio, AIAdvisor, Market |

The Vite dev server proxies all `/auth`, `/portfolio`, `/market`, `/advice`, and `/risk-profile` requests to `http://localhost:8000`, so no CORS configuration is needed during development.

## Backend layers

- **auth/** — JWT token issuance and validation, bcrypt password hashing
- **api/** — Thin route handlers; delegate business logic to services/models
- **models/** — Pure Python finance logic (optimizer, risk score); no DB calls
- **services/** — External API wrappers (yfinance, Groq); stateless functions
- **db/** — SQLAlchemy ORM models; auto-migration via `init_db()` on startup

## Portfolio optimization

Uses PyPortfolioOpt with three strategies selected by risk score (8–68):

| Risk score | Strategy |
|---|---|
| 8–26 (Low / Defensive) | Minimum volatility |
| 27–42 (Medium / Conservative) | Maximum Sharpe ratio |
| 43–56 (Medium-High / Balanced) | Maximum Sharpe ratio |
| 57–68 (High / Aggressive) | Maximum quadratic utility (low risk aversion) |

Input: 1-year daily Close prices from yfinance (minimum 60 trading days required).
Output: optimal weights, expected return, volatility, Sharpe ratio.

## Risk scoring (MiFID II style)

The questionnaire has 4 sections:

| Section | Topic | Questions | Scale |
|---|---|---|---|
| A | Financial Situation (Risk Capacity) | 8 | 1–4 each |
| B | Objectives and Time Horizon | 3 + 1 text | 1–4 each |
| C | Risk Tolerance (psychological) | 6 | 1–4 each |
| D | Knowledge and Experience | 5 true/false | — |

Total score range: **8–68**.
Prudence rule: if Section A and C bands diverge by more than one level, the total is capped at the upper bound of the more conservative band.

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
