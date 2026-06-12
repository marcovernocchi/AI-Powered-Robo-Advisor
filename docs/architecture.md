# Architecture

## Overview

```
Browser → React Frontend (port 3000)
                ↓ HTTP (fetch, proxied by Vite)
        FastAPI Backend (port 8000)
          ↙           ↓              ↘
   SQLite DB      yfinance          Groq API
  (SQLAlchemy)  (prices, FX rates,  (LLM: advice, risk explanations,
                 dividends,          portfolio suggestions,
                 market caps)        import column/asset detection)
```

The legacy Streamlit frontend (port 8501) communicates with the same backend via the `requests` library and is still functional locally, but is not used for deployment.

## Frontend (React)

Built with **React 18 + Vite + Tremor + Tailwind CSS**.

| File | Responsibility |
|---|---|
| `src/api/client.js` | All fetch calls to the backend; attaches JWT from localStorage |
| `src/context/AuthContext.jsx` | Global auth state; persists token to localStorage |
| `src/context/ThemeContext.jsx` | Dark/light toggle; persists to localStorage; sets `dark` class on `<html>` |
| `src/context/LangContext.jsx` | i18n: current language + `t(key)` lookup against `src/i18n/translations.js`; persists to localStorage |
| `src/context/PortfolioContext.jsx` | Shared portfolio/chart state for Dashboard & Portfolio pages: fetches the aggregated portfolio and per-portfolio data, builds chart series (with dividend reinvestment) and caches them per ticker/period |
| `src/components/Layout.jsx` | Top nav (Net Worth, Portfolio, AI Advisor, Market, Backtesting), theme toggle, language/settings link, logout |
| `src/components/DropdownSelect.jsx`, `NumberInput.jsx` | Reusable styled select/number inputs used across Portfolio and Backtesting forms |
| `src/components/AddTransactionModal.jsx`, `EditHoldingModal.jsx`, `SellHoldingModal.jsx` | Add / edit / partially-sell a holding (ticker, shares, price, currency, date, fees, notes) |
| `src/components/ImportModal.jsx` | CSV/Excel import flow: upload → preview detected rows → confirm |
| `src/i18n/translations.js` | All UI strings, keyed by namespace (e.g. `nav.*`, `portfolio.*`, `backtesting.*`, `settings.*`) for `en` and `it` |
| `src/pages/` | Login, Dashboard, Portfolio, AIAdvisor, Market, Backtesting, Settings |

The Vite dev server proxies `/auth`, `/portfolio`, `/market`, `/advice`, `/risk-profile`, `/backtest` and `/monte-carlo` requests to `http://localhost:8000`, so no CORS configuration is needed during development.

## Backend layers

