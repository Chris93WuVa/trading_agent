"""Kennzahlen und technische Indikatoren auf Basis täglicher Schlusskurse.

Alle Funktionen sind rein (keine I/O) und arbeiten auf ``pandas.Series`` mit
DatetimeIndex. Konventionen:

* Renditen sind einfache Renditen ``P_t / P_{t-1} - 1``; Volatilität wird aus
  Log-Renditen geschätzt (Stichproben-Standardabweichung, ``ddof=1``).
* Annualisierung mit ``periods_per_year`` (252 Handelstage für Börsenwerte,
  365 für rund um die Uhr gehandelte Kryptowährungen).
* Risikofreier Zins = 0 für Sharpe/Sortino (vereinfachende Annahme; im UI
  ausgewiesen).

Die Quellen zu den einzelnen Verfahren stehen in ``docs/METHODIK.md``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

TRADING_DAYS = 252
CALENDAR_DAYS = 365


def _last(series: pd.Series) -> float | None:
    series = series.dropna()
    if series.empty:
        return None
    value = float(series.iloc[-1])
    return value if math.isfinite(value) else None


def _finite(value: float | None) -> float | None:
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


# --------------------------------------------------------------------------
# Indikatoren
# --------------------------------------------------------------------------

def sma(close: pd.Series, window: int) -> pd.Series:
    return close.rolling(window, min_periods=window).mean()


def ema(close: pd.Series, span: int) -> pd.Series:
    return close.ewm(span=span, adjust=False, min_periods=span).mean()


def rsi(close: pd.Series, window: int = 14) -> pd.Series:
    """Relative Strength Index nach Wilder (1978), Wilder-Glättung alpha = 1/n."""
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / window, adjust=False, min_periods=window).mean()
    avg_loss = loss.ewm(alpha=1 / window, adjust=False, min_periods=window).mean()
    rs = avg_gain / avg_loss
    out = 100 - 100 / (1 + rs)
    # Keine Verluste im Fenster -> RSI = 100 per Definition.
    return out.where(avg_loss != 0, 100.0)


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    """MACD nach Appel (2005): EMA(fast) - EMA(slow), Signallinie EMA(signal)."""
    line = ema(close, fast) - ema(close, slow)
    sig = line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    return pd.DataFrame({"macd": line, "signal": sig, "hist": line - sig})


def bollinger(close: pd.Series, window: int = 20, k: float = 2.0) -> pd.DataFrame:
    """Bollinger-Bänder (Bollinger 2001) mit Populations-Standardabweichung."""
    mid = sma(close, window)
    sd = close.rolling(window, min_periods=window).std(ddof=0)
    upper, lower = mid + k * sd, mid - k * sd
    pct_b = (close - lower) / (upper - lower)
    return pd.DataFrame({"mid": mid, "upper": upper, "lower": lower, "pct_b": pct_b})


def atr(high: pd.Series, low: pd.Series, close: pd.Series, window: int = 14) -> pd.Series:
    """Average True Range nach Wilder (1978)."""
    prev_close = close.shift(1)
    true_range = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    return true_range.ewm(alpha=1 / window, adjust=False, min_periods=window).mean()


# --------------------------------------------------------------------------
# Rendite- und Risikokennzahlen
# --------------------------------------------------------------------------

def period_return(close: pd.Series, periods: int) -> float | None:
    close = close.dropna()
    if len(close) <= periods:
        return None
    return _finite(close.iloc[-1] / close.iloc[-1 - periods] - 1)


def momentum_12_1(close: pd.Series, ppy: int = TRADING_DAYS) -> float | None:
    """12-1-Monats-Momentum (Jegadeesh & Titman 1993): Rendite von t-12M bis t-1M."""
    close = close.dropna()
    month = round(ppy / 12)
    if len(close) <= ppy:
        return None
    return _finite(close.iloc[-1 - month] / close.iloc[-1 - ppy] - 1)


def annualized_volatility(close: pd.Series, ppy: int = TRADING_DAYS, window: int | None = None) -> float | None:
    log_ret = np.log(close.dropna()).diff().dropna()
    if window is not None:
        log_ret = log_ret.iloc[-window:]
    if len(log_ret) < 20:
        return None
    return _finite(log_ret.std(ddof=1) * math.sqrt(ppy))


def drawdown_series(close: pd.Series) -> pd.Series:
    close = close.dropna()
    return close / close.cummax() - 1


def max_drawdown(close: pd.Series) -> float | None:
    dd = drawdown_series(close)
    return _finite(dd.min()) if not dd.empty else None


def cagr(close: pd.Series) -> float | None:
    close = close.dropna()
    if len(close) < 2:
        return None
    years = (close.index[-1] - close.index[0]).days / 365.25
    if years <= 0 or close.iloc[0] <= 0:
        return None
    return _finite((close.iloc[-1] / close.iloc[0]) ** (1 / years) - 1)


def sharpe_ratio(returns: pd.Series, ppy: int = TRADING_DAYS) -> float | None:
    """Sharpe (1966, 1994) mit r_f = 0; ex-post, annualisiert."""
    returns = returns.dropna()
    if len(returns) < 20 or returns.std(ddof=1) == 0:
        return None
    return _finite(returns.mean() / returns.std(ddof=1) * math.sqrt(ppy))


def sortino_ratio(returns: pd.Series, ppy: int = TRADING_DAYS) -> float | None:
    """Sortino & Price (1994) mit Zielrendite 0 (Downside-Deviation über alle Perioden)."""
    returns = returns.dropna()
    if len(returns) < 20:
        return None
    downside = np.sqrt((np.minimum(returns, 0.0) ** 2).mean())
    if downside == 0:
        return None
    return _finite(returns.mean() / downside * math.sqrt(ppy))


def beta(asset_close: pd.Series, bench_close: pd.Series, window: int = TRADING_DAYS) -> float | None:
    """CAPM-Beta (Sharpe 1964) aus täglichen Renditen der letzten ``window`` gemeinsamen Tage."""
    joined = pd.concat([asset_close, bench_close], axis=1, join="inner").dropna()
    joined.columns = ["a", "b"]
    rets = joined.pct_change().dropna().iloc[-window:]
    if len(rets) < 60 or rets["b"].var(ddof=1) == 0:
        return None
    return _finite(rets["a"].cov(rets["b"]) / rets["b"].var(ddof=1))


def high_52w_ratio(close: pd.Series, ppy: int = TRADING_DAYS) -> float | None:
    """Kurs relativ zum 52-Wochen-Hoch (George & Hwang 2004), Wertebereich (0, 1]."""
    window = close.dropna().iloc[-ppy:]
    if len(window) < ppy // 2:
        return None
    return _finite(window.iloc[-1] / window.max())


# --------------------------------------------------------------------------
# Backtest einer einfachen Trendregel
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class BacktestResult:
    start: str
    end: str
    cost_bps: float
    switches: int
    exposure: float
    strategy: dict
    buy_hold: dict
    equity: list  # [[iso_date, strategy, buy_hold], ...] wöchentlich ausgedünnt


def backtest_sma_trend(close: pd.Series, window: int = 200, cost_bps: float = 10.0,
                       ppy: int = TRADING_DAYS) -> BacktestResult | None:
    """Long/Cash-Regel: investiert, wenn der Schlusskurs des Vortags über dem SMA(window) lag.

    Das Signal wird um einen Tag verzögert (kein Look-ahead). Je Positionswechsel
    werden ``cost_bps`` Basispunkte Transaktionskosten abgezogen. Cash rentiert
    mit 0 % (konservative Annahme). Vgl. Brock, Lakonishok & LeBaron (1992),
    Faber (2007).
    """
    close = close.dropna()
    if len(close) < window + 60:
        return None
    rets = close.pct_change()
    in_market = (close > sma(close, window)).astype(float).shift(1)
    valid = sma(close, window).shift(1).notna()
    rets, in_market = rets[valid], in_market[valid]
    switches = in_market.diff().abs().fillna(0.0)
    strat = in_market * rets - switches * cost_bps / 1e4
    eq_s = (1 + strat).cumprod()
    eq_b = (1 + rets).cumprod()

    def stats(r: pd.Series, eq: pd.Series) -> dict:
        return {
            "cagr": cagr(eq),
            "volatility": _finite(r.std(ddof=1) * math.sqrt(ppy)),
            "max_drawdown": max_drawdown(eq),
            "sharpe": sharpe_ratio(r, ppy),
            "total_return": _finite(eq.iloc[-1] - 1),
        }

    thinned = pd.concat([eq_s, eq_b], axis=1).iloc[::5]
    if thinned.index[-1] != eq_s.index[-1]:
        thinned = pd.concat([thinned, pd.concat([eq_s, eq_b], axis=1).iloc[[-1]]])
    return BacktestResult(
        start=close.index[valid.values.argmax()].date().isoformat(),
        end=close.index[-1].date().isoformat(),
        cost_bps=cost_bps,
        switches=int(switches.sum()),
        exposure=_finite(in_market.mean()) or 0.0,
        strategy=stats(strat, eq_s),
        buy_hold=stats(rets, eq_b),
        equity=[[ts.date().isoformat(), round(float(s), 5), round(float(b), 5)]
                for ts, s, b in thinned.itertuples()],
    )


# --------------------------------------------------------------------------
# Gesamtpaket
# --------------------------------------------------------------------------

def compute_metrics(df: pd.DataFrame, ppy: int = TRADING_DAYS,
                    benchmark: pd.Series | None = None) -> dict:
    """Berechnet alle Kennzahlen aus einem OHLCV-DataFrame (Spalten open/high/low/close/volume)."""
    close = df["close"].dropna()
    rets = close.pct_change().dropna()
    month, quarter, half = round(ppy / 12), round(ppy / 4), round(ppy / 2)
    sma50, sma200 = sma(close, 50), sma(close, 200)
    macd_df = macd(close)
    boll = bollinger(close)
    atr14 = atr(df["high"], df["low"], df["close"]) if {"high", "low"} <= set(df) else None
    year = close.iloc[-ppy:]
    last = _last(close)
    sma200_last = _last(sma200)

    ytd = None
    this_year = close[close.index.year == close.index[-1].year]
    prev_year = close[close.index.year < close.index[-1].year]
    if not this_year.empty and not prev_year.empty:
        ytd = _finite(this_year.iloc[-1] / prev_year.iloc[-1] - 1)

    return {
        "last": last,
        "observations": int(len(close)),
        "first_date": close.index[0].date().isoformat() if len(close) else None,
        "last_date": close.index[-1].date().isoformat() if len(close) else None,
        "periods_per_year": ppy,
        "returns": {
            "1m": period_return(close, month),
            "3m": period_return(close, quarter),
            "6m": period_return(close, half),
            "1y": period_return(close, ppy),
            "3y": period_return(close, 3 * ppy),
            "5y": period_return(close, 5 * ppy),
            "ytd": ytd,
            "cagr": cagr(close),
        },
        "risk": {
            "volatility_1y": annualized_volatility(close, ppy, window=ppy),
            "volatility_3m": annualized_volatility(close, ppy, window=quarter),
            "max_drawdown": max_drawdown(close),
            "max_drawdown_1y": max_drawdown(year),
            "current_drawdown": _last(drawdown_series(close)),
            "sharpe_1y": sharpe_ratio(rets.iloc[-ppy:], ppy),
            "sortino_1y": sortino_ratio(rets.iloc[-ppy:], ppy),
            "beta_1y": beta(close, benchmark) if benchmark is not None else None,
        },
        "technical": {
            "sma50": _last(sma50),
            "sma200": sma200_last,
            "dist_sma200": _finite(last / sma200_last - 1) if last and sma200_last else None,
            "golden_cross": (bool(_last(sma50) > sma200_last)
                             if _last(sma50) is not None and sma200_last is not None else None),
            "rsi14": _last(rsi(close)),
            "macd": _last(macd_df["macd"]),
            "macd_signal": _last(macd_df["signal"]),
            "macd_hist": _last(macd_df["hist"]),
            "boll_upper": _last(boll["upper"]),
            "boll_lower": _last(boll["lower"]),
            "boll_pct_b": _last(boll["pct_b"]),
            "atr14": _last(atr14) if atr14 is not None else None,
            "momentum_12_1": momentum_12_1(close, ppy),
            "high_52w": _finite(year.max()) if len(year) else None,
            "low_52w": _finite(year.min()) if len(year) else None,
            "high_52w_ratio": high_52w_ratio(close, ppy),
        },
    }
