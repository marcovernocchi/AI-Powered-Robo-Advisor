# User Guide

## Getting Started

1. Open the app at `http://localhost:3000`
2. Click **Create Account**, enter your name, email and a password, and pick your **country** — this sets your default display currency (e.g. Italy → EUR, United States → USD). You can change both later in Settings.
3. You are now logged in and redirected to the Dashboard

## Step 1 — Risk Questionnaire

Navigate to **AI Advisor** and click **Start** (or **Retake** if you've done it before).

The questionnaire has 4 sections (MiFID II style):
- **Section A** — Financial situation (income, wealth, debt)
- **Section B** — Investment objectives and time horizon
- **Section C** — Risk tolerance (psychological)
- **Section D** — Financial knowledge test

Navigate between sections with the **Back / Next** buttons and submit at the end of Section D.
You'll get a risk score (8–68) and a profile label: **Low (Defensive)**, **Medium (Conservative)**, **Medium-High (Balanced)**, or **High (Aggressive)**.

After submitting, the AI Advisor page shows:
- A **radar chart** of your four section scores against the benchmark for your risk band
- A **deterministic breakdown** of your score per section, the financial-knowledge level, and whether the "prudence rule" capped your score (this happens if your Financial Situation and Risk Tolerance sections point to very different risk bands)
- An **AI-generated explanation** of what your profile means in plain language (generated once and saved — visible again on future visits)

## Step 2 — Your Net Worth (Dashboard)

The Dashboard shows your **aggregated net worth**: total value, performance chart, risk profile summary, and a table of all positions across every portfolio.

- Use the **period buttons** (1W / 1M / YTD / 1Y / 5Y / MAX) above the chart to change the timeframe. The chart includes reinvested dividends.
- Click the **eye icon** to hide/mask all monetary values (useful for screen-sharing).
- Click **⚙ (Net worth settings)** to see all your portfolios, toggle **"Include in net worth"** per portfolio, or delete a portfolio.
- Click **+ New account** to create an additional portfolio (e.g. "Retirement", "Crypto", a partner's account) — give it a name and it appears as a new tab.
- Use the tabs (**Aggregated** / per-portfolio) to switch which portfolio's data the page shows.

## Step 3 — Build and Manage Your Portfolio

Navigate to **Portfolio**.

### If you have no holdings yet
The AI Advisor page shows a **suggested starter portfolio**: a ready-made ETF allocation matched to your risk band (Defensive / Conservative / Balanced / Aggressive), with a pie chart and an AI-written explanation of the rationale. Use it as a template for what to add.

### Adding holdings manually
Click **Add transaction**, choose the target portfolio, then enter the ticker (e.g. `AAPL`, `VWCE.DE`, `BTC-USD`), number of shares, average buy price, currency, asset type, purchase date, fees and optional notes. Click **Add**.

> Tip: add at least 2 holdings to unlock portfolio optimization.

### Importing from a broker export
Click **Import file**, choose the target portfolio, then drag in a CSV or Excel export from your broker. The app automatically detects the relevant columns (ticker/ISIN, shares, price, date, fees) and the file's currency — with AI assistance and a rule-based fallback if the AI is unavailable. Review the preview table, deselect any rows you don't want, adjust the detected currency if needed, and click **Import N positions**.

### Editing and selling
Click **Edit ▾** on any holding to:
- **Edit** the holding's details
- **Buy** more (opens the Add Transaction form pre-filled with this asset)
- **Sell** part or all of the position (records the sale and reduces shares)

### Allocation and chart
The right-hand donut chart shows your allocation **by asset type** or **by individual asset** — hover a slice for its value and percentage of the total. The performance chart above it follows the same period selector as the Dashboard.

## Step 4 — Optimize Your Portfolio

In the Portfolio page, click **Optimize** (above the holdings table, or in the Optimization section once you have at least 2 holdings).

This runs a **Black-Litterman optimization** on your aggregated holdings — combining a market-cap-based prior with your risk profile (via the same objective selection as the classic mean-variance model: minimum volatility, maximum Sharpe, or maximum quadratic utility depending on your score). The result shows:
- Suggested **weights** per ticker (bar chart)
- **Expected annual return**, **volatility**, and **Sharpe ratio**

On the AI Advisor page, the **"Recommended vs Current"** radar chart compares your current portfolio against this optimized allocation across six dimensions: expected return, safety (low volatility), diversification, equity share, balance (concentration), and defensive share — each with a short explanation of what it measures.

## Step 5 — Get AI Advice

Navigate to **AI Advisor** and click **Generate** in the AI Advice card.
The AI analyses your current allocation against your risk profile and returns personalized investment advice (assessment, outlook, and concrete suggestions), plus a disclaimer.
Previous advice sessions are saved and can be reviewed by expanding the entries in the **Previous Advice** section.

## Step 6 — Backtest a Strategy

Navigate to **Backtesting**.

1. Define the portfolio to test: add tickers and target weights manually (must sum to 100%), or click **Load my portfolio** to pre-fill the weights from one of your existing portfolios (or the aggregated total).
2. Set the **initial capital**, **start/end dates**, and a **rebalancing frequency**:
   - `None` — buy and hold
   - `Monthly` / `Quarterly` / `Annual` — rebalance to target weights on a schedule
   - `Drift` — rebalance only when an asset's weight drifts from its target by more than the **drift threshold** (%)
3. Optionally set **transaction cost**, **annual TER**, and **spread** (all in basis points), and an optional **benchmark ticker** (e.g. `SPY`) for comparison.
4. Click **Run backtest**.

Results include a value-over-time chart (vs. benchmark if set), headline metrics (total return, CAGR, volatility, Sharpe, Sortino, max drawdown and its duration), a per-year returns table, rolling 12-month Sharpe/volatility charts, 95% VaR/CVaR, total transaction/TER costs, and a monthly returns heatmap.

## Step 7 — Export Your Portfolio

In the Portfolio page, click **Export ▾**, choose **which portfolio** (or "all portfolios" for the aggregated view) and a **format** (Excel or PDF), then click **Export**.

- **Excel** includes a holdings sheet (with P&L highlighting) and a summary sheet (composition by asset type, optimizer metrics if you've run Optimize, and 3-year historical performance metrics).
- **PDF** is a printable report with the holdings table, the same summary metrics, and an allocation donut chart.

## Step 8 — Explore the Market

Navigate to **Market**.
Start typing a ticker or company name (stocks, ETFs, crypto like `BTC-USD`) to get autocomplete suggestions, or press **Search** for an exact ticker.
The page shows key metrics (market cap, P/E, 52-week range, dividend yield, beta), a short description, and an interactive price chart.
Use the period buttons (1mo, 3mo, 6mo, 1y, 2y, 5y) to change the chart range.
From the Dashboard, clicking a ticker in your holdings table jumps straight to that asset's Market page.

## Settings

Navigate to **Settings** to change:
- **Country** — also updates your default display currency
- **Display currency** — all portfolio values are converted to this currency using live FX rates
- **Language** — English or Italian; applies to the entire UI immediately

## Dark / Light Mode

Click the theme toggle in the sidebar to switch between dark and light mode.
Your preference, language, and currency choices are all saved automatically and persist across sessions.
