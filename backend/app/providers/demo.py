"""Offline-Demo-Provider mit synthetischen Kursen.

Erzeugt deterministische Kursreihen (geometrische Brownsche Bewegung, Seed aus
dem Symbol) für Entwicklung, Tests und Vorführungen ohne Internetzugang. Die
Daten sind frei erfunden; das UI kennzeichnet den Modus deutlich.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from ..universe import KNOWN_CLASS, KNOWN_NAMES, YIELD_SYMBOLS
from .base import OHLCV, MarketDataProvider, ProviderError

_CLASS_PARAMS = {  # (Startkurs-Bereich, Volatilität p.a.)
    "aktien": ((20, 600), 0.30), "etf": ((30, 500), 0.17), "fonds": ((20, 400), 0.16),
    "anleihen": ((2, 110), 0.09), "waehrungen": ((0.6, 1.6), 0.08), "krypto": ((0.2, 60000), 0.70),
    "derivate": ((2, 5000), 0.28), "indizes": ((1000, 20000), 0.18),
}
_CURRENCY = {".DE": "EUR", ".AS": "EUR", ".PA": "EUR", ".SW": "CHF", ".CO": "DKK", "-EUR": "EUR"}
_START = pd.Timestamp("2014-01-01", tz="UTC")


def _seed(symbol: str) -> int:
    return int.from_bytes(hashlib.sha256(symbol.encode()).digest()[:4], "little")


def _currency(symbol: str) -> str:
    for suffix, ccy in _CURRENCY.items():
        if symbol.endswith(suffix):
            return ccy
    if symbol.endswith("=X") and len(symbol) == 8:
        return symbol[3:6]
    return "USD"


class DemoProvider(MarketDataProvider):
    name = "Demo (synthetische Daten)"
    is_demo = True
    delay_note = "Synthetische Kurse – keine echten Marktdaten"

    def _daily(self, symbol: str) -> pd.DataFrame:
        cls = KNOWN_CLASS.get(symbol, "aktien")
        (lo, hi), vol = ((1.0, 5.0), 0.25) if symbol in YIELD_SYMBOLS else _CLASS_PARAMS[cls]
        rng = np.random.default_rng(_seed(symbol))
        freq = "D" if cls == "krypto" else "B"
        today = pd.Timestamp(datetime.now(timezone.utc).date(), tz="UTC")
        idx = pd.date_range(_START, today, freq=freq)
        ppy = 365 if cls == "krypto" else 252
        mu = rng.normal(0.06, 0.10)
        sigma = vol * rng.uniform(0.7, 1.3)
        # Regimewechsel der Drift sorgen für realistischere Trendphasen.
        regimes = np.repeat(rng.normal(mu, 0.25, size=len(idx) // 120 + 1), 120)[: len(idx)]
        log_ret = (regimes - 0.5 * sigma**2) / ppy + sigma / np.sqrt(ppy) * rng.standard_t(5, len(idx)) * 0.77
        start = np.exp(rng.uniform(np.log(lo), np.log(hi)))
        close = start * np.exp(np.cumsum(log_ret))
        spread = np.abs(rng.normal(0, sigma / np.sqrt(ppy), len(idx)))
        open_ = close * np.exp(rng.normal(0, sigma / np.sqrt(ppy) / 2, len(idx)))
        high = np.maximum(open_, close) * (1 + spread / 2)
        low = np.minimum(open_, close) * (1 - spread / 2)
        volume = rng.lognormal(14, 0.5, len(idx)).round()
        return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close,
                             "volume": volume}, index=idx)

    def search(self, query: str, limit: int = 12) -> list[dict]:
        q = query.lower().strip()
        hits = [s for s, n in KNOWN_NAMES.items() if q in s.lower() or q in n.lower()]
        return [{"symbol": s, "name": KNOWN_NAMES[s], "exchange": "Demo",
                 "quote_type": None} for s in hits[:limit]]

    def quote(self, symbol: str) -> dict:
        df = self._daily(symbol)
        return {"symbol": symbol, "name": KNOWN_NAMES.get(symbol, symbol),
                "price": float(df["close"].iloc[-1]), "prev_close": float(df["close"].iloc[-2]),
                "currency": _currency(symbol), "exchange": "Demo", "quote_type": None,
                "time": int(df.index[-1].timestamp())}

    def history(self, symbol: str, period: str, interval: str, adjusted: bool = True) -> pd.DataFrame:
        df = self._daily(symbol)
        if interval in {"5m", "30m", "1h"}:
            return self._intraday(symbol, df, period, interval)
        if period != "max":
            unit = "mo" if period.endswith("mo") else period[-1]
            n = int(period[: -len(unit)])
            offset = {"d": pd.DateOffset(days=n), "mo": pd.DateOffset(months=n), "y": pd.DateOffset(years=n)}[unit]
            df = df[df.index >= df.index[-1] - offset]
        if interval == "1wk":
            df = df.resample("W").agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
        elif interval == "1mo":
            df = df.resample("ME").agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
        return df.dropna(subset=["close"])[OHLCV]

    def _intraday(self, symbol: str, daily: pd.DataFrame, period: str, interval: str) -> pd.DataFrame:
        days = {"5d": 5, "1mo": 22}.get(period, 5)
        step = {"5m": 5, "30m": 30, "1h": 60}[interval]
        rng = np.random.default_rng(_seed(symbol + interval))
        frames = []
        tail = daily.iloc[-(days + 1):]
        for (_, prev), (ts, row) in zip(tail.iloc[:-1].iterrows(), tail.iloc[1:].iterrows(), strict=True):
            times = pd.date_range(ts + pd.Timedelta(hours=8), ts + pd.Timedelta(hours=16, minutes=30),
                                  freq=f"{step}min")
            n = len(times)
            walk = np.cumsum(rng.normal(0, 1, n))
            bridge = walk - np.linspace(0, 1, n) * walk[-1]
            path = np.linspace(prev["close"], row["close"], n) + bridge * row["close"] * 0.0015
            frames.append(pd.DataFrame({"open": path, "high": path, "low": path, "close": path,
                                        "volume": 0.0}, index=times))
        if not frames:
            raise ProviderError("Keine Intraday-Daten")
        return pd.concat(frames)

    def info(self, symbol: str) -> dict:
        cls = KNOWN_CLASS.get(symbol, "aktien")
        rng = np.random.default_rng(_seed(symbol + "info"))
        base = {"name": KNOWN_NAMES.get(symbol, symbol), "quote_type": None,
                "currency": _currency(symbol), "exchange": "Demo",
                "summary": "Synthetisches Demo-Instrument. Alle Werte sind zufällig erzeugt."}
        if cls != "aktien":
            return base | {"category": "Demo", "total_assets": float(rng.uniform(1e8, 5e10))}
        return base | {
            "sector": "Demo-Sektor", "industry": "Demo-Branche", "country": "Deutschland",
            "market_cap": float(rng.uniform(5e9, 3e12)), "trailing_pe": float(rng.uniform(8, 45)),
            "forward_pe": float(rng.uniform(8, 35)), "price_to_book": float(rng.uniform(0.8, 12)),
            "trailing_eps": float(rng.uniform(0.5, 15)), "return_on_equity": float(rng.uniform(-0.05, 0.4)),
            "gross_margin": float(rng.uniform(0.15, 0.75)), "operating_margin": float(rng.uniform(0.03, 0.4)),
            "profit_margin": float(rng.uniform(0.01, 0.3)), "revenue_growth": float(rng.uniform(-0.1, 0.3)),
            "debt_to_equity": float(rng.uniform(0.1, 2.5)), "analyst_rating": "hold",
            "analyst_mean": float(rng.uniform(1.5, 3.5)), "analyst_count": int(rng.integers(5, 40)),
        }

    def dividends(self, symbol: str) -> pd.Series:
        return pd.Series(dtype=float)
