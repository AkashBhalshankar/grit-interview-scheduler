import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./grit.db")
    demo_mode: bool = os.getenv("DEMO_MODE", "1") == "1"   # enables /api/demo/* and the X-Demo-Offset-Minutes clock
    cors_origins: tuple = tuple(o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(","))
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")


settings = Settings()
