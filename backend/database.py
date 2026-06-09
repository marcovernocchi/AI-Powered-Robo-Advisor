from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from backend.config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from backend.db import models  # noqa: F401 — triggers table registration
    Base.metadata.create_all(bind=engine)


def migrate_db():
    from sqlalchemy import text
    with engine.connect() as conn:
        result = conn.execute(text("PRAGMA table_info(users)"))
        columns = {row[1] for row in result}
        if 'country' not in columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN country VARCHAR NOT NULL DEFAULT 'US'"))
        if 'display_currency' not in columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN display_currency VARCHAR NOT NULL DEFAULT 'USD'"))
        result2 = conn.execute(text("PRAGMA table_info(portfolios)"))
        pcols = {row[1] for row in result2}
        if 'include_in_aggregated' not in pcols:
            conn.execute(text("ALTER TABLE portfolios ADD COLUMN include_in_aggregated BOOLEAN NOT NULL DEFAULT 1"))
        result3 = conn.execute(text("PRAGMA table_info(holdings)"))
        hcols = {row[1] for row in result3}
        if 'asset_type' not in hcols:
            conn.execute(text("ALTER TABLE holdings ADD COLUMN asset_type VARCHAR NOT NULL DEFAULT 'security'"))
        if 'asset_name' not in hcols:
            conn.execute(text("ALTER TABLE holdings ADD COLUMN asset_name VARCHAR"))
        if 'purchase_date' not in hcols:
            conn.execute(text("ALTER TABLE holdings ADD COLUMN purchase_date DATE"))
        if 'fees' not in hcols:
            conn.execute(text("ALTER TABLE holdings ADD COLUMN fees FLOAT DEFAULT 0.0"))
        if 'notes' not in hcols:
            conn.execute(text("ALTER TABLE holdings ADD COLUMN notes TEXT"))
        if 'currency' not in hcols:
            conn.execute(text("ALTER TABLE holdings ADD COLUMN currency VARCHAR NOT NULL DEFAULT 'USD'"))
            # Existing holdings were recorded assuming the owner's display currency
            conn.execute(text("""
                UPDATE holdings
                SET currency = (
                    SELECT u.display_currency FROM users u
                    JOIN portfolios p ON p.user_id = u.id
                    WHERE p.id = holdings.portfolio_id
                )
            """))
        conn.commit()
