import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import streamlit as st
from frontend.utils.api_client import set_risk_profile, get_me, get_advice, get_advice_history

st.title("AI Financial Advisor")

if not st.session_state.get("token"):
    st.warning("Please log in from the Home page.")
    st.stop()

token = st.session_state.token
user = st.session_state.user

# --- Risk questionnaire ---
st.subheader("Risk Profile Questionnaire")

if user.get("risk_score"):
    from backend.models.risk import risk_label
    label = risk_label(user["risk_score"])
    st.success(f"Your current risk profile: **{label}** (score {user['risk_score']}/10)")
    if st.button("Retake questionnaire"):
        user["risk_score"] = None

if not user.get("risk_score"):
    with st.form("risk_form"):
        st.markdown("Answer these questions honestly — they determine your investment recommendations.")
        age = st.slider("Your age", 18, 80, 30)
        horizon = st.slider("Investment horizon (years)", 1, 40, 10)
        income = st.select_slider(
            "Income stability",
            options=[1, 2, 3, 4, 5],
            format_func=lambda x: {1: "Very unstable", 2: "Unstable", 3: "Moderate", 4: "Stable", 5: "Very stable"}[x],
            value=3,
        )
        loss = st.select_slider(
            "If your portfolio dropped 20%, you would...",
            options=[1, 2, 3, 4, 5],
            format_func=lambda x: {
                1: "Sell everything immediately",
                2: "Sell some",
                3: "Do nothing and wait",
                4: "Buy a little more",
                5: "Buy a lot more",
            }[x],
            value=3,
        )
        experience = st.select_slider(
            "Investment experience",
            options=[1, 2, 3, 4, 5],
            format_func=lambda x: {1: "None", 2: "Beginner", 3: "Intermediate", 4: "Advanced", 5: "Expert"}[x],
            value=2,
        )
        if st.form_submit_button("Calculate my risk profile", use_container_width=True):
            answers = {
                "age": age,
                "investment_horizon": horizon,
                "income_stability": income,
                "loss_tolerance": loss,
                "investment_experience": experience,
            }
            result = set_risk_profile(token, answers)
            if "risk_score" in result:
                st.session_state.user = get_me(token)
                st.success(f"Profile set: **{result['risk_profile']}** (score {result['risk_score']}/10)")
                st.rerun()
            else:
                st.error("Something went wrong")

st.divider()

# --- AI advice generation ---
st.subheader("Get Personalized Advice")
st.markdown("The AI analyses your portfolio and risk profile to generate tailored investment advice.")

if not user.get("risk_score"):
    st.info("Complete the risk questionnaire above first.")
else:
    if st.button("Generate AI Advice", use_container_width=True, type="primary"):
        with st.spinner("Thinking... (using Llama 3.3 70B via Groq)"):
            result = get_advice(token)
        if "advice" in result:
            st.markdown("### Advice")
            st.markdown(result["advice"])
        else:
            st.error(result.get("detail", "Could not generate advice"))

    st.divider()
    st.subheader("Previous Advice")
    history = get_advice_history(token)
    if history:
        for item in history:
            with st.expander(f"Generated on {item['created_at'][:10]}"):
                st.markdown(item["content"])
    else:
        st.info("No previous advice yet.")
