# AGENTS.md — AI Agent Guide

This project is organized as an **agentic project** where AI agents (primarily Claude Code via the Anthropic API) contribute meaningfully to development. This file tells any AI agent how to navigate and work in this codebase.

## Project Overview

An AI-powered robo-advisor platform that provides personalized investment advice using machine learning and an LLM. Users register, complete a risk questionnaire, build a portfolio, and receive AI-generated advice.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | FastAPI (Python) |
| Database | SQLite (dev) / PostgreSQL (prod) via SQLAlchemy |
| ML / Finance | PyPortfolioOpt, yfinance, scikit-learn |
| LLM | Groq API (Llama 3.3-70B) — free tier |
| Frontend (primary) | React 18 + Vite + Tremor + Tailwind CSS |
| Frontend (legacy) | Streamlit + Plotly |
| Deployment | Azure (VPS) + Docker |

## Repository Structure

```
backend/
  main.py          # FastAPI app, startup, risk-profile endpoint
  config.py        # Settings from .env via pydantic-settings
  database.py      # SQLAlchemy engine, session, init_db()
  auth/            # JWT auth: router, schemas, utils
  api/             # Route handlers: portfolio, market, advice
  models/          # ML logic: optimizer (PyPortfolioOpt), risk scoring
  services/        # External calls: yfinance, Groq LLM
  db/models.py     # SQLAlchemy ORM models (User, Portfolio, Holding, Advice)

frontend-react/    # Primary frontend (React)
  src/
    api/client.js  # fetch wrappers for all backend endpoints
    context/       # AuthContext (JWT), ThemeContext (dark/light)
    components/    # Layout (sidebar + outlet)
    pages/         # Login, Dashboard, Portfolio, AIAdvisor, Market
  vite.config.js   # Dev server proxies /auth /portfolio /market /advice to :8000

frontend/          # Legacy frontend (Streamlit)
  app.py           # Login / register page (Streamlit entry point)
  pages/           # Multipage Streamlit app
  utils/
    api_client.py  # HTTP calls to the backend
    charts.py      # Plotly figure factories

tests/             # pytest unit tests
docs/              # Architecture, API, user guide
```

## How to Run

```bash
# 1. Install Python dependencies
pip install -r requirements.txt

# 2. Copy and fill in environment variables
cp .env.example .env

# 3. Start backend (from project root)
uvicorn backend.main:app --reload

# 4. Start React frontend (separate terminal)
cd frontend-react
npm install   # first time only
npm run dev   # available at http://localhost:3000
```

## Agent Instructions

### What agents CAN do autonomously
- Add new API endpoints in `backend/api/`
- Improve the portfolio optimizer in `backend/models/optimizer.py`
- Add or modify React pages in `frontend-react/src/pages/`
- Add new Plotly charts in `frontend/utils/charts.py` (legacy)
- Write and run tests in `tests/`
- Fix bugs and refactor existing code
- Update documentation in `docs/`

### What agents must NOT do
- Commit secrets or API keys
- Modify `backend/db/models.py` without running `init_db()` to migrate
- Push directly to `main` — open a pull request instead
- Delete the `.env.example` file

### Adding a new feature (agent workflow)
1. Create a feature branch: `git checkout -b feature/your-feature`
2. Implement the backend endpoint in `backend/api/` if needed
3. Add the corresponding page or component in `frontend-react/src/`
4. Add a test in `tests/`
5. Open a pull request with a clear description

### Key conventions
- All monetary values are in USD
- Tickers are always uppercased at input (enforced in API layer — do not uppercase again in the frontend)
- Risk scores are integers 8–68; use `risk_label()` from `backend/models/risk.py` for display
- The Groq client is lazily initialized; set `GROQ_API_KEY` in `.env`
- Database is auto-created on startup via `init_db()`
- The React dev server proxies API calls to `http://localhost:8000` — no CORS issues in dev
