"""Yahoo-Finance-Provider über ``yfinance``.

Yahoo stellt keine offizielle API bereit; ``yfinance`` nutzt die öffentlichen
Endpunkte der Website. Kurse sind je nach Börse 0–20 Minuten verzögert. Die
Nutzungsbedingungen von Yahoo erlauben nur private Nutzung.
"""

from __future__ import annotations

import math

import pandas as pd
import yfinance as yf

from .base import OHLCV, MarketDataProvider, ProviderError


def _num(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _records(df: pd.DataFrame | None, cols: list[str]) -> list[dict]:
    if df is None or df.empty:
        return []
    df = df[[c for c in cols if c in df.columns]].copy()
    df = df.astype(object).where(pd.notna(df), None)
    return df.to_dict(orient="records")


class YahooProvider(MarketDataProvider):
    name = "Yahoo Finance"
    delay_note = "Kurse je nach Börse bis zu 20 Minuten verzögert"

    def search(self, query: str, limit: int = 12) -> list[dict]:
        try:
            res = yf.Search(query, max_results=limit, news_count=0, lists_count=0,
                            enable_fuzzy_query=True, raise_errors=False)
        except Exception as exc:  # noqa: BLE001 - Netzwerkfehler sauber weiterreichen
            raise ProviderError(f"Suche fehlgeschlagen: {exc}") from exc
        out = []
        for q in res.quotes or []:
            if not q.get("symbol"):
                continue
            out.append({
                "symbol": q["symbol"],
                "name": q.get("longname") or q.get("shortname") or q["symbol"],
                "exchange": q.get("exchDisp") or q.get("exchange"),
                "quote_type": q.get("quoteType"),
            })
        return out

    def quote(self, symbol: str) -> dict:
        try:
            t = yf.Ticker(symbol)
            hist = t.history(period="5d", interval="1d", auto_adjust=False)
            meta = t.history_metadata or {}
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"Kurs für {symbol} nicht verfügbar: {exc}") from exc
        closes = hist["Close"].dropna() if not hist.empty else pd.Series(dtype=float)
        price = _num(meta.get("regularMarketPrice")) or (_num(closes.iloc[-1]) if len(closes) else None)
        if price is None:
            raise ProviderError(f"Kein Kurs für {symbol}")
        prev = _num(closes.iloc[-2]) if len(closes) >= 2 else _num(meta.get("chartPreviousClose"))
        return {
            "symbol": symbol,
            "name": meta.get("longName") or meta.get("shortName") or symbol,
            "price": price,
            "prev_close": prev,
            "currency": meta.get("currency"),
            "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
            "quote_type": meta.get("instrumentType"),
            "time": meta.get("regularMarketTime"),
        }

    def history(self, symbol: str, period: str, interval: str, adjusted: bool = True) -> pd.DataFrame:
        try:
            df = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=adjusted)
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"Historie für {symbol} nicht verfügbar: {exc}") from exc
        if df is None or df.empty:
            raise ProviderError(f"Keine Historie für {symbol}")
        df = df.rename(columns=str.lower)
        for col in OHLCV:
            if col not in df:
                df[col] = float("nan")
        return df[OHLCV].dropna(subset=["close"])

    def info(self, symbol: str) -> dict:
        try:
            i = yf.Ticker(symbol).info or {}
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"Stammdaten für {symbol} nicht verfügbar: {exc}") from exc
        d2e = _num(i.get("debtToEquity"))
        return {
            "name": i.get("longName") or i.get("shortName"),
            "quote_type": i.get("quoteType"),
            "currency": i.get("currency"),
            "exchange": i.get("fullExchangeName") or i.get("exchange"),
            "sector": i.get("sector"),
            "industry": i.get("industry"),
            "country": i.get("country"),
            "website": i.get("website"),
            "summary": i.get("longBusinessSummary"),
            "employees": i.get("fullTimeEmployees"),
            "isin": None,
            "market_cap": _num(i.get("marketCap")),
            "enterprise_value": _num(i.get("enterpriseValue")),
            "trailing_pe": _num(i.get("trailingPE")),
            "forward_pe": _num(i.get("forwardPE")),
            "price_to_book": _num(i.get("priceToBook")),
            "price_to_sales": _num(i.get("priceToSalesTrailing12Months")),
            "ev_to_ebitda": _num(i.get("enterpriseToEbitda")),
            "trailing_eps": _num(i.get("trailingEps")),
            "return_on_equity": _num(i.get("returnOnEquity")),
            "return_on_assets": _num(i.get("returnOnAssets")),
            "gross_margin": _num(i.get("grossMargins")),
            "operating_margin": _num(i.get("operatingMargins")),
            "profit_margin": _num(i.get("profitMargins")),
            "revenue_growth": _num(i.get("revenueGrowth")),
            "earnings_growth": _num(i.get("earningsGrowth")),
            # Yahoo liefert Verschuldungsgrad in Prozent (150 = 1,5x)
            "debt_to_equity": d2e / 100 if d2e is not None else None,
            "payout_ratio": _num(i.get("payoutRatio")),
            "beta_yahoo": _num(i.get("beta")),
            "shares_outstanding": _num(i.get("sharesOutstanding")),
            "analyst_rating": i.get("recommendationKey"),
            "analyst_mean": _num(i.get("recommendationMean")),
            "analyst_count": i.get("numberOfAnalystOpinions"),
            "target_mean": _num(i.get("targetMeanPrice")),
            "target_low": _num(i.get("targetLowPrice")),
            "target_high": _num(i.get("targetHighPrice")),
            "total_assets": _num(i.get("totalAssets")),
            # Yahoo führt die Kostenquote in Prozentpunkten
            "expense_ratio_pct": _num(i.get("netExpenseRatio")),
            "fund_family": i.get("fundFamily"),
            "category": i.get("category"),
        }

    def dividends(self, symbol: str) -> pd.Series:
        try:
            return yf.Ticker(symbol).dividends
        except Exception:  # noqa: BLE001 - Dividenden sind optional
            return pd.Series(dtype=float)

    def options(self, symbol: str, expiry: str | None = None) -> dict:
        try:
            t = yf.Ticker(symbol)
            expiries = list(t.options or [])
            if not expiries:
                return {"expiries": [], "expiry": None, "calls": [], "puts": []}
            expiry = expiry if expiry in expiries else expiries[0]
            chain = t.option_chain(expiry)
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"Optionskette für {symbol} nicht verfügbar: {exc}") from exc
        cols = ["contractSymbol", "strike", "lastPrice", "bid", "ask", "volume",
                "openInterest", "impliedVolatility", "inTheMoney"]
        return {"expiries": expiries, "expiry": expiry,
                "calls": _records(chain.calls, cols), "puts": _records(chain.puts, cols)}

    def screen(self, name: str, count: int = 25) -> list[dict]:
        try:
            res = yf.screen(name, count=count)
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"Screener {name} nicht verfügbar: {exc}") from exc
        out = []
        for q in (res or {}).get("quotes", []):
            price, chg = _num(q.get("regularMarketPrice")), _num(q.get("regularMarketChange"))
            out.append({
                "symbol": q.get("symbol"),
                "name": q.get("longName") or q.get("shortName") or q.get("symbol"),
                "price": price,
                "prev_close": price - chg if price is not None and chg is not None else None,
                "currency": q.get("currency"),
                "exchange": q.get("fullExchangeName"),
                "quote_type": q.get("quoteType"),
                "time": q.get("regularMarketTime"),
            })
        return out
