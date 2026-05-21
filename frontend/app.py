import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import streamlit as st
from frontend.utils.api_client import login, register, get_me, get_portfolio

st.set_page_config(page_title="AI Robo-Advisor", page_icon="📈", layout="wide")


if "token" not in st.session_state:
    st.session_state.token = None
if "user" not in st.session_state:
    st.session_state.user = None
if "primary_color" not in st.session_state:
    st.session_state.primary_color = "#1f77b4"
if "page_order" not in st.session_state:
    st.session_state.page_order = ["Dashboard", "Portfolio", "AI Advisor", "Market"]
if "show_settings" not in st.session_state:
    st.session_state.show_settings = False
if "show_capital" not in st.session_state:
    st.session_state.show_capital = False
if "total_value" not in st.session_state:
    st.session_state.total_value = None
if "dark_mode" not in st.session_state:
    st.session_state.dark_mode = True


def apply_theme(color: str, dark: bool) -> dict:
    bg         = "#0e1117" if dark else "#ffffff"
    text       = "#fafafa" if dark else "#0e1117"
    sidebar_bg = "#1a1d23" if dark else "#f0f2f6"

    btn_bg     = "#262730" if dark else "#e8eaf0"
    btn_text   = "#fafafa" if dark else "#0e1117"
    btn_border = "#3d4048" if dark else "#c0c4cc"
    widget_bg  = "#262730" if dark else "#f7f7f9"
    widget_border = "#3d4048" if dark else "#d0d3da"

    green_bg   = "#1e7e34" if dark else "#4caf50"
    blue_bg    = "#0d6efd" if dark else "#42a5f5"

    st.markdown(f"""
    <style>
    .stApp {{
        background-color: {bg} !important;
        color: {text} !important;
    }}
    [data-testid="stSidebar"] > div:first-child {{
        background-color: {sidebar_bg} !important;
    }}
    .stApp p, .stApp label, .stApp span, .stApp div,
    .stApp h1, .stApp h2, .stApp h3, .stApp h4 {{
        color: {text} !important;
    }}
    [data-testid="stHeader"], .stAppHeader {{
        background-color: {bg} !important;
    }}
    [data-testid="stSidebar"] [data-testid="stExpander"] {{
        background-color: {sidebar_bg} !important;
        border-color: {widget_border} !important;
    }}
    [data-testid="stSidebar"] [data-testid="stExpander"] summary,
    [data-testid="stSidebar"] [data-testid="stExpander"] summary span,
    [data-testid="stSidebar"] [data-testid="stExpander"] summary svg {{
        background-color: {sidebar_bg} !important;
        color: {text} !important;
        fill: {text} !important;
    }}
    [data-testid="stSidebar"] [data-testid="stExpander"] p,
    [data-testid="stSidebar"] [data-testid="stExpander"] label,
    [data-testid="stSidebar"] [data-testid="stExpander"] span:not([data-baseweb]),
    [data-testid="stSidebar"] [data-testid="stExpander"] div {{
        background-color: transparent !important;
        color: {text} !important;
    }}
    [data-testid="stSidebar"] .stButton > button[kind="secondary"] {{
        background-color: {btn_bg} !important;
        border-color: {btn_border} !important;
        color: {btn_text} !important;
    }}
    [data-testid="stSidebarNavLink"][aria-selected="true"] {{
        background-color: {color}22 !important;
        color: {color} !important;
        border-left: 3px solid {color};
    }}
    .stButton > button[kind="primary"],
    [data-testid="baseButton-primary"] {{
        background-color: #2196F3 !important;
        border-color: #1E88E5 !important;
        color: white !important;
    }}
    .stFormSubmitButton > button {{
        background-color: #2196F3 !important;
        border-color: #1E88E5 !important;
        color: white !important;
    }}
    a {{ color: {color} !important; }}
    [data-baseweb="tab-highlight"] {{ background-color: {color} !important; }}
    .stProgress > div > div > div > div {{ background-color: {color} !important; }}
    [data-testid="stSlider"] [role="slider"] {{ background-color: {color} !important; }}
    [data-testid="stTextInput"] input,
    [data-testid="stNumberInput"] input,
    [data-testid="stTextArea"] textarea {{
        background-color: {widget_bg} !important;
        color: {text} !important;
        border-color: {widget_border} !important;
    }}
    [data-baseweb="select"] > div,
    [data-baseweb="base-input"] {{
        background-color: {widget_bg} !important;
        color: {text} !important;
        border-color: {widget_border} !important;
    }}
    [data-baseweb="select"] svg {{
        fill: {text} !important;
        color: {text} !important;
    }}
    [data-baseweb="popover"],
    [data-baseweb="popover"] > div,
    [data-baseweb="popover"] [role="listbox"],
    [data-baseweb="popover"] ul,
    [data-baseweb="menu"] {{
        background-color: {widget_bg} !important;
        color: {text} !important;
    }}
    [data-baseweb="option"],
    [data-baseweb="option"] *,
    li[role="option"],
    li[role="option"] *,
    [role="listbox"] li,
    [role="listbox"] li * {{
        background-color: {widget_bg} !important;
        color: {text} !important;
    }}
    [data-baseweb="option"]:hover,
    [data-baseweb="option"]:hover *,
    li[role="option"]:hover,
    li[role="option"]:hover * {{
        background-color: {color}22 !important;
        color: {text} !important;
    }}
    .stButton > button[kind="secondary"],
    .stButton > button:not([kind="primary"]) {{
        background-color: #2196F3 !important;
        border-color: #1E88E5 !important;
        color: #ffffff !important;
    }}
    [data-testid="stNumberInput"] button {{
        background-color: {btn_bg} !important;
        border-color: {widget_border} !important;
        color: {btn_text} !important;
    }}
    [data-testid="stDataFrame"] iframe,
    .stDataFrame {{
        background-color: {widget_bg} !important;
        color: {text} !important;
    }}
    [data-testid="stCheckbox"] label {{
        outline: 2px solid #4da6ff !important;
        border-radius: 4px !important;
        padding: 2px 6px !important;
    }}
    </style>
    """, unsafe_allow_html=True)
    return {"green_bg": green_bg, "blue_bg": blue_bg}

