import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import streamlit as st
from frontend.utils.api_client import get_portfolio
from frontend.utils.charts import portfolio_pie, pnl_bar

st.title("Dashboard")

if not st.session_state.get("token"):
    st.warning("Please log in from the Home page.")
    st.stop()

with st.spinner("Loading portfolio..."):
    portfolio = get_portfolio(st.session_state.token)

holdings = portfolio.get("holdings", [])
total_value = portfolio.get("total_value", 0.0)
st.session_state.total_value = total_value

col1, col2, col3 = st.columns(3)
col1.metric("Total Portfolio Value", f"${total_value:,.2f}")
col2.metric("Holdings", len(holdings))
if holdings:
    avg_pnl = sum(h["pnl_pct"] for h in holdings) / len(holdings)
    col3.metric("Avg P&L", f"{avg_pnl:+.2f}%", delta_color="normal")

st.divider()

if holdings:
    left, right = st.columns(2)
    with left:
        st.plotly_chart(portfolio_pie(holdings), use_container_width=True)
    with right:
        st.plotly_chart(pnl_bar(holdings), use_container_width=True)

    st.subheader("Holdings Detail")
    st.dataframe(
        [
            {
                "Ticker": h["ticker"],
                "Shares": h["shares"],
                "Avg Buy ($)": h["avg_buy_price"],
                "Current ($)": h["current_price"],
                "Value ($)": h["value"],
                "P&L (%)": f"{h['pnl_pct']:+.2f}%",
            }
            for h in holdings
        ],
        use_container_width=True,
        hide_index=True,
    )
else:
    st.info("No holdings yet. Head to the Portfolio page to add some.")
