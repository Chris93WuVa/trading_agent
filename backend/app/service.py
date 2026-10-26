"""Anwendungslogik: Kurse, Charts, Analyse, Sammlung und Depot."""

from __future__ import annotations

import logging
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pandas as pd

from . import analytics, signals
from .cache import cache
from .providers.base import RANGES, MarketDataProvider, ProviderError
from .universe import (ASSET_CLASSES, BENCHMARK, KNOWN_NAMES, MARKET_STRIP, TOP_LISTS,
                       YIELD_SYMBOLS, classify, periods_per_year)

log = logging.getLogger(__name__)
_pool = ThreadPoolExecutor(max_workers=8)

SCREENS = {
    "most_actives": "Meistgehandelt (USA)",
    "day_gainers": "Tagesgewinner (USA)",
    "day_losers": "Tagesverlierer (USA)",
}

TTL_QUOTE = 60
TTL_INFO = 6 * 3600
TTL_DAILY = 30 * 60
TTL_SEARCH = 3600
TTL_CHART = {"1T": 60, "1W": 300, "1M": 900}


def _clean(value):
    """Ersetzt NaN/Inf rekursiv durch None (JSON-kompatibel)."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    return value


class MarketService:
    def __init__(self, provider: MarketDataProvider) -> None:
        self.p = provider

    # ------------------------------------------------------------------ Kurse
    def _enrich(self, q: dict) -> dict:
        sym = q["symbol"]
        price, prev = q.get("price"), q.get("prev_close")
        change = price - prev if price is not None and prev else None
        return {
            **q,
            "name": KNOWN_NAMES.get(sym) or q.get("name") or sym,
            "asset_class": classify(sym, q.get("quote_type")),
            "change": change,
            "change_pct": change / prev if change is not None and prev else None,
            "is_yield": sym in YIELD_SYMBOLS,
        }

    def quote(self, symbol: str) -> dict | None:
        def load():
            try:
                return self._enrich(self.p.quote(symbol))
            except ProviderError as exc:
                log.warning("%s", exc)
                return None
        return cache.get_or_set(("quote", symbol), TTL_QUOTE, load)

    def quotes(self, symbols: list[str]) -> dict[str, dict | None]:
        unique = list(dict.fromkeys(symbols))
        return dict(zip(unique, _pool.map(self.quote, unique), strict=True))

    def _list_with_quotes(self, items: list[tuple[str, str]]) -> list[dict]:
        quotes = self.quotes([s for s, _ in items])
        out = []
        for sym, name in items:
            q = quotes.get(sym)
            row = dict(q) if q else {"symbol": sym, "price": None, "change_pct": None,
                                     "asset_class": classify(sym, None), "unavailable": True}
            row["name"] = name or row.get("name") or sym
            out.append(row)
        return out

    def market_strip(self) -> list[dict]:
        return self._list_with_quotes(MARKET_STRIP)

    def top(self, asset_class: str, screen: str | None = None) -> dict:
        if asset_class not in ASSET_CLASSES:
            raise KeyError(asset_class)
        screens = [{"key": "kuratiert", "title": "Auswahl"}]
        if asset_class == "aktien" and not self.p.is_demo:
            screens += [{"key": k, "title": v} for k, v in SCREENS.items()]
        if screen and screen in SCREENS and asset_class == "aktien":
            def load():
                try:
                    return [self._enrich(q) for q in self.p.screen(screen, 25) if q.get("symbol")]
                except ProviderError as exc:
                    log.warning("%s", exc)
                    return []
            items = cache.get_or_set(("screen", screen), 300, load)
        else:
            screen = "kuratiert"
            items = self._list_with_quotes(TOP_LISTS[asset_class])
        return {"asset_class": asset_class, "title": ASSET_CLASSES[asset_class],
                "screen": screen, "screens": screens, "items": _clean(items)}

    def search(self, query: str) -> list[dict]:
        query = query.strip()
        if len(query) < 1:
            return []

        def load():
            try:
                hits = self.p.search(query, 15)
            except ProviderError as exc:
                log.warning("%s", exc)
                hits = []
            q = query.lower()
            local = [{"symbol": s, "name": n, "exchange": None, "quote_type": None}
                     for s, n in KNOWN_NAMES.items() if q in s.lower() or q in n.lower()]
            seen, out = set(), []
            for h in local[:5] + hits:
                if h["symbol"] in seen:
                    continue
                seen.add(h["symbol"])
                cls = classify(h["symbol"], h.get("quote_type"))
                out.append({**h, "asset_class": cls, "asset_class_title": ASSET_CLASSES[cls]})
            return out[:15]
        return cache.get_or_set(("search", query.lower()), TTL_SEARCH, load)

    # ----------------------------------------------------------------- Charts
    def _history(self, symbol: str, period: str, interval: str) -> pd.DataFrame:
        ttl = TTL_DAILY if interval in {"1d", "1wk", "1mo"} else 120
        return cache.get_or_set(("hist", symbol, period, interval), ttl,
                                lambda: self.p.history(symbol, period, interval))

    def chart(self, symbol: str, rng: str) -> dict:
        if rng not in RANGES:
            raise KeyError(rng)
        period, interval = RANGES[rng]
        df = self._history(symbol, period, interval)
        close = df["close"]
        quote = self.quote(symbol) or {}
        baseline = None
        if rng == "1T":
            last_day = close.index[-1].date()
            close = close[[ts.date() == last_day for ts in close.index]]
            baseline = quote.get("prev_close")
        if baseline is None and len(close):
            baseline = float(close.iloc[0])
        points = [[int(ts.timestamp() * 1000), round(float(v), 6)] for ts, v in close.items()]
        return _clean({"symbol": symbol, "range": rng, "interval": interval,
                       "currency": quote.get("currency"), "baseline": baseline,
                       "intraday": interval.endswith("m") or interval.endswith("h"),
                       "points": points})

    # ---------------------------------------------------------------- Analyse
    def info(self, symbol: str) -> dict:
        def load():
            try:
                return self.p.info(symbol)
            except ProviderError as exc:
                log.warning("%s", exc)
                return {}
        return cache.get_or_set(("info", symbol), TTL_INFO, load)

    def _dividend_yield(self, symbol: str, price: float | None) -> float | None:
        """Trailing-12-Monats-Dividendenrendite aus den tatsächlichen Ausschüttungen."""
        if not price:
            return None
        divs = cache.get_or_set(("divs", symbol), TTL_INFO, lambda: self.p.dividends(symbol))
        if divs is None or divs.empty:
            return None
        cutoff = divs.index.max() - timedelta(days=365)
        if divs.index.max() < pd.Timestamp.now(tz=divs.index.tz) - timedelta(days=400):
            return None  # keine Ausschüttung mehr in den letzten ~13 Monaten
        return float(divs[divs.index > cutoff].sum()) / price

    def instrument(self, symbol: str) -> dict:
        quote = self.quote(symbol)
        if quote is None:
            raise ProviderError(f"Unbekanntes oder nicht verfügbares Symbol: {symbol}")
        info = self.info(symbol)
        cls = classify(symbol, info.get("quote_type") or quote.get("quote_type"))
        quote = {**quote, "asset_class": cls,
                 "name": KNOWN_NAMES.get(symbol) or info.get("name") or quote.get("name")}
        fundamentals = dict(info)
        fundamentals["dividend_yield_ttm"] = (None if cls in {"waehrungen", "krypto", "derivate", "indizes"}
                                              else self._dividend_yield(symbol, quote.get("price")))
        return _clean({"quote": quote, "asset_class_title": ASSET_CLASSES[cls],
                       "fundamentals": fundamentals, "has_options": cls in {"aktien", "etf"}
                       and "." not in symbol and not self.p.is_demo,
                       "provider": self.p.name, "delay_note": self.p.delay_note})

    def analysis(self, symbol: str) -> dict:
        def load():
            df = self._history(symbol, "10y", "1d")
            quote = self.quote(symbol) or {}
            info = self.info(symbol)
            cls = classify(symbol, info.get("quote_type") or quote.get("quote_type"))
            ppy = periods_per_year(cls)
            bench = None
            if cls in {"aktien", "etf", "fonds"} and symbol != BENCHMARK:
                try:
                    bench = self._history(BENCHMARK, "10y", "1d")["close"]
                except ProviderError:
                    bench = None
            metrics = analytics.compute_metrics(df, ppy, bench)
            if symbol in YIELD_SYMBOLS:
                signal = {"label": "n/a", "score": None, "factors": [], "agreement": None,
                          "coverage": 0.0, "notes": ["Renditeindex (Prozentpunkte) – kein handelbarer "
                                                     "Kurs, daher kein Signal. Steigende Renditen "
                                                     "bedeuten fallende Anleihekurse."]}
                backtest = None
            else:
                signal = signals.build_signal(metrics, info, cls)
                bt = analytics.backtest_sma_trend(df["close"], ppy=ppy)
                backtest = bt.__dict__ if bt else None
            return _clean({"symbol": symbol, "asset_class": cls, "metrics": metrics,
                           "signal": signal, "backtest": backtest,
                           "assumptions": {"risk_free_rate": 0.0, "adjusted_prices": True,
                                           "benchmark": BENCHMARK if bench is not None else None,
                                           "periods_per_year": ppy},
                           "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        return cache.get_or_set(("analysis", symbol), TTL_DAILY, load)

    def options(self, symbol: str, expiry: str | None) -> dict:
        return _clean(cache.get_or_set(("options", symbol, expiry), 600,
                                       lambda: self.p.options(symbol, expiry)))

    # ------------------------------------------------------------------ Depot
    def fx_to_eur(self, currency: str | None) -> float | None:
        """Umrechnungsfaktor Währung -> EUR (aktueller Kurs). GBp/ZAc sind Pence/Cent."""
        if not currency or currency == "EUR":
            return 1.0
        factor = 1.0
        if currency in {"GBp", "GBX", "ZAc", "ILA"}:
            factor, currency = 0.01, {"GBp": "GBP", "GBX": "GBP", "ZAc": "ZAR", "ILA": "ILS"}[currency]
        q = self.quote(f"{currency}EUR=X")
        return q["price"] * factor if q and q.get("price") else None

    def portfolio(self, positions: list[dict]) -> dict:
        by_symbol: dict[str, list[dict]] = {}
        for pos in positions:
            by_symbol.setdefault(pos["symbol"], []).append(pos)
        quotes = self.quotes(list(by_symbol))
        holdings, total_value, total_cost, day_change = [], 0.0, 0.0, 0.0
        complete = True
        for sym, lots in by_symbol.items():
            q = quotes.get(sym)
            qty = sum(lot["quantity"] for lot in lots)
            cost = sum(lot["quantity"] * lot["price"] for lot in lots)
            fx = self.fx_to_eur(q.get("currency")) if q else None
            price = q.get("price") if q else None
            value = qty * price if price is not None else None
            row = {"symbol": sym, "name": (q or {}).get("name") or KNOWN_NAMES.get(sym, sym),
                   "asset_class": (q or {}).get("asset_class") or classify(sym, None),
                   "currency": (q or {}).get("currency"), "quantity": qty,
                   "avg_price": cost / qty if qty else None, "price": price,
                   "change_pct": (q or {}).get("change_pct"), "value": value,
                   "pnl": value - cost if value is not None else None,
                   "pnl_pct": value / cost - 1 if value is not None and cost else None,
                   "fx_to_eur": fx, "lots": lots}
            if value is not None and fx is not None:
                row["value_eur"] = value * fx
                total_value += value * fx
                total_cost += cost * fx
                if q.get("change") is not None:
                    day_change += qty * q["change"] * fx
            else:
                row["value_eur"] = None
                complete = False
            holdings.append(row)
        for row in holdings:
            row["weight"] = row["value_eur"] / total_value if row["value_eur"] and total_value else None
        holdings.sort(key=lambda r: r["value_eur"] or 0, reverse=True)
        prev_value = total_value - day_change
        return _clean({
            "value_eur": total_value, "cost_eur": total_cost,
            "pnl_eur": total_value - total_cost,
            "pnl_pct": total_value / total_cost - 1 if total_cost else None,
            "day_change_eur": day_change,
            "day_change_pct": day_change / prev_value if prev_value else None,
            "complete": complete, "holdings": holdings,
            "allocation": self._allocation(holdings, total_value),
            "note": "EUR-Werte mit aktuellem Devisenkurs; Währungseffekte seit Kauf sind nicht separat ausgewiesen.",
        })

    @staticmethod
    def _allocation(holdings: list[dict], total: float) -> list[dict]:
        buckets: dict[str, float] = {}
        for h in holdings:
            if h["value_eur"]:
                buckets[h["asset_class"]] = buckets.get(h["asset_class"], 0.0) + h["value_eur"]
        return [{"asset_class": k, "title": ASSET_CLASSES.get(k, k), "value_eur": v,
                 "weight": v / total if total else None}
                for k, v in sorted(buckets.items(), key=lambda kv: -kv[1])]

    def portfolio_chart(self, positions: list[dict], rng: str) -> dict:
        """Wertverlauf des *aktuellen* Bestands in EUR (historische Kurse und Devisenkurse)."""
        if rng not in RANGES:
            raise KeyError(rng)
        period, interval = RANGES[rng]
        qty: dict[str, float] = {}
        for pos in positions:
            qty[pos["symbol"]] = qty.get(pos["symbol"], 0.0) + pos["quantity"]
        if not qty:
            return {"range": rng, "points": [], "baseline": None, "currency": "EUR"}
        series = []
        for sym, n in qty.items():
            try:
                close = self._history(sym, period, interval)["close"]
            except ProviderError:
                continue
            ccy = (self.quote(sym) or {}).get("currency")
            factor = 0.01 if ccy in {"GBp", "GBX", "ZAc", "ILA"} else 1.0
            base_ccy = {"GBp": "GBP", "GBX": "GBP", "ZAc": "ZAR", "ILA": "ILS"}.get(ccy, ccy)
            if base_ccy and base_ccy != "EUR":
                try:
                    fx = self._history(f"{base_ccy}EUR=X", period, interval)["close"]
                    fx = fx.reindex(close.index.union(fx.index)).ffill().reindex(close.index)
                except ProviderError:
                    rate = self.fx_to_eur(ccy)
                    if rate is None:
                        continue
                    fx, factor = pd.Series(rate, index=close.index), 1.0
                close = close * fx * factor
            series.append((close * n).rename(sym))
        if not series:
            return {"range": rng, "points": [], "baseline": None, "currency": "EUR"}
        frame = pd.concat(series, axis=1).sort_index().ffill().dropna()
        total = frame.sum(axis=1)
        if rng == "1T" and len(total):
            last_day = total.index[-1].date()
            total = total[[ts.date() == last_day for ts in total.index]]
        points = [[int(ts.timestamp() * 1000), round(float(v), 2)] for ts, v in total.items()]
        return _clean({"range": rng, "currency": "EUR", "intraday": not interval.endswith(("d", "k", "o")),
                       "baseline": points[0][1] if points else None, "points": points})