theme = apply_theme(st.session_state.primary_color, st.session_state.dark_mode)

PAGE_DEFS = {
    "Dashboard":  {"file": "pages/1_Dashboard.py"},
    "Portfolio":  {"file": "pages/2_Portfolio.py"},
    "AI Advisor": {"file": "pages/3_AI_Advisor.py"},
    "Market":     {"file": "pages/4_Market.py"},
}

def login_page() -> None:
    st.title("AI Robo-Advisor Platform")
    st.markdown("Personalized investment advice powered by machine learning and AI.")
    st.divider()

    tab_login, tab_register = st.tabs(["Login", "Create Account"])

    with tab_login:
        with st.form("login_form"):
            email = st.text_input("Email")
            password = st.text_input("Password", type="password")
            submitted = st.form_submit_button("Login", use_container_width=True)
        if submitted:
            result = login(email, password)
            if "access_token" in result:
                user_data = get_me(result["access_token"])
                if "name" in user_data:
                    st.session_state.token = result["access_token"]
                    st.session_state.user = user_data
                    st.rerun()
                else:
                    st.error(f"Login succeeded but could not load profile: {user_data}")
            else:
                st.error(result.get("detail", "Login failed"))

    with tab_register:
        with st.form("register_form"):
            name = st.text_input("Full Name")
            email_r = st.text_input("Email")
            password_r = st.text_input("Password", type="password")
            submitted_r = st.form_submit_button("Create Account", use_container_width=True)
        if submitted_r:
            result = register(name, email_r, password_r)
            if "access_token" in result:
                user_data = get_me(result["access_token"])
                if "name" in user_data:
                    st.session_state.token = result["access_token"]
                    st.session_state.user = user_data
                    st.rerun()
                else:
                    st.error(f"Account created but could not load profile: {user_data}")
            else:
                st.error(result.get("detail", "Registration failed"))


