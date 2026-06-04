import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import streamlit as st
from frontend.utils.api_client import get_portfolio, add_holding, delete_holding, get_optimization
from frontend.utils.ticker_search import ticker_searchbox, extract_ticker
from frontend.utils.charts import weights_bar

st.title("Portfolio Manager")

if not st.session_state.get("token"):
    st.warning("Please log in from the Home page.")
    st.stop()

token = st.session_state.token
dark  = st.session_state.get("dark_mode", True)

# ── session-state init ────────────────────────────────────────────────────────
if "ticker_search_key" not in st.session_state:
    st.session_state.ticker_search_key = 0


# ── Add holding section ───────────────────────────────────────────────────────
st.subheader("Add a Holding")

# The searchbox must live OUTSIDE a st.form because forms batch all widget
# updates until submit, which prevents the live suggestion loading.
col_ticker, col_shares, col_price = st.columns(3)

with col_ticker:
    # Keyed with a counter so it resets cleanly after a successful add.
    ticker_raw = ticker_searchbox(
        label="Ticker",
        key=f"ticker_sb_{st.session_state.ticker_search_key}",
        dark=dark,
    )

with col_shares:
    shares = st.number_input(
        "Number of Shares", min_value=0.001, step=0.1,
        key=f"shares_{st.session_state.ticker_search_key}",
    )

with col_price:
    avg_price = st.number_input(
        "Average Buy Price ($)", min_value=0.01, step=0.01,
        key=f"price_{st.session_state.ticker_search_key}",
    )

# "Add" button lives below the three columns, full-width
if st.button("Add", use_container_width=True, key="add_btn"):
    ticker = extract_ticker(ticker_raw)
    if ticker:
        result = add_holding(token, ticker, shares, avg_price)
        st.success(result.get("message", "Added"))
        # Increment key to reset searchbox + number inputs on next render
        st.session_state.ticker_search_key += 1
        st.rerun()
    else:
        st.error("Please enter or select a ticker symbol.")

st.divider()

# ── Current holdings ──────────────────────────────────────────────────────────
st.subheader("Current Holdings")
portfolio = get_portfolio(token)
holdings  = portfolio.get("holdings", [])

if holdings:
    for h in holdings:
        col1, col2, col3, col4 = st.columns([2, 2, 2, 1])
        col1.write(f"**{h['ticker']}** — {h['shares']} shares")
        col2.write(f"Avg: ${h['avg_buy_price']:.2f} | Now: ${h['current_price']:.2f}")
        col3.write(f"Value: ${h['value']:.2f} | P&L: {h['pnl_pct']:+.2f}%")
        if col4.button("Remove", key=f"del_{h['id']}"):
            delete_holding(token, h["id"])
            st.rerun()
else:
    st.info("No holdings yet.")

st.divider()

# ── Portfolio optimisation ─────────────────────────────────────────────────────
st.subheader("Portfolio Optimization")
st.markdown("Uses mean-variance optimization to suggest the best weights for your risk profile.")

user = st.session_state.get("user", {})
if not user.get("risk_score"):
    st.warning("Complete the risk questionnaire in the AI Advisor page first.")
else:
    if st.button("Run Optimization", use_container_width=True):
        with st.spinner("Fetching historical data and optimizing..."):
            result = get_optimization(token)

        if "error" in result or "detail" in result:
            st.error(result.get("detail") or result.get("error"))
        else:
            for w in result.get("warnings", []):
                st.warning(w)
            col1, col2, col3 = st.columns(3)
            col1.metric("Expected Annual Return", f"{result['expected_annual_return_pct']:.2f}%")
            col2.metric("Annual Volatility",       f"{result['annual_volatility_pct']:.2f}%")
            col3.metric("Sharpe Ratio",             f"{result['sharpe_ratio']:.3f}")
            st.plotly_chart(weights_bar(result["weights"], dark=dark), use_container_width=True)
