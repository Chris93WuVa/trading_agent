# Methodik

Trading-Board berechnet alle Kennzahlen selbst aus täglichen, um Dividenden und Splits
bereinigten Schlusskursen (bis zu zehn Jahre, Quelle Yahoo Finance). Code:
[`backend/app/analytics.py`](../backend/app/analytics.py) (Kennzahlen) und
[`backend/app/signals.py`](../backend/app/signals.py) (Einschätzung).

## Kennzahlen

| Kennzahl | Definition | Quelle |
| --- | --- | --- |
| Rendite | einfache Rendite `P_t / P_{t-k} − 1`; p. a. als CAGR | – |
| Volatilität | Stichproben-Std. der täglichen Log-Renditen × √252 (Krypto √365) | – |
| Max. Drawdown | min(P_t / max_{s≤t} P_s − 1) | – |
| Sharpe-Ratio | Mittelwert / Std. der Tagesrenditen × √252, r_f = 0 | Sharpe (1966, 1994) |
| Sortino-Ratio | Mittelwert / Downside-Deviation (Ziel 0) × √252 | Sortino & Price (1994) |
| Beta | Cov(r_i, r_m) / Var(r_m), 252 Tage, Markt = S&P 500 | Sharpe (1964) |
| RSI (14) | Wilder-Glättung α = 1/14 | Wilder (1978) |
| ATR (14) | Wilder-geglättete True Range | Wilder (1978) |
| MACD | EMA12 − EMA26, Signal EMA9 | Appel (2005) |
| Bollinger %B | Lage im Band SMA20 ± 2σ | Bollinger (2001) |
| Momentum 12-1 | P_{t−21} / P_{t−252} − 1 | Jegadeesh & Titman (1993) |
| Dividendenrendite | Summe der Ausschüttungen der letzten 12 Monate / Kurs | – |

Vereinfachende Annahmen: risikofreier Zins 0; Euro-Werte im Depot mit dem aktuellen
Devisenkurs (Währungseffekte seit Kauf werden nicht separat ausgewiesen).

## Einschätzung Kaufen / Halten / Verkaufen

Gewichteter Mittelwert von Faktor-Scores in [−1, 1]. Fehlt ein Faktor (z. B. keine
Fundamentaldaten), werden die übrigen Gewichte renormiert; die **Datenabdeckung** zeigt
den Anteil der verfügbaren Gewichte. **Konsistenz** ist der gewichtete Anteil der
Faktoren, die in Richtung des Gesamtscores zeigen.

| Faktor | Gewicht | Normierung (Heuristik dieses Projekts) | Literatur |
| --- | ---: | --- | --- |
| Trend | 25 % | tanh(Abstand zum SMA200 / 5 %) | Brock et al. (1992); Faber (2007) |
| Momentum 12-1 | 25 % | tanh(Momentum / Jahresvolatilität) | Jegadeesh & Titman (1993); Moskowitz et al. (2012); Barroso & Santa-Clara (2015) |
| Nähe 52W-Hoch | 15 % | (Kurs/Hoch − 0,85) / 0,15, begrenzt auf ±1 | George & Hwang (2004) |
| Risiko | 15 % | tanh((σ_ref − σ) / σ_ref), σ_ref je Klasse | Ang et al. (2006); Frazzini & Pedersen (2014); Moreira & Muir (2017) |
| Kurzfrist-Umkehr* | 10 % | −0,5 · tanh(r_1M / σ_monatlich) | Jegadeesh (1990); Lehmann (1990) |
| Bewertung* | 10 % | Mittel aus tanh((1/KGV − 5 %) / 4 %) und tanh((1/KBV − 0,33) / 0,30) | Basu (1977); Fama & French (1992) |
| Profitabilität* | 10 % | Mittel aus tanh((ROE − 12 %) / 12 %) und tanh((Bruttomarge − 35 %) / 20 %) | Novy-Marx (2013); Fama & French (2015) |

\* nur Einzelaktien. Referenzvolatilität σ_ref: Aktien 30 %, ETFs/Fonds/Indizes 18 %,
Anleihen 10 %, Währungen 8 %, Krypto 70 %, Derivate 30 %.

Schwellen: **Kaufen** ab Score ≥ +0,20, **Verkaufen** ab ≤ −0,20, dazwischen **Halten**.

Für Renditeindizes (^IRX, ^FVX, ^TNX, ^TYX) wird kein Signal berechnet, da sie keinen
handelbaren Kurs darstellen.

Stop-/Zielmarken: Kurs − 2·ATR(14) bzw. Kurs + 3·ATR(14). Das ist eine verbreitete
Praxisheuristik auf Basis von Wilders ATR, kein empirisch belegter Optimalwert.

## Trendregel im Rückblick

Long/Cash-Regel: investiert am Tag *t*, wenn der Schlusskurs von *t−1* über dem
SMA200 von *t−1* lag (kein Look-ahead). 10 Basispunkte Kosten je Wechsel, Cash
rentiert mit 0 %. Ergebnisse sind *in-sample* und für einen Einzelwert; sie dienen
der Veranschaulichung, nicht der Validierung des Gesamtsignals.

## Grenzen

* Die zitierten Effekte wurden im Querschnitt bzw. in diversifizierten Portfolios
  gemessen. Für ein Einzelinstrument ist das Signal eine strukturierte Zusammenfassung
  – keine Prognose und keine Anlageberatung.
* Anomalien schwächen sich nach Veröffentlichung ab (McLean & Pontiff 2016); viele
  publizierte Faktoren halten strengeren Signifikanzschwellen nicht stand
  (Harvey, Liu & Zhu 2016).
* Rückblickende Erfolge technischer Regeln sind anfällig für Data-Snooping
  (Sullivan, Timmermann & White 1999; Park & Irwin 2007).