if st.session_state.token is None:
    pg = st.navigation([st.Page(login_page, title="Login")])
else:
    user = st.session_state.user
    if not user or "name" not in user:
        st.error(f"Session error: {user}")
        st.session_state.token = None
        st.session_state.user = None
        st.rerun()

    # ── Top header row ──────────────────────────────────────────────
    hdr_left, hdr_right = st.columns([5, 2])

    with hdr_left:
        if user.get("risk_score"):
            from backend.models.risk import risk_label
            st.markdown(
                f'<span style="background:#0d6efd;color:white;padding:6px 14px;border-radius:6px;'
                f'font-size:0.85rem;line-height:1;">Risk profile: <b>{risk_label(user["risk_score"])}</b>'
                f' ({user["risk_score"]}/10)</span>',
                unsafe_allow_html=True,
            )

    with hdr_right:
        show = st.session_state.show_capital
        if st.session_state.total_value is None:
            _p = get_portfolio(st.session_state.token)
            st.session_state.total_value = _p.get("total_value", 0.0)
        total = st.session_state.total_value

        cap_label = f"${total:,.2f}" if show else "● ● ● ● ● ● ●"

        st.markdown(
            f'<div style="text-align:right;font-weight:600;margin-bottom:4px;">{user["name"]}</div>',
            unsafe_allow_html=True,
        )

        _, cap_btn_col = st.columns([1, 1])
        with cap_btn_col:
            if st.button(cap_label, key="cap_toggle", use_container_width=True):
                st.session_state.show_capital = not show
                st.rerun()

    st.divider()

    with st.sidebar:
        st.markdown("""
        <style>
        [data-testid="stSidebarNavLink"] { padding-top: 4px !important; padding-bottom: 4px !important; font-size: 0.9rem; }
        [data-testid="stSidebarUserContent"] [data-testid="stButton"] button {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            color: rgba(255,255,255,0.65) !important;
            font-size: 0.9rem !important;
            font-weight: 400 !important;
            padding: 4px 16px !important;
            text-align: left !important;
            width: 100% !important;
            min-height: unset !important;
        }
        [data-testid="stSidebarUserContent"] [data-testid="stButton"] button p {
            font-size: 0.9rem !important;
            font-weight: 400 !important;
        }
        [data-testid="stSidebarUserContent"] [data-testid="stButton"] button:hover {
            color: white !important;
            background: rgba(255,255,255,0.05) !important;
        }
        </style>
        """, unsafe_allow_html=True)

        if st.button("Customize", key="settings_btn", use_container_width=True):
            st.session_state.show_settings = not st.session_state.show_settings

        if st.session_state.show_settings:
            new_color = st.color_picker("Accent color", st.session_state.primary_color)
            if new_color != st.session_state.primary_color:
                st.session_state.primary_color = new_color
                st.rerun()

            dark_toggle = st.checkbox("Dark mode", value=st.session_state.dark_mode)
            if dark_toggle != st.session_state.dark_mode:
                st.session_state.dark_mode = dark_toggle
                st.rerun()

            st.markdown("**Page order**")
            order = list(st.session_state.page_order)
            order = [n for n in order if n in PAGE_DEFS]
            for i, name in enumerate(order):
                col_label, col_up, col_dn = st.columns([3, 1, 1])
                col_label.markdown(name)
                if i > 0 and col_up.button("▲", key=f"up_{i}"):
                    order[i], order[i - 1] = order[i - 1], order[i]
                    st.session_state.page_order = order
                    st.rerun()
                if i < len(order) - 1 and col_dn.button("▼", key=f"dn_{i}"):
                    order[i], order[i + 1] = order[i + 1], order[i]
                    st.session_state.page_order = order
                    st.rerun()

        if st.button("Logout", use_container_width=True):
            st.session_state.token = None
            st.session_state.user = None
            st.rerun()

    pages = [
        st.Page(PAGE_DEFS[name]["file"], title=name)
        for name in st.session_state.page_order
        if name in PAGE_DEFS
    ]
    pg = st.navigation(pages)

pg.run()
