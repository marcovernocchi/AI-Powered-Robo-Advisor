# AGENTS.md — AI Agent Guide

This project is organized as an **agentic project** where AI agents (primarily Claude Code via the Anthropic API) contribute meaningfully to development. This file tells any AI agent how to navigate and work in this codebase.

## Automated Agents

| Agent | Trigger | Script | What it does |
|---|---|---|---|
| Add Docstrings | Manual (`workflow_dispatch`) | `scripts/add_docstrings.py` | Scans `backend/api/` and `backend/models/` for public functions without docstrings, generates them via Groq, opens a PR |
| PR Summary | PR opened / reopened / marked ready for review (skips drafts) | `scripts/summarize_pr.py` | Reads the PR diff (filtering out lock/generated files), generates a markdown summary via Groq with rate-limit handling, posts it as a comment on the PR |
| Ruff Auto-fix | PR opened / synchronize / reopened | — (inline bash) | Runs `ruff check --fix` on `backend/` and `tests/`, commits fixes to the PR branch, comments with the list of fixed files |


## Project Overview

An AI-powered robo-advisor platform that provides personalized investment advice using machine learning and an LLM. Users register, complete a risk questionnaire, build a portfolio, and receive AI-generated advice.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | FastAPI (Python) |
| Database | SQLite (dev) / PostgreSQL (prod) via SQLAlchemy, lightweight migrations in `database.py:migrate_db()` |
| ML / Finance | PyPortfolioOpt (mean-variance, Black-Litterman, HRP), yfinance, pandas, numpy, scikit-learn |
| Backtesting / Monte Carlo | Custom engines in `backend/backtesting/` and `backend/monte_carlo/` |
| Reports | openpyxl (Excel export), fpdf2 + matplotlib (PDF export with charts) |
| LLM | Groq API (Llama 3.3-70B) — free tier |
| Frontend (primary) | React 18 + Vite + Tremor + Tailwind CSS, i18n (English/Italian) |
| Frontend (legacy) | Streamlit + Plotly |
| Deployment | DigitalOcean (VPS) + Docker |

## Repository Structure

```
backend/
  main.py            # FastAPI app, startup, risk-profile + risk-profile/explain endpoints
  config.py          # Settings from .env via pydantic-settings
  database.py        # SQLAlchemy engine, session, init_db(), migrate_db()
  auth/              # JWT auth: router, schemas (incl. COUNTRY_CURRENCY map), utils
  api/               # Route handlers
    portfolio.py         # Multi-portfolio CRUD, holdings, optimize, metrics, suggestions, export (Excel/PDF)
    import_portfolio.py  # CSV/Excel import: column detection (AI + alias fallback), asset classification
    market.py            # Price history, dividends, info, search/autocomplete
    advice.py            # AI advice generate/history
    backtesting.py       # POST /backtest
    monte_carlo.py       # POST /monte-carlo
  models/            # ML logic: optimizer.py (mean-variance), bl_optimizer.py (Black-Litterman),
                      # hrp_optimizer.py (HRP), risk.py (MiFID II risk scoring)
  backtesting/       # data_loader, engine (BacktestEngine), metrics, comparison (walk-forward
                      # strategy comparison — research module, not exposed via API), schemas
  monte_carlo/       # simulator (run_monte_carlo), schemas
  services/          # External calls: market_data.py (yfinance), currency.py (FX conversion),
                      # llm_advisor.py (Groq)
  db/models.py       # SQLAlchemy ORM models (User, Portfolio, Holding, Advice, PriceCache,
                      # OptimizationResult)

frontend-react/    # Primary frontend (React)
  src/
    api/client.js  # fetch wrappers for all backend endpoints
    context/       # AuthContext (JWT), ThemeContext (dark/light), LangContext (i18n),
                    # PortfolioContext (shared portfolio/chart state + caching)
    components/    # Layout, DropdownSelect, NumberInput, AddTransactionModal,
                    # EditHoldingModal, SellHoldingModal, ImportModal
    i18n/           # translations.js — all UI strings (en/it)
    pages/         # Login, Dashboard, Portfolio, AIAdvisor, Market, Backtesting, Settings
  vite.config.js   # Dev server proxies /auth /portfolio /market /advice /risk-profile
                    # /backtest /monte-carlo to :8000

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
- Add a column to a `backend/db/models.py` table without also adding the corresponding
  `ALTER TABLE` in `backend/database.py:migrate_db()` (existing SQLite databases are not
  recreated — `init_db()` only creates tables that don't exist yet)
- Push directly to `main` — open a pull request instead
- Delete the `.env.example` file

### Adding a new feature (agent workflow)
1. Create a feature branch: `git checkout -b feature/your-feature`
2. Implement the backend endpoint in `backend/api/` if needed
3. Add the corresponding page or component in `frontend-react/src/`
4. Add a test in `tests/`
5. Open a pull request with a clear description

### Key conventions
- Tickers are always uppercased at input (enforced in API layer — do not uppercase again in the frontend)
- Risk scores are integers 8–68; use `risk_label()` from `backend/models/risk.py` for display
- **Currency**: each holding stores its own `currency` (the currency it was entered in). API
  responses convert values to `user.display_currency` via `backend/services/currency.py`
  (`convert()` / `get_fx_rate()`, FX rates cached for 1h). Do not assume USD anywhere.
- **Multi-portfolio**: holdings belong to a `Portfolio`; aggregated endpoints
  (`/portfolio/`, `/portfolio/metrics`, `/portfolio/optimize`, exports without an id) only
  include portfolios where `include_in_aggregated == True`.
- **Asset types**: `holdings.asset_type` is one of `equity`, `etf_equity`, `etf_bond`, `bond`,
  `crypto`, `commodity`, `cash`. Keep `ASSET_TYPE_MAP` in `backend/api/import_portfolio.py`
  in sync if you add a new category.
- **i18n**: every user-facing string in `frontend-react/` goes through `t('namespace.key')`
  (from `useLang()`). Add new keys to **both** `en` and `it` in
  `frontend-react/src/i18n/translations.js`.
- The Groq client is lazily initialized; set `GROQ_API_KEY` in `.env`. It is used for AI
  advice, risk-profile explanations, portfolio-suggestion explanations, and import column/
  asset-type detection (with non-AI fallbacks for the latter).
- Database tables are created on startup via `init_db()`; new columns on existing tables
  need an `ALTER TABLE` in `migrate_db()` (see "What agents must NOT do").
- The React dev server proxies API calls to `http://localhost:8000` — no CORS issues in dev
