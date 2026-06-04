# User Guide

## Getting Started

1. Open the app at `http://localhost:3000`
2. Click **Create Account**, enter your name, email and a password
3. You are now logged in and redirected to the Dashboard

## Step 1 — Risk Questionnaire

Navigate to **AI Advisor** in the sidebar.

The questionnaire has 4 sections (MiFID II style):
- **Section A** — Financial situation (income, wealth, debt)
- **Section B** — Investment objectives and time horizon
- **Section C** — Risk tolerance (psychological)
- **Section D** — Financial knowledge test

Navigate between sections with the **Back / Next** buttons and submit at the end of Section D.
You will receive a risk score (8–68) and a profile label: **Low (Defensive)**, **Medium (Conservative)**, **Medium-High (Balanced)**, or **High (Aggressive)**.

## Step 2 — Build your Portfolio

Navigate to **Portfolio**.
Enter a stock ticker (e.g. `AAPL`), the number of shares you hold, and your average buy price.
Click **Add**. Repeat for each holding.

> Tip: add at least 2 holdings to unlock portfolio optimization.

## Step 3 — Optimize

Still in the Portfolio page, click **Optimize**.
The system fetches 1 year of historical price data and computes the allocation that maximizes your risk-adjusted return.
The result shows suggested weights (%), expected annual return, volatility, and Sharpe ratio.

## Step 4 — Get AI Advice

Navigate to **AI Advisor** and click **Generate**.
The AI analyses your current allocation against your risk profile and returns personalized investment advice.
Previous advice sessions are saved and can be reviewed by expanding the entries in the **Previous Advice** section.

## Step 5 — Explore the Market

Navigate to **Market**.
Type any ticker (stocks, ETFs, crypto like `BTC-USD`) and click **Search**.
The page shows key metrics (market cap, P/E, 52-week range, beta) and an interactive price chart.
Use the period buttons (1mo, 3mo, 6mo, 1y, 2y, 5y) to change the chart range.

## Dark / Light Mode

Click the theme toggle at the bottom of the sidebar to switch between dark and light mode.
Your preference is saved automatically.
