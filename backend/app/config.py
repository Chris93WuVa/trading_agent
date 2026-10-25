"""Konfiguration aus Umgebungsvariablen (optional aus einer ``.env``-Datei)."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(Path(os.environ.get("ENV_FILE", BASE_DIR / ".env")))


@dataclass(frozen=True)
class Settings:
    password_hash: str
    secret_key: str
    data_provider: str
    data_dir: Path
    frontend_dir: Path
    cookie_secure: bool
    session_days: int


def load_settings() -> Settings:
    secret = os.environ.get("SECRET_KEY") or ""
    if not secret:
        # Ohne festen Schlüssel werden Sitzungen bei jedem Neustart ungültig.
        secret = secrets.token_urlsafe(48)
    return Settings(
        password_hash=os.environ.get("DASHBOARD_PASSWORD_HASH", ""),
        secret_key=secret,
        data_provider=os.environ.get("DATA_PROVIDER", "yahoo").lower(),
        data_dir=Path(os.environ.get("DATA_DIR", BASE_DIR / "var")),
        frontend_dir=Path(os.environ.get("FRONTEND_DIR", BASE_DIR / "frontend")),
        cookie_secure=os.environ.get("COOKIE_SECURE", "1") != "0",
        session_days=int(os.environ.get("SESSION_DAYS", "14")),
    )


settings = load_settings()
