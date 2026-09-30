from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    log_level: str = "INFO"

    d1_database_name: str = "crypto-bot-platform-db"
    cloudflare_account_id: str
    cloudflare_d1_database_id: str
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30

    cors_origins: str = "http://localhost:3000"

    # PayHero (real-money deposits via M-Pesa STK push) - optional, only required
    # once real deposits are wired up. See app/services/payhero_service.py.
    payhero_api_username: str | None = None
    payhero_api_password: str | None = None
    payhero_account_id: str | None = None
    payhero_channel_id: str | None = None
    payhero_callback_base_url: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
