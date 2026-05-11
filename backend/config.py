from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///./robo_advisor.db"
    secret_key: str = "change-this-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    groq_api_key: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
