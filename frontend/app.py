import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import streamlit as st
from frontend.utils.api_client import login, register, get_me

st.set_page_config(page_title="AI Robo-Advisor", page_icon="📈", layout="wide")


if "token" not in st.session_state:
    st.session_state.token = None
if "user" not in st.session_state:
    st.session_state.user = None
if "primary_color" not in st.session_state:
    st.session_state.primary_color = "#1f77b4"
if "page_order" not in st.session_state:
    st.session_state.page_order = ["Dashboard", "Portfolio", "AI Advisor", "Market"]


def apply_theme(color: str) -> None:
    st.markdown(f"""
    <style>
    [data-testid="stSidebarNavLink"][aria-selected="true"] {{
        background-color: {color}22 !important;
        color: {color} !important;
        border-left: 3px solid {color};
    }}
    .stButton > button[kind="primary"],
    [data-testid="baseButton-primary"] {{
        background-color: {color} !important;
        border-color: {color} !important;
        color: white !important;
    }}
    .stFormSubmitButton > button {{
        background-color: {color} !important;
        border-color: {color} !important;
        color: white !important;
    }}
    a {{ color: {color} !important; }}
    [data-baseweb="tab-highlight"] {{ background-color: {color} !important; }}
    .stProgress > div > div > div > div {{ background-color: {color} !important; }}
    [data-testid="stSlider"] [role="slider"] {{ background-color: {color} !important; }}
    </style>
    """, unsafe_allow_html=True)

apply_theme(st.session_state.primary_color)

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
    if user.get("risk_score"):
        from backend.models.risk import risk_label
        risk_badge = (
            f'<span style="background:#0d6efd;color:white;padding:6px 14px;border-radius:6px;'
            f'font-size:0.85rem;line-height:1;">Risk profile: <b>{risk_label(user["risk_score"])}</b>'
            f' ({user["risk_score"]}/10)</span>'
        )
    else:
        risk_badge = ""

    badge_style = (
        "background:#1e7e34;color:white;padding:6px 14px;border-radius:6px;"
        "font-size:0.85rem;line-height:1;"
    )
    st.markdown(
        f'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">'
        f'  <div style="display:flex;gap:8px;align-items:center;">'
        f'    <span style="{badge_style}">Logged in as <b>{user["name"]}</b></span>'
        f'    {risk_badge}'
        f'  </div>'
        f'</div>',
        unsafe_allow_html=True,
    )
    st.divider()

    with st.sidebar:
        st.markdown("""
        <style>
        [data-testid="stSidebarNavLink"] { padding-top: 4px !important; padding-bottom: 4px !important; font-size: 0.9rem; }
        </style>
        """, unsafe_allow_html=True)

        with st.expander("⚙ Customize"):
            new_color = st.color_picker("Accent color", st.session_state.primary_color)
            if new_color != st.session_state.primary_color:
                st.session_state.primary_color = new_color
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

        st.divider()
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
