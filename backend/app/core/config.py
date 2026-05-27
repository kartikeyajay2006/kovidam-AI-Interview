from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = Field(default="Kovidam AI Interview API", alias="APP_NAME")
    app_env: str = Field(default="development", alias="APP_ENV")
    app_debug: bool = Field(default=True, alias="APP_DEBUG")
    app_host: str = Field(default="0.0.0.0", alias="APP_HOST")
    app_port: int = Field(default=8000, alias="APP_PORT")
    api_prefix: str = Field(default="/api/v1", alias="API_PREFIX")

    database_url: str = Field(alias="DATABASE_URL")
    redis_url: str = Field(alias="REDIS_URL")

    jwt_secret: str = Field(alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    access_token_expires_minutes: int = Field(default=15, alias="ACCESS_TOKEN_EXPIRES_MINUTES")
    refresh_token_expires_minutes: int = Field(default=10080, alias="REFRESH_TOKEN_EXPIRES_MINUTES")

    smtp_host: str = Field(default="", alias="SMTP_HOST")
    smtp_port: int = Field(default=587, alias="SMTP_PORT")
    smtp_username: str = Field(default="", validation_alias=AliasChoices("SMTP_USERNAME", "SMTP_USER"))
    smtp_password: str = Field(default="", alias="SMTP_PASSWORD")
    smtp_from_email: str = Field(default="", alias="SMTP_FROM_EMAIL")
    smtp_from_name: str = Field(default="Kovidam AI Interviews", alias="SMTP_FROM_NAME")
    smtp_use_tls: bool = Field(default=True, alias="SMTP_USE_TLS")
    smtp_use_ssl: bool = Field(default=False, alias="SMTP_USE_SSL")

    frontend_base_url: str = Field(default="http://localhost:3000", alias="FRONTEND_BASE_URL")
    openai_api_key: str = Field(default="", validation_alias=AliasChoices("OPENAI_API_KEY", "GROQ_API_KEY"))
    openai_model: str = Field(default="gpt-4o-mini", validation_alias=AliasChoices("OPENAI_MODEL", "GROQ_MODEL"))
    openai_fallback_model: str = Field(default="", alias="OPENAI_FALLBACK_MODEL")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