- **auth/** — JWT token issuance/validation, bcrypt password hashing, country → default-currency mapping (`COUNTRY_CURRENCY`)
- **api/** — Thin route handlers; delegate business logic to services/models
  - `portfolio.py` — multi-portfolio CRUD, holdings, aggregated/per-portfolio views, optimization, metrics, model-portfolio suggestions, Excel/PDF export
  - `import_portfolio.py` — CSV/Excel import preview & confirm
  - `market.py`, `advice.py`, `backtesting.py`, `monte_carlo.py`
- **models/** — Pure Python finance logic (optimizers, risk score); no DB calls
- **backtesting/** — Historical simulation engine, data loading, performance metrics, and a walk-forward strategy-comparison module; no DB calls
- **monte_carlo/** — Forward-looking simulation of portfolio value distributions; no DB calls
- **services/** — External API wrappers (yfinance market data, FX conversion, Groq); stateless functions
- **db/** — SQLAlchemy ORM models; tables created via `init_db()`, columns added to existing tables via `migrate_db()` on startup

## Multi-portfolio & multi-currency

- A user can own multiple `Portfolio` rows. Each has `include_in_aggregated` (default true).
- "Aggregated" views (`/portfolio/`, `/portfolio/metrics`, `/portfolio/optimize`, advice generation, exports without a portfolio id) combine holdings from every portfolio with `include_in_aggregated = true`. The Dashboard/Portfolio pages also let the user drill into a single portfolio.
- Each `Holding` stores the `currency` it was entered in (defaults to the user's `display_currency` at creation time, or the detected currency on import).
- `backend/services/currency.py` fetches FX rates via `yfinance` (`{FROM}{TO}=X`), caches them for 1 hour, and exposes `convert(amount, from_currency, to_currency)`. All API responses convert holding values into `user.display_currency`.
- `get_ticker_currency()` (also cached) determines a ticker's native trading currency so live prices can be converted before being combined with `avg_buy_price` (which is stored in the holding's own currency).

## Portfolio optimization

Three interchangeable optimizers share the same output shape (`weights`, `expected_annual_return_pct`, `annual_volatility_pct`, `sharpe_ratio`, optional `warnings`):

| Optimizer | Module | Used by |
|---|---|---|
| Mean-variance (MVO) | `models/optimizer.py` | `GET /portfolio/optimize/{id}` (single portfolio) |
| Black-Litterman | `models/bl_optimizer.py` | `GET /portfolio/optimize` (aggregated portfolio, default) — also persists the result to `optimization_results` |
| Hierarchical Risk Parity (HRP) | `models/hrp_optimizer.py` | Available for direct use / walk-forward comparison |

Common preprocessing (`optimizer.py`):
- Tickers with fewer than `MIN_HISTORY_DAYS` (60) non-NaN daily Close prices are excluded.
- After the first solve, "sliver" allocations below `MIN_WEIGHT` (5%) are dropped and the optimizer re-solves on the reduced ticker set.
- Per-asset weight is capped (`DEFAULT_MAX_WEIGHT` 0.30, auto-relaxed for very small portfolios so the sum-to-one constraint stays feasible).

Objective selection (`_run_ef`, shared by MVO and Black-Litterman), based on `risk_score`:

| `risk_score` | Objective |
|---|---|
| ≤ 3 | Minimum volatility |
| 4–6 | Maximum Sharpe ratio |
| > 6 | Maximum quadratic utility (`risk_aversion=0.5`) |

Falls back to minimum volatility if the primary objective is infeasible (e.g. all expected returns negative). `current_user.risk_score` (the 8–68 questionnaire score, see *Risk scoring*) is passed directly into this function.

**Black-Litterman specifics** (`bl_optimizer.py`):
- Market-implied risk aversion (`delta`) is estimated from the S&P 500 proxy (`^GSPC`) over 5y/2y/1y windows, clamped to `[1, 5]`, falling back to `2.5` (He & Litterman, 1999).
- The prior (`pi`) is built from each ticker's market cap (`get_market_caps`); tickers with no market cap get an equal-weight share of the prior.
- No explicit "views" are passed by the API today — `views`/`view_confidences` parameters exist for future use (e.g. LLM- or user-supplied views).

**Walk-forward comparison** (`backend/backtesting/comparison.py`): a research/validation module (covered by `tests/test_comparison.py`, not exposed via an API endpoint) that runs MVO max-Sharpe, MVO min-variance, Risk Parity, Equal-Weight, HRP and Black-Litterman (prior-only) out-of-sample with no look-ahead, for comparing strategies on historical data.

Input for all optimizers: daily Close prices from yfinance via `services/market_data.py`.

## Backtesting (`backend/backtesting/`, `POST /backtest`)

`BacktestEngine.run()` simulates a fixed-target-weight portfolio over a historical period:

- **Inputs** (`BacktestInput`): target `weights` (must sum to 1), `initial_capital`, date range, `rebalance_frequency` (`none` / `monthly` / `quarterly` / `annual` / `drift`), `drift_threshold`, `transaction_cost_bps`, `annual_ter_bps`, `spread_bps`, optional `benchmark_ticker`, `risk_free_rate`.
- **Simulation**: entry transaction cost + spread is deducted on day 1; a daily TER charge is deducted proportionally from holdings; rebalancing trades (and their transaction costs) are triggered per the chosen frequency or, for `drift`, whenever any asset's weight deviates from target by more than `drift_threshold`.
- **Outputs** (`BacktestResult`): full daily `portfolio_series` (and benchmark series if requested), `total_transaction_costs`, `total_ter_costs`, `rebalance_dates`, and `PerformanceMetrics` (and `benchmark_metrics` if a benchmark was given).
- **`PerformanceMetrics`** (`backtesting/metrics.py`): total return, CAGR, annualized volatility, Sharpe, Sortino, max drawdown (+ duration), per-year returns, rolling 12-month Sharpe/volatility (weekly-sampled), historical VaR/CVaR at 95%, and a monthly return grid for a heatmap.
- The Portfolio export (Excel/PDF) reuses this engine for a 3-year buy-and-hold "Historical Performance" section via `_compute_historical_metrics`.

## Monte Carlo simulation (`backend/monte_carlo/`, `POST /monte-carlo`)

`run_monte_carlo()` (`MonteCarloInput` → `MonteCarloResult`) projects portfolio value over a horizon:

- Estimates each asset's annualized return/volatility from `lookback_years` of history, shrinking the historical return towards a `long_run_return` prior by `shrinkage_lambda` (0 = pure historical, 1 = pure prior).
- Per-asset `asset_overrides` (manual expected return/volatility) take precedence over the automatic estimate; `return_sources` reports whether each asset's return came from `historical`, `shrinkage`, or `manual`.
- Supports recurring `monthly_contribution` and an optional `target_value` to compute `prob_target` (probability of reaching that value by the end of the horizon).
- Output includes `time_labels`, a `PercentileSeries` (p5/p25/p50/p75/p95) per time step, and `mean_final`/`median_final`.
- This endpoint is implemented and tested but not yet wired into a frontend page.

## Import & Export

- **Import** (`backend/api/import_portfolio.py`, `POST /portfolio/import/preview` then `/import/confirm`): accepts CSV or Excel broker exports. Columns are matched via `ai_detect_columns` (Groq) with a regex/alias fallback (`COLUMN_ALIASES`); numbers are parsed in both EU (`1.800,50`) and US (`1,800.50`) formats; a ticker is resolved from a `ticker` column or, failing that, an `isin` via `yfinance.Search`. If no `asset_type` column is found, `ai_classify_asset_types` (Groq) classifies each ticker into `equity` / `etf_equity` / `etf_bond` / `bond` / `crypto` / `commodity` / `cash`, falling back to `equity`. The preview also reports a `detected_currency` from any `€/$/£/¥` symbols found.
- **Export** (`GET /portfolio/export/{excel,pdf}` and the per-portfolio variants): builds export rows via `_build_export_rows` (current value, P&L, weight %, and — if the user has run `/portfolio/optimize` — the optimized target weight per ticker from `optimization_results`).
  - **Excel**: a "Holdings" sheet (formatted table with conditional P&L colouring) and a "Summary" sheet (overview, composition by type, forward-looking optimizer metrics, and the 3-year historical backtest metrics).
  - **PDF**: a landscape report — page 1 is the holdings table, page 2 has a summary (overview, optimizer metrics, historical backtest metrics) alongside a matplotlib donut chart of allocation by asset type.

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

`POST /risk-profile` stores the total score plus `risk_section_scores`, `risk_bands`, `risk_prudence_applied` and `risk_knowledge_level` on the user. `POST /risk-profile/explain` then asks the LLM for a plain-language explanation of those exact numbers (the model is instructed not to invent figures), stored as `risk_explanation`.

## Model portfolio suggestions (`GET /portfolio/suggestions`)

Maps the user's risk score to a band (`defensive` / `conservative` / `balanced` / `aggressive`, thresholds at 26/42/56) and returns a fixed ETF allocation (`MODEL_PORTFOLIOS`) for that band, each asset tagged with an `asset_class` (e.g. `equity_global`, `bond_govt_short`, `gold`). An LLM call (`generate_portfolio_suggestion_explanation`) produces a short rationale; if it fails, a static `FALLBACK_EXPLANATIONS` text per band is used instead. Intended to give first-time users (no holdings yet) a concrete starting allocation.

## LLM integration

Groq's `/chat/completions` endpoint with `llama-3.3-70b-versatile` (and `llama-3.1-8b-instant` for the PR-summary CI agent), used for:

- **AI advice** (`POST /advice/generate`) — prompt includes the user's risk profile and current aggregated allocation; response is stored as JSON in the `advice` table for history retrieval.
- **Risk-profile explanation** (`POST /risk-profile/explain`) — explains the questionnaire result; stored in `users.risk_explanation`.
- **Portfolio suggestion explanation** (`GET /portfolio/suggestions`) — explains the model portfolio for the user's risk band.
- **Import column/asset-type detection** (`backend/api/import_portfolio.py`) — maps spreadsheet columns to known fields and classifies tickers into asset types; both have non-AI fallbacks.

The Groq client is created lazily from `GROQ_API_KEY` in `.env`.

## Internationalization (i18n)

`frontend-react/src/context/LangContext.jsx` provides `t(key, params)`, looking up dot-separated keys (e.g. `t('portfolio.weight')`) in `frontend-react/src/i18n/translations.js`, which holds parallel `en` and `it` dictionaries. The selected language persists to `localStorage` and is changeable from the Settings page. Values may be functions (for interpolation/pluralization) and receive `params`.

## Database schema

```
users (id, email, name, hashed_password,
       country, display_currency,
       risk_score, risk_section_scores, risk_bands,
       risk_prudence_applied, risk_knowledge_level, risk_explanation,
       created_at)
  └── portfolios (id, user_id, name, include_in_aggregated, created_at)
        └── holdings (id, portfolio_id, ticker, asset_name, asset_type,
                       shares, avg_buy_price, currency,
                       purchase_date, fees, notes)
  └── advice (id, user_id, content, created_at)
  └── optimization_results (id, user_id, weights,
                             expected_annual_return_pct, annual_volatility_pct,
                             sharpe_ratio, created_at)

price_cache (ticker, price, updated_at)   -- standalone cache table, not user-scoped
```

New columns on existing tables are added on startup by `backend/database.py:migrate_db()` (SQLite `ALTER TABLE`), so existing local databases upgrade in place.
