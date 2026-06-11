from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, Date, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from backend.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    risk_score = Column(Integer, nullable=True)
    country = Column(String, nullable=False, default='US', server_default='US')
    display_currency = Column(String, nullable=False, default='USD', server_default='USD')
    created_at = Column(DateTime, default=datetime.utcnow)

    portfolios = relationship("Portfolio", back_populates="user")
    advice_history = relationship("Advice", back_populates="user")


class Portfolio(Base):
    __tablename__ = "portfolios"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, default="My Portfolio")
    include_in_aggregated = Column(Boolean, default=True, server_default='1')
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="portfolios")
    holdings = relationship("Holding", back_populates="portfolio", cascade="all, delete-orphan")


class Holding(Base):
    __tablename__ = "holdings"

    id = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id"), nullable=False)
    ticker = Column(String, nullable=False)
    asset_name = Column(String, nullable=True)
    asset_type = Column(String, nullable=False, default='security', server_default='security')
    shares = Column(Float, nullable=False)
    avg_buy_price = Column(Float, nullable=False)
    currency = Column(String, nullable=False, default='USD', server_default='USD')
    purchase_date = Column(Date, nullable=True)
    fees = Column(Float, nullable=True, default=0.0)
    notes = Column(Text, nullable=True)

    portfolio = relationship("Portfolio", back_populates="holdings")


class Advice(Base):
    __tablename__ = "advice"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="advice_history")


class PriceCache(Base):
    __tablename__ = "price_cache"

    ticker = Column(String, primary_key=True)
    price = Column(Float, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow)


class OptimizationResult(Base):
    """Persists the latest optimization result per user.

    One row per user — upserted each time the user runs optimization.
    weights: JSON dict {ticker: float} of optimized weights in [0, 1].
    """
    __tablename__ = "optimization_results"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    weights = Column(JSON, nullable=False)               # {ticker: weight_float}
    expected_annual_return_pct = Column(Float, nullable=True)
    annual_volatility_pct = Column(Float, nullable=True)
    sharpe_ratio = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
