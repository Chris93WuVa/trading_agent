"""Schnittstelle für Marktdaten-Provider."""

from __future__ import annotations

from abc import ABC, abstractmethod

import pandas as pd

# Chart-Zeiträume (Trade-Republic-Logik) -> (Yahoo-period, Yahoo-interval)
RANGES = {
    "1T": ("5d", "5m"),     # wird auf die letzte Handelssitzung gekürzt
    "1W": ("5d", "30m"),
    "1M": ("1mo", "1h"),
    "6M": ("6mo", "1d"),
    "1J": ("1y", "1d"),
    "5J": ("5y", "1wk"),
    "MAX": ("max", "1mo"),
}

OHLCV = ["open", "high", "low", "close", "volume"]


class ProviderError(RuntimeError):
    """Daten konnten nicht geladen werden (Netzwerk, unbekanntes Symbol, Rate-Limit)."""


class MarketDataProvider(ABC):
    name: str = "base"
    is_demo: bool = False
    delay_note: str = ""

    @abstractmethod
    def search(self, query: str, limit: int = 12) -> list[dict]:
        """Treffer: symbol, name, exchange, quote_type."""

    @abstractmethod
    def quote(self, symbol: str) -> dict:
        """symbol, name, price, prev_close, currency, exchange, quote_type, time (Unix s)."""

    @abstractmethod
    def history(self, symbol: str, period: str, interval: str, adjusted: bool = True) -> pd.DataFrame:
        """OHLCV-DataFrame mit tz-aware DatetimeIndex, Spalten wie ``OHLCV``."""

    @abstractmethod
    def info(self, symbol: str) -> dict:
        """Stammdaten und Fundamentaldaten (normalisierte Schlüssel, Brüche statt Prozent)."""

    @abstractmethod
    def dividends(self, symbol: str) -> pd.Series:
        """Dividenden je Anteil mit DatetimeIndex."""

    def options(self, symbol: str, expiry: str | None = None) -> dict:
        return {"expiries": [], "expiry": None, "calls": [], "puts": []}

    def screen(self, name: str, count: int = 25) -> list[dict]:
        return []
