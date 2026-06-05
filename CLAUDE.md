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

## Do not
- Commit `.env` or `robo_advisor.db`
- Push to main directly — use feature branches and PRs
