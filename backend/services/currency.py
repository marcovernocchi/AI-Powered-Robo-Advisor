import time
import yfinance as yf

_fx_cache: dict = {}
_ticker_currency_cache: dict = {}
FX_TTL = 3600

SUPPORTED_CURRENCIES = ['USD', 'EUR', 'CHF', 'GBP', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN']


def get_fx_rate(from_currency: str, to_currency: str) -> float:
    if from_currency == to_currency:
        return 1.0
    key = (from_currency, to_currency)
    cached = _fx_cache.get(key)
    if cached and time.time() - cached[1] < FX_TTL:
        return cached[0]
    try:
        rate = yf.Ticker(f"{from_currency}{to_currency}=X").fast_info.last_price
        if rate and rate > 0:
            _fx_cache[key] = (rate, time.time())
            return rate
    except Exception:
        pass
    return 1.0


def get_ticker_currency(ticker: str) -> str:
    if ticker in _ticker_currency_cache:
        return _ticker_currency_cache[ticker]
    try:
        currency = yf.Ticker(ticker).fast_info.currency or 'USD'
        _ticker_currency_cache[ticker] = currency
        return currency
    except Exception:
        _ticker_currency_cache[ticker] = 'USD'
        return 'USD'


def convert(amount: float, from_currency: str, to_currency: str) -> float:
    if from_currency == to_currency:
        return amount
    return amount * get_fx_rate(from_currency, to_currency)
