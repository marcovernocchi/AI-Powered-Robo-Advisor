"""
Shared ticker autocomplete component.

Usage
-----
from frontend.utils.ticker_search import ticker_searchbox, extract_ticker

raw = ticker_searchbox(
    label="Ticker",
    key="my_unique_key",
    dark=st.session_state.get("dark_mode", True),
)
ticker = extract_ticker(raw)   # "AAPL — Apple Inc."  →  "AAPL"
"""

import streamlit as st
from streamlit_searchbox import st_searchbox
from frontend.utils.api_client import search_tickers


def _style(dark: bool) -> dict:
    """react-select style overrides that mirror the app's dark / light palette."""
    if dark:
        bg       = "#262730"
        text     = "#fafafa"
        border   = "#3d4048"
        menu_bg  = "#1a1d23"
        hover_bg = "#3d4048"
        ph_col   = "#888888"
    else:
        bg       = "#f7f7f9"
        text     = "#0e1117"
        border   = "#d0d3da"
        menu_bg  = "#ffffff"
        hover_bg = "#e8eaf0"
        ph_col   = "#aaaaaa"

    return {
        "searchbox": {
            "control": {
                "backgroundColor": bg,
                "borderColor": border,
                "color": text,
                "boxShadow": "none",
                "minHeight": "38px",
            },
            "input":       {"color": text},
            "placeholder": {"color": ph_col},
            "singleValue": {"color": text},
            "menuList": {
                "backgroundColor": menu_bg,
                "border": f"1px solid {border}",
                "borderRadius": "4px",
                "padding": "0",
            },
            "option": {
                "backgroundColor": menu_bg,
                "color": text,
                "hover": {"backgroundColor": hover_bg, "color": text},
            },
        }
    }


def _search_fn(query: str) -> list[str]:
    """Called by st_searchbox on each debounced keystroke."""
    if not query:
        return []
    results = search_tickers(query)
    if not isinstance(results, list):
        return []
    out = []
    for r in results:
        sym  = r.get("symbol", "")
        name = r.get("name", "")
        out.append(f"{sym} — {name}" if name else sym)
    return out


def ticker_searchbox(
    label: str,
    key: str,
    dark: bool,
    *,
    placeholder: str = "e.g. AAPL",
    default_searchterm: str = "",
    debounce: int = 250,
    edit_after_submit: str = "option",
) -> str | None:
    """
    Render a themed ticker autocomplete and return the raw selected value
    (e.g. "AAPL — Apple Inc." or just "TSLA" if typed directly).

    Pass the result to extract_ticker() to get a clean symbol string.

    WHY label=None below:
    The component renders its label inside an iframe using e.textColor from
    Streamlit's built-in theme.  The app's dark/light mode is implemented via
    CSS injection (app.py apply_theme), which never reaches the iframe.  Passing
    label=None prevents the component from rendering a label that ignores theme
    switches; we render our own label in the main document where the global
    `.stApp div { color: ... !important }` rule applies correctly.
    """
    if label:
        # Rendered in the main document — styled by app.py's global CSS rule
        # `.stApp p, .stApp div { color: {text} !important }` — no hardcoded colour.
        # Font size / weight match Streamlit's standard widget label appearance.
        st.markdown(
            f'<p style="font-size:0.875rem;font-weight:400;'
            f'margin-bottom:0.25rem;margin-top:0;">{label}</p>',
            unsafe_allow_html=True,
        )

    return st_searchbox(
        _search_fn,
        placeholder=placeholder,
        label=None,           # label rendered above via st.markdown — see docstring
        key=key,
        debounce=debounce,
        default_use_searchterm=True,
        default_searchterm=default_searchterm,
        edit_after_submit=edit_after_submit,
        style_overrides=_style(dark),
    )


def extract_ticker(raw: str | None) -> str:
    """
    Normalise a searchbox return value to a plain uppercase ticker symbol.

    "AAPL — Apple Inc."  →  "AAPL"
    "tsla"               →  "TSLA"
    None                 →  ""
    """
    if not raw:
        return ""
    return raw.split(" — ")[0].strip().upper()
