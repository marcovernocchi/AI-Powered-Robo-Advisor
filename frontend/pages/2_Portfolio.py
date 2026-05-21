import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import streamlit as st
from frontend.utils.api_client import get_portfolio, add_holding, delete_holding, get_optimization
from frontend.utils.charts import weights_bar

st.title("Portfolio Manager")

if not st.session_state.get("token"):
    st.warning("Please log in from the Home page.")
    st.stop()

token = st.session_state.token

# --- Add holding ---
st.subheader("Add a Holding")
with st.form("add_holding_form", clear_on_submit=True):
    col1, col2, col3 = st.columns(3)
    ticker = col1.text_input("Ticker (e.g. AAPL)")
    shares = col2.number_input("Number of Shares", min_value=0.001, step=0.1)
    avg_price = col3.number_input("Average Buy Price ($)", min_value=0.01, step=0.01)
    if st.form_submit_button("Add", use_container_width=True):
        if ticker:
            result = add_holding(token, ticker.strip().upper(), shares, avg_price)
            st.success(result.get("message", "Added"))
            st.rerun()

st.divider()

# --- Current holdings ---
st.subheader("Current Holdings")
portfolio = get_portfolio(token)
holdings = portfolio.get("holdings", [])

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

# --- Portfolio optimization ---
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
            col1, col2, col3 = st.columns(3)
            col1.metric("Expected Annual Return", f"{result['expected_annual_return_pct']:.2f}%")
            col2.metric("Annual Volatility", f"{result['annual_volatility_pct']:.2f}%")
            col3.metric("Sharpe Ratio", f"{result['sharpe_ratio']:.3f}")
            dark = st.session_state.get("dark_mode", True)
            st.plotly_chart(weights_bar(result["weights"], dark=dark), use_container_width=True)