* Die Normierungsschwellen sind nicht aus den Studien übernommen, sondern bewusst
  einfach gewählte Heuristiken. Ein systematischer Out-of-Sample-Test des Gesamtscores
  über ein breites Universum steht aus.
* Der Analystenkonsens (Yahoo Finance) wird nur angezeigt und fließt nicht ein.

## Literatur

1. Brock, W., Lakonishok, J. & LeBaron, B. (1992). Simple Technical Trading Rules and the Stochastic Properties of Stock Returns. *The Journal of Finance*, 47(5), 1731–1764. https://doi.org/10.1111/j.1540-6261.1992.tb04681.x
2. Faber, M. T. (2007). A Quantitative Approach to Tactical Asset Allocation. *The Journal of Wealth Management*, 9(4), 69–79. https://doi.org/10.3905/jwm.2007.674809
3. Sullivan, R., Timmermann, A. & White, H. (1999). Data-Snooping, Technical Trading Rule Performance, and the Bootstrap. *The Journal of Finance*, 54(5), 1647–1691. https://doi.org/10.1111/0022-1082.00163
4. Park, C.-H. & Irwin, S. H. (2007). What Do We Know About the Profitability of Technical Analysis? *Journal of Economic Surveys*, 21(4), 786–826. https://doi.org/10.1111/j.1467-6419.2007.00519.x
5. Jegadeesh, N. & Titman, S. (1993). Returns to Buying Winners and Selling Losers: Implications for Stock Market Efficiency. *The Journal of Finance*, 48(1), 65–91. https://doi.org/10.1111/j.1540-6261.1993.tb04702.x
6. Moskowitz, T. J., Ooi, Y. H. & Pedersen, L. H. (2012). Time Series Momentum. *Journal of Financial Economics*, 104(2), 228–250. https://doi.org/10.1016/j.jfineco.2011.11.003
7. Barroso, P. & Santa-Clara, P. (2015). Momentum Has Its Moments. *Journal of Financial Economics*, 116(1), 111–120. https://doi.org/10.1016/j.jfineco.2014.11.010
8. George, T. J. & Hwang, C.-Y. (2004). The 52-Week High and Momentum Investing. *The Journal of Finance*, 59(5), 2145–2176. https://doi.org/10.1111/j.1540-6261.2004.00695.x
9. Ang, A., Hodrick, R. J., Xing, Y. & Zhang, X. (2006). The Cross-Section of Volatility and Expected Returns. *The Journal of Finance*, 61(1), 259–299. https://doi.org/10.1111/j.1540-6261.2006.00836.x
10. Frazzini, A. & Pedersen, L. H. (2014). Betting Against Beta. *Journal of Financial Economics*, 111(1), 1–25. https://doi.org/10.1016/j.jfineco.2013.10.005
11. Moreira, A. & Muir, T. (2017). Volatility-Managed Portfolios. *The Journal of Finance*, 72(4), 1611–1644. https://doi.org/10.1111/jofi.12513
12. Jegadeesh, N. (1990). Evidence of Predictable Behavior of Security Returns. *The Journal of Finance*, 45(3), 881–898. https://doi.org/10.1111/j.1540-6261.1990.tb05110.x
13. Lehmann, B. N. (1990). Fads, Martingales, and Market Efficiency. *The Quarterly Journal of Economics*, 105(1), 1–28. https://doi.org/10.2307/2937816
14. Basu, S. (1977). Investment Performance of Common Stocks in Relation to Their Price-Earnings Ratios: A Test of the Efficient Market Hypothesis. *The Journal of Finance*, 32(3), 663–682. https://doi.org/10.1111/j.1540-6261.1977.tb01979.x
15. Fama, E. F. & French, K. R. (1992). The Cross-Section of Expected Stock Returns. *The Journal of Finance*, 47(2), 427–465. https://doi.org/10.1111/j.1540-6261.1992.tb04398.x
16. Novy-Marx, R. (2013). The Other Side of Value: The Gross Profitability Premium. *Journal of Financial Economics*, 108(1), 1–28. https://doi.org/10.1016/j.jfineco.2013.01.003
17. Fama, E. F. & French, K. R. (2015). A Five-Factor Asset Pricing Model. *Journal of Financial Economics*, 116(1), 1–22. https://doi.org/10.1016/j.jfineco.2014.10.010
18. McLean, R. D. & Pontiff, J. (2016). Does Academic Research Destroy Stock Return Predictability? *The Journal of Finance*, 71(1), 5–32. https://doi.org/10.1111/jofi.12365
19. Harvey, C. R., Liu, Y. & Zhu, H. (2016). … and the Cross-Section of Expected Returns. *The Review of Financial Studies*, 29(1), 5–68. https://doi.org/10.1093/rfs/hhv059
20. Wilder, J. W. (1978). *New Concepts in Technical Trading Systems*. Greensboro, NC: Trend Research.
21. Appel, G. (2005). *Technical Analysis: Power Tools for Active Investors*. Upper Saddle River, NJ: FT Prentice Hall.
22. Bollinger, J. (2001). *Bollinger on Bollinger Bands*. New York: McGraw-Hill.
23. Sharpe, W. F. (1964). Capital Asset Prices: A Theory of Market Equilibrium under Conditions of Risk. *The Journal of Finance*, 19(3), 425–442. https://doi.org/10.1111/j.1540-6261.1964.tb02865.x
24. Sharpe, W. F. (1994). The Sharpe Ratio. *The Journal of Portfolio Management*, 21(1), 49–58. https://doi.org/10.3905/jpm.1994.409501
25. Sortino, F. A. & Price, L. N. (1994). Performance Measurement in a Downside Risk Framework. *The Journal of Investing*, 3(3), 59–64. https://doi.org/10.3905/joi.3.3.59
