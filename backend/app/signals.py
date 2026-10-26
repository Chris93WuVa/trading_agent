"""Transparentes, regelbasiertes Kauf-/Halten-/Verkaufen-Signal.

Das Signal ist ein gewichteter Mittelwert einzelner Faktor-Scores im Intervall
[-1, 1]. Jeder Faktor stützt sich auf eine in der Literatur dokumentierte
Anomalie bzw. Regel (Quellen in ``docs/METHODIK.md``). Die Schwellwerte zur
Normierung (z. B. Referenzvolatilität, Referenz-KGV) sind *Heuristiken* dieses
Projekts und nicht aus den Studien übernommen; sie sind hier zentral definiert,
damit sie nachvollziehbar und änderbar bleiben.

Wichtig: Die zitierten Studien belegen Effekte im Querschnitt bzw. in breiten
Portfolios. Für ein Einzelinstrument ist das Signal eine strukturierte
Zusammenfassung, keine Prognose und keine Anlageberatung.
"""

from __future__ import annotations

import math

BUY_THRESHOLD = 0.20
SELL_THRESHOLD = -0.20

# Referenzvolatilität (annualisiert) je Anlageklasse für den Risikofaktor.
REFERENCE_VOL = {
    "aktien": 0.30,
    "etf": 0.18,
    "fonds": 0.18,
    "indizes": 0.18,
    "anleihen": 0.10,
    "waehrungen": 0.08,
    "krypto": 0.70,
    "derivate": 0.30,
}

WEIGHTS = {
    "trend": 0.25,
    "momentum": 0.25,
    "high52": 0.15,
    "risk": 0.15,
    "reversal": 0.10,
    "value": 0.10,
    "quality": 0.10,
}

FACTOR_META = {
    "trend": ("Trend (SMA 200)", "Kurs relativ zum 200-Tage-Durchschnitt",
              ["brock1992", "faber2007"]),
    "momentum": ("Momentum 12-1", "Rendite t-12M bis t-1M, volatilitätsskaliert",
                 ["jegadeesh1993", "moskowitz2012", "barroso2015"]),
    "high52": ("Nähe 52-Wochen-Hoch", "Kurs / 52-Wochen-Hoch",
               ["george2004"]),
    "risk": ("Risiko (Volatilität)", "Annualisierte Volatilität vs. Klassennorm",
             ["ang2006", "frazzini2014", "moreira2017"]),
    "reversal": ("Kurzfrist-Umkehr", "1-Monats-Rendite, nur Einzelaktien",
                 ["jegadeesh1990", "lehmann1990"]),
    "value": ("Bewertung", "Gewinn- und Buchwertrendite (1/KGV, 1/KBV)",
              ["basu1977", "fama1992"]),
    "quality": ("Profitabilität", "Eigenkapitalrendite und Bruttomarge",
                ["novymarx2013", "fama2015"]),
}


