import os
import requests

BASE_URL = os.getenv("API_URL", "http://localhost:8000")


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _safe_json(r: requests.Response) -> dict | list:
    try:
        return r.json()
    except requests.exceptions.JSONDecodeError:
        return {"detail": f"Backend error (HTTP {r.status_code}): {r.text[:300] or 'empty response — check backend terminal'}"}


def _call(method: str, path: str, **kwargs) -> dict | list:
    try:
        r = requests.request(method, f"{BASE_URL}{path}", timeout=30, **kwargs)
        return _safe_json(r)
    except requests.exceptions.ConnectionError:
        return {"detail": "Cannot reach backend. Make sure `uvicorn backend.main:app --reload` is running in another terminal."}


def login(email: str, password: str) -> dict:
    return _call("POST", "/auth/login", data={"username": email, "password": password})


def register(name: str, email: str, password: str) -> dict:
    return _call("POST", "/auth/register", json={"name": name, "email": email, "password": password})


def get_me(token: str) -> dict:
    return _call("GET", "/auth/me", headers=_auth_headers(token))


def set_risk_profile(token: str, answers: dict) -> dict:
    return _call("POST", "/risk-profile", json=answers, headers=_auth_headers(token))


def get_portfolio(token: str) -> dict:
    return _call("GET", "/portfolio/", headers=_auth_headers(token))


def add_holding(token: str, ticker: str, shares: float, avg_buy_price: float) -> dict:
    return _call(
        "POST", "/portfolio/holdings",
        json={"ticker": ticker, "shares": shares, "avg_buy_price": avg_buy_price},
        headers=_auth_headers(token),
    )


def delete_holding(token: str, holding_id: int) -> dict:
    return _call("DELETE", f"/portfolio/holdings/{holding_id}", headers=_auth_headers(token))


def get_optimization(token: str) -> dict:
    return _call("GET", "/portfolio/optimize", headers=_auth_headers(token))


def search_tickers(query: str) -> list:
    """Returns list of {symbol, name, type} dicts for the given prefix query."""
    if not query or len(query) < 1:
        return []
    return _call("GET", f"/market/search?q={query}") or []


def get_market_history(ticker: str, period: str = "1y") -> dict:
    return _call("GET", f"/market/history/{ticker}?period={period}")


def get_stock_info(ticker: str) -> dict:
    return _call("GET", f"/market/info/{ticker}")


def get_advice(token: str) -> dict:
    return _call("POST", "/advice/generate", headers=_auth_headers(token))


def get_advice_history(token: str) -> list:
    return _call("GET", "/advice/history", headers=_auth_headers(token))
