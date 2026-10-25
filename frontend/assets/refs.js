// Literatur zu Kennzahlen und Signalfaktoren (identisch mit docs/METHODIK.md).

export const REFS = {
  brock1992: { text: 'Brock, W., Lakonishok, J. & LeBaron, B. (1992). Simple Technical Trading Rules and the Stochastic Properties of Stock Returns. The Journal of Finance, 47(5), 1731–1764.', doi: '10.1111/j.1540-6261.1992.tb04681.x' },
  faber2007: { text: 'Faber, M. T. (2007). A Quantitative Approach to Tactical Asset Allocation. The Journal of Wealth Management, 9(4), 69–79.', doi: '10.3905/jwm.2007.674809' },
  sullivan1999: { text: 'Sullivan, R., Timmermann, A. & White, H. (1999). Data-Snooping, Technical Trading Rule Performance, and the Bootstrap. The Journal of Finance, 54(5), 1647–1691.', doi: '10.1111/0022-1082.00163' },
  park2007: { text: 'Park, C.-H. & Irwin, S. H. (2007). What Do We Know About the Profitability of Technical Analysis? Journal of Economic Surveys, 21(4), 786–826.', doi: '10.1111/j.1467-6419.2007.00519.x' },
  jegadeesh1993: { text: 'Jegadeesh, N. & Titman, S. (1993). Returns to Buying Winners and Selling Losers: Implications for Stock Market Efficiency. The Journal of Finance, 48(1), 65–91.', doi: '10.1111/j.1540-6261.1993.tb04702.x' },
  moskowitz2012: { text: 'Moskowitz, T. J., Ooi, Y. H. & Pedersen, L. H. (2012). Time Series Momentum. Journal of Financial Economics, 104(2), 228–250.', doi: '10.1016/j.jfineco.2011.11.003' },
  barroso2015: { text: 'Barroso, P. & Santa-Clara, P. (2015). Momentum Has Its Moments. Journal of Financial Economics, 116(1), 111–120.', doi: '10.1016/j.jfineco.2014.11.010' },
  george2004: { text: 'George, T. J. & Hwang, C.-Y. (2004). The 52-Week High and Momentum Investing. The Journal of Finance, 59(5), 2145–2176.', doi: '10.1111/j.1540-6261.2004.00695.x' },
  ang2006: { text: 'Ang, A., Hodrick, R. J., Xing, Y. & Zhang, X. (2006). The Cross-Section of Volatility and Expected Returns. The Journal of Finance, 61(1), 259–299.', doi: '10.1111/j.1540-6261.2006.00836.x' },
  frazzini2014: { text: 'Frazzini, A. & Pedersen, L. H. (2014). Betting Against Beta. Journal of Financial Economics, 111(1), 1–25.', doi: '10.1016/j.jfineco.2013.10.005' },
  moreira2017: { text: 'Moreira, A. & Muir, T. (2017). Volatility-Managed Portfolios. The Journal of Finance, 72(4), 1611–1644.', doi: '10.1111/jofi.12513' },
  jegadeesh1990: { text: 'Jegadeesh, N. (1990). Evidence of Predictable Behavior of Security Returns. The Journal of Finance, 45(3), 881–898.', doi: '10.1111/j.1540-6261.1990.tb05110.x' },
  lehmann1990: { text: 'Lehmann, B. N. (1990). Fads, Martingales, and Market Efficiency. The Quarterly Journal of Economics, 105(1), 1–28.', doi: '10.2307/2937816' },
  basu1977: { text: 'Basu, S. (1977). Investment Performance of Common Stocks in Relation to Their Price-Earnings Ratios: A Test of the Efficient Market Hypothesis. The Journal of Finance, 32(3), 663–682.', doi: '10.1111/j.1540-6261.1977.tb01979.x' },
  fama1992: { text: 'Fama, E. F. & French, K. R. (1992). The Cross-Section of Expected Stock Returns. The Journal of Finance, 47(2), 427–465.', doi: '10.1111/j.1540-6261.1992.tb04398.x' },
  novymarx2013: { text: 'Novy-Marx, R. (2013). The Other Side of Value: The Gross Profitability Premium. Journal of Financial Economics, 108(1), 1–28.', doi: '10.1016/j.jfineco.2013.01.003' },
  fama2015: { text: 'Fama, E. F. & French, K. R. (2015). A Five-Factor Asset Pricing Model. Journal of Financial Economics, 116(1), 1–22.', doi: '10.1016/j.jfineco.2014.10.010' },
  mclean2016: { text: 'McLean, R. D. & Pontiff, J. (2016). Does Academic Research Destroy Stock Return Predictability? The Journal of Finance, 71(1), 5–32.', doi: '10.1111/jofi.12365' },
  harvey2016: { text: 'Harvey, C. R., Liu, Y. & Zhu, H. (2016). … and the Cross-Section of Expected Returns. The Review of Financial Studies, 29(1), 5–68.', doi: '10.1093/rfs/hhv059' },
  wilder1978: { text: 'Wilder, J. W. (1978). New Concepts in Technical Trading Systems. Greensboro, NC: Trend Research. (RSI, ATR)' },
  appel2005: { text: 'Appel, G. (2005). Technical Analysis: Power Tools for Active Investors. Upper Saddle River, NJ: FT Prentice Hall. (MACD)' },
  bollinger2001: { text: 'Bollinger, J. (2001). Bollinger on Bollinger Bands. New York: McGraw-Hill.' },
  sharpe1964: { text: 'Sharpe, W. F. (1964). Capital Asset Prices: A Theory of Market Equilibrium under Conditions of Risk. The Journal of Finance, 19(3), 425–442. (Beta)', doi: '10.1111/j.1540-6261.1964.tb02865.x' },
  sharpe1994: { text: 'Sharpe, W. F. (1994). The Sharpe Ratio. The Journal of Portfolio Management, 21(1), 49–58.', doi: '10.3905/jpm.1994.409501' },
  sortino1994: { text: 'Sortino, F. A. & Price, L. N. (1994). Performance Measurement in a Downside Risk Framework. The Journal of Investing, 3(3), 59–64.', doi: '10.3905/joi.3.3.59' },
};

export const REF_ORDER = Object.keys(REFS);
