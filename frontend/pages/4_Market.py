import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import streamlit as st
from frontend.utils.api_client import get_market_history, get_stock_info
from frontend.utils.charts import price_chart

st.title("Market Explorer")

if not st.session_state.get("token"):
    st.warning("Please log in from the Home page.")
    st.stop()

col1, col2 = st.columns([3, 1])
ticker = col1.text_input("Enter ticker symbol", value="AAPL", placeholder="e.g. MSFT, NVDA, BTC-USD").upper().strip()
period = col2.selectbox("Period", ["1mo", "3mo", "6mo", "1y", "2y", "5y", "max"], index=3)

if ticker:
    with st.spinner(f"Fetching data for {ticker}..."):
        info = get_stock_info(ticker)
        hist = get_market_history(ticker, period)

    if "error" in info:
        st.error(f"Could not find data for {ticker}")
    else:
        st.subheader(info.get("name", ticker))
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Sector", info.get("sector", "N/A"))
        c2.metric("P/E Ratio", f"{info.get('pe_ratio'):.1f}" if info.get("pe_ratio") else "N/A")
        c3.metric("52W High", f"${info.get('52w_high'):.2f}" if info.get("52w_high") else "N/A")
        c4.metric("52W Low", f"${info.get('52w_low'):.2f}" if info.get("52w_low") else "N/A")

        if hist.get("data"):
            st.plotly_chart(price_chart(hist["data"], ticker), use_container_width=True)

        if info.get("description"):
            with st.expander("About this company"):
                st.markdown(info["description"])
