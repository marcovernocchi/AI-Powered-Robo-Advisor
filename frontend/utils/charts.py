import pandas as pd
import plotly.graph_objects as go


def price_chart(data: list, ticker: str) -> go.Figure:
    df = pd.DataFrame(data)
    df["Date"] = pd.to_datetime(df["Date"], utc=True).dt.tz_localize(None)
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=df["Date"], y=df["Close"], mode="lines", name=ticker, line=dict(color="#00D4FF", width=2)))
    fig.update_layout(
        title=f"{ticker} Price History",
        xaxis_title="Date",
        yaxis_title="Price (USD)",
        template="plotly_dark",
        height=400,
        margin=dict(l=0, r=0, t=40, b=0),
    )
    return fig


def portfolio_pie(holdings: list) -> go.Figure:
    fig = go.Figure(go.Pie(
        labels=[h["ticker"] for h in holdings],
        values=[h["value"] for h in holdings],
        hole=0.4,
    ))
    fig.update_layout(title="Allocation", template="plotly_dark", height=350, margin=dict(t=40, b=0))
    return fig


def pnl_bar(holdings: list) -> go.Figure:
    colors = ["#00C853" if h["pnl_pct"] >= 0 else "#FF1744" for h in holdings]
    fig = go.Figure(go.Bar(
        x=[h["ticker"] for h in holdings],
        y=[h["pnl_pct"] for h in holdings],
        marker_color=colors,
        text=[f"{h['pnl_pct']:+.2f}%" for h in holdings],
        textposition="outside",
    ))
    fig.update_layout(title="P&L per Holding (%)", template="plotly_dark", height=300, margin=dict(t=40, b=0))
    return fig


def weights_bar(weights: dict) -> go.Figure:
    fig = go.Figure(go.Bar(
        x=list(weights.keys()),
        y=[v * 100 for v in weights.values()],
        marker_color="#7C4DFF",
        text=[f"{v*100:.1f}%" for v in weights.values()],
        textposition="outside",
    ))
    fig.update_layout(title="Suggested Optimal Weights (%)", template="plotly_dark", height=320, margin=dict(t=40, b=0))
    return fig
