"""Runtime configuration read from environment / .env.

Everything that can reach the outside world (LLM API, SMTP, website fetching)
is OFF unless explicitly configured. Demo mode is the default.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"

if load_dotenv:
    load_dotenv(ROOT / ".env")


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    db_path: Path = field(default_factory=lambda: Path(os.getenv("SALESPILOT_DB", str(ROOT / "data" / "salespilot.db"))))
    host: str = field(default_factory=lambda: os.getenv("SALESPILOT_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(os.getenv("SALESPILOT_PORT", "8000")))
    # LLM
    llm_provider: str = field(default_factory=lambda: os.getenv("LLM_PROVIDER", "mock").strip().lower())
    anthropic_api_key: str = field(default_factory=lambda: os.getenv("ANTHROPIC_API_KEY", ""))
    anthropic_model: str = field(default_factory=lambda: os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5"))
    # Email
    smtp_host: str = field(default_factory=lambda: os.getenv("SMTP_HOST", ""))
    smtp_port: int = field(default_factory=lambda: int(os.getenv("SMTP_PORT", "587") or 587))
    smtp_user: str = field(default_factory=lambda: os.getenv("SMTP_USER", ""))
    smtp_password: str = field(default_factory=lambda: os.getenv("SMTP_PASSWORD", ""))
    smtp_from: str = field(default_factory=lambda: os.getenv("SMTP_FROM", ""))
    # Hard switch: even in live mode nothing real is sent unless this is true.
    live_sending_enabled: bool = field(default_factory=lambda: _bool("LIVE_SENDING_ENABLED", False))
    # Live research = fetching public company websites (free, no API key).
    live_research_enabled: bool = field(default_factory=lambda: _bool("LIVE_RESEARCH_ENABLED", False))

    @property
    def smtp_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_user and self.smtp_password and self.smtp_from)

    @property
    def anthropic_configured(self) -> bool:
        return bool(self.anthropic_api_key)


def get_settings() -> Settings:
    return Settings()