def _clip(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _num(value) -> float | None:
    if value is None:
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def factor_scores(metrics: dict, fundamentals: dict | None, asset_class: str) -> dict:
    """Gibt {faktor: (score, rohwert)} für alle berechenbaren Faktoren zurück."""
    tech, risk, rets = metrics["technical"], metrics["risk"], metrics["returns"]
    out: dict[str, tuple[float, float]] = {}
    vol = _num(risk.get("volatility_1y"))

    dist = _num(tech.get("dist_sma200"))
    if dist is not None:
        # 5 % Abstand zum SMA200 ergibt ~0.76; Vorzeichen entspricht der Trendregel.
        out["trend"] = (math.tanh(dist / 0.05), dist)

    mom = _num(tech.get("momentum_12_1"))
    if mom is not None and vol:
        out["momentum"] = (math.tanh(mom / vol), mom)

    ratio = _num(tech.get("high_52w_ratio"))
    if ratio is not None:
        out["high52"] = (_clip((ratio - 0.85) / 0.15), ratio)

    ref = REFERENCE_VOL.get(asset_class)
    if vol is not None and ref:
        out["risk"] = (math.tanh((ref - vol) / ref), vol)

    r1m = _num(rets.get("1m"))
    if asset_class == "aktien" and r1m is not None and vol:
        monthly_vol = vol / math.sqrt(12)
        out["reversal"] = (-math.tanh(r1m / monthly_vol) * 0.5, r1m)

    if asset_class == "aktien" and fundamentals:
        pe, pb = _num(fundamentals.get("trailing_pe")), _num(fundamentals.get("price_to_book"))
        parts = []
        eps = _num(fundamentals.get("trailing_eps"))
        if pe is not None and pe > 0:
            parts.append(math.tanh((1 / pe - 0.05) / 0.04))  # Referenz: KGV 20
        elif eps is not None and eps < 0:
            parts.append(-0.5)  # Verlust: kein sinnvolles KGV
        if pb is not None and pb > 0:
            parts.append(math.tanh((1 / pb - 0.33) / 0.30))  # Referenz: KBV 3
        if parts:
            out["value"] = (sum(parts) / len(parts), pe if pe is not None else float("nan"))

        roe, gm = _num(fundamentals.get("return_on_equity")), _num(fundamentals.get("gross_margin"))
        parts = []
        if roe is not None:
            parts.append(math.tanh((roe - 0.12) / 0.12))
        if gm is not None:
            parts.append(math.tanh((gm - 0.35) / 0.20))
        if parts:
            out["quality"] = (sum(parts) / len(parts), roe if roe is not None else float("nan"))
    return out


def risk_levels(metrics: dict) -> dict | None:
    """Volatilitätsbasierte Orientierungsmarken (2 bzw. 3 ATR) – Heuristik, keine Order-Empfehlung."""
    last, a = _num(metrics.get("last")), _num(metrics["technical"].get("atr14"))
    if not last or not a:
        return None
    return {
        "atr14": a,
        "atr_pct": a / last,
        "stop": last - 2 * a,
        "target": last + 3 * a,
        "method": "Stop = Kurs − 2·ATR(14), Ziel = Kurs + 3·ATR(14) (Chance/Risiko 1,5)",
    }


def build_signal(metrics: dict, fundamentals: dict | None, asset_class: str) -> dict:
    scores = factor_scores(metrics, fundamentals, asset_class)
    if not scores:
        return {"label": "n/a", "score": None, "factors": [], "agreement": None,
                "coverage": 0.0, "notes": ["Zu wenig Kurshistorie für eine Einschätzung."]}

    applicable = {"trend", "momentum", "high52", "risk"}
    if asset_class == "aktien":
        applicable |= {"reversal", "value", "quality"}
    total_w = sum(WEIGHTS[k] for k in scores)
    score = sum(WEIGHTS[k] * s for k, (s, _) in scores.items()) / total_w
    sign = 1 if score > 0 else -1 if score < 0 else 0
    agreement = sum(WEIGHTS[k] for k, (s, _) in scores.items() if s * sign > 0) / total_w
    coverage = total_w / sum(WEIGHTS[k] for k in applicable)

    label = "Kaufen" if score >= BUY_THRESHOLD else "Verkaufen" if score <= SELL_THRESHOLD else "Halten"
    notes = []
    if metrics["observations"] < metrics["periods_per_year"] + 30:
        notes.append("Weniger als ein Jahr Kurshistorie – Trend- und Momentumfaktoren unvollständig.")
    if coverage < 0.75:
        notes.append("Nicht alle Faktoren berechenbar (fehlende Daten); Gewichte wurden renormiert.")

    factors = []
    for key in WEIGHTS:
        title, desc, refs = FACTOR_META[key]
        if key in scores:
            s, raw = scores[key]
            factors.append({"key": key, "title": title, "description": desc, "refs": refs,
                            "weight": WEIGHTS[key] / total_w, "score": round(s, 4),
                            "raw": None if raw != raw else raw})
        elif key in applicable:
            factors.append({"key": key, "title": title, "description": desc, "refs": refs,
                            "weight": 0.0, "score": None, "raw": None})
    return {
        "label": label,
        "score": round(score, 4),
        "thresholds": {"buy": BUY_THRESHOLD, "sell": SELL_THRESHOLD},
        "agreement": round(agreement, 4),
        "coverage": round(coverage, 4),
        "factors": factors,
        "risk_levels": risk_levels(metrics),
        "notes": notes,
    }
