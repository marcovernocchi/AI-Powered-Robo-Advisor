# CLAUDE.md

## Project: AI Robo-Advisor Platform

Finance II university project. Economics master student + CS collaborator.

## Commands

```bash
# Backend
uvicorn backend.main:app --reload

# Frontend Streamlit (from project root)
PYTHONPATH=. streamlit run frontend/app.py

# Frontend React (first time only: install dependencies)
cd frontend-react && npm install

# Frontend React (avvio)
cd frontend-react && npm run dev

# Tests
PYTHONPATH=. pytest tests/ -v

# Install deps
pip install -r requirements.txt
```

## Key conventions
- Run all commands from the **project root**
- `PYTHONPATH=.` is required for frontend imports to resolve `backend.*` and `frontend.*`
- Tickers are uppercased in the API layer — don't uppercase them again in the frontend
- `.env` is gitignored; `.env.example` is the template
- The SQLite database file `robo_advisor.db` is created automatically on first run (gitignored)
- Each holding has its own `currency`; API responses convert amounts to the user's
  `display_currency` via `backend/services/currency.py` — don't assume USD
- Holdings belong to a `Portfolio`; aggregated endpoints only include portfolios with
  `include_in_aggregated == True`
- All frontend-react UI text goes through `t('namespace.key')` (`useLang()`) — add new
  strings to both `en` and `it` in `frontend-react/src/i18n/translations.js`

## Do not
- Commit `.env` or `robo_advisor.db`
- Push to main directly — use feature branches and PRs
- Add a column to `backend/db/models.py` without a matching `ALTER TABLE` in
  `backend/database.py:migrate_db()` (existing SQLite DBs aren't recreated)
