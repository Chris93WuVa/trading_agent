"""Prüft Kennzahlen gegen analytisch bekannte Werte."""

import math

import numpy as np
import pandas as pd
import pytest

from app import analytics, signals


def series(values, freq="B"):
    return pd.Series(values, index=pd.date_range("2020-01-01", periods=len(values), freq=freq, tz="UTC"))


def test_rsi_monotonic_rise_is_100_and_fall_is_0():
    assert analytics.rsi(series(np.arange(1, 60, dtype=float))).iloc[-1] == pytest.approx(100)
    assert analytics.rsi(series(np.arange(60, 1, -1, dtype=float))).iloc[-1] == pytest.approx(0)


def test_rsi_alternation_matches_wilder_steady_state():
    # +1/-1 im Wechsel, letzter Schritt abwärts: im Gleichgewicht gilt RS = 1 - 1/14,
    # also RSI = 100 * 13/27 (Wilder-Glättung alpha = 1/14).
    vals = 100 + np.tile([1.0, -1.0], 200).cumsum()
    assert analytics.rsi(series(vals)).iloc[-1] == pytest.approx(100 * 13 / 27, abs=1e-6)


def test_volatility_recovers_known_sigma():
    rng = np.random.default_rng(0)
    sigma = 0.2
    log_ret = rng.normal(0, sigma / math.sqrt(252), 252 * 20)
    close = series(100 * np.exp(np.cumsum(log_ret)))
    est = analytics.annualized_volatility(close)
    # Standardfehler der Std-Schätzung ~ sigma / sqrt(2n) ≈ 0.0019
    assert est == pytest.approx(sigma, abs=0.01)


def test_max_drawdown_and_cagr():
    close = series([100, 120, 60, 90, 150])
    assert analytics.max_drawdown(close) == pytest.approx(-0.5)
    yearly = pd.Series([100.0, 110.0, 121.0],
                       index=pd.to_datetime(["2020-01-01", "2021-01-01", "2022-01-01"], utc=True))
    assert analytics.cagr(yearly) == pytest.approx(0.10, abs=1e-3)


def test_momentum_12_1_skips_last_month():
    vals = np.ones(300) * 100.0
    vals[-253] = 50.0   # Kurs vor 12 Monaten
    vals[-22] = 100.0   # Kurs vor 1 Monat
    vals[-1] = 10.0     # letzter Monat darf keine Rolle spielen
    assert analytics.momentum_12_1(series(vals)) == pytest.approx(1.0)


def test_beta_of_scaled_series_is_scale():
    rng = np.random.default_rng(1)
    bench_ret = rng.normal(0, 0.01, 400)
    bench = series(100 * np.cumprod(1 + bench_ret))
    asset = series(100 * np.cumprod(1 + 2 * bench_ret))
    assert analytics.beta(asset, bench) == pytest.approx(2.0, rel=1e-6)


def test_backtest_has_no_lookahead():
    # Ein einzelner Kurssprung am Tag des Signalwechsels darf nicht mitgenommen werden.
    vals = np.r_[np.full(260, 100.0), 200.0, np.full(80, 200.0)]
    bt = analytics.backtest_sma_trend(series(vals), cost_bps=0)
    assert bt.buy_hold["total_return"] == pytest.approx(1.0)
    assert bt.strategy["total_return"] == pytest.approx(0.0, abs=1e-12)


def test_signal_buy_for_strong_uptrend_and_sell_for_downtrend():
    rng = np.random.default_rng(2)
    up = series(100 * np.exp(np.cumsum(rng.normal(0.002, 0.008, 600))))
    down = series(100 * np.exp(np.cumsum(rng.normal(-0.002, 0.008, 600))))
    for close, label in [(up, "Kaufen"), (down, "Verkaufen")]:
        df = pd.DataFrame({"open": close, "high": close * 1.01, "low": close * 0.99, "close": close, "volume": 1.0})
        sig = signals.build_signal(analytics.compute_metrics(df), None, "etf")
        assert sig["label"] == label
        assert -1 <= sig["score"] <= 1
        assert sum(f["weight"] for f in sig["factors"]) == pytest.approx(1.0)


def test_signal_short_history_has_note():
    close = series(np.linspace(100, 120, 120))
    df = pd.DataFrame({"open": close, "high": close, "low": close, "close": close, "volume": 1.0})
    sig = signals.build_signal(analytics.compute_metrics(df), None, "etf")
    assert any("Kurshistorie" in n for n in sig["notes"])
