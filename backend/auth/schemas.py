from pydantic import BaseModel, EmailStr
from typing import Optional

COUNTRY_CURRENCY = {
    'CH': 'CHF', 'IT': 'EUR', 'DE': 'EUR', 'FR': 'EUR', 'ES': 'EUR',
    'PT': 'EUR', 'AT': 'EUR', 'NL': 'EUR', 'BE': 'EUR', 'LU': 'EUR',
    'FI': 'EUR', 'IE': 'EUR', 'GR': 'EUR', 'SK': 'EUR', 'SI': 'EUR',
    'EE': 'EUR', 'LV': 'EUR', 'LT': 'EUR', 'MT': 'EUR', 'CY': 'EUR',
    'US': 'USD', 'CA': 'CAD', 'AU': 'AUD', 'GB': 'GBP', 'JP': 'JPY',
    'SE': 'SEK', 'NO': 'NOK', 'DK': 'DKK', 'PL': 'PLN', 'CZ': 'CZK',
    'HU': 'HUF', 'RO': 'RON', 'HK': 'HKD', 'SG': 'SGD',
}


class UserRegister(BaseModel):
    email: EmailStr
    name: str
    password: str
    country: str = 'US'


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    risk_score: Optional[int]
    risk_section_scores: Optional[dict] = None
    risk_bands: Optional[dict] = None
    risk_prudence_applied: Optional[bool] = None
    risk_knowledge_level: Optional[str] = None
    country: str = 'US'
    display_currency: str = 'USD'

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    display_currency: Optional[str] = None
    country: Optional[str] = None
