"""Anlageklassen und kuratierte Top-Listen (Yahoo-Finance-Symbole).

Die Listen sind bewusst kompakt und für Anleger in Deutschland ausgewählt
(Xetra-Notierungen, EUR-Krypto-Paare). Für Aktien liefert der Yahoo-Provider
zusätzlich dynamische Listen (meistgehandelt, Gewinner, Verlierer).
"""

from __future__ import annotations

ASSET_CLASSES = {
    "aktien": "Aktien",
    "etf": "ETFs",
    "fonds": "Fonds",
    "anleihen": "Anleihen",
    "waehrungen": "Währungen",
    "krypto": "Krypto",
    "derivate": "Derivate",
    "indizes": "Indizes",
}

# Yahoo quoteType -> Anlageklasse
QUOTE_TYPE_MAP = {
    "EQUITY": "aktien",
    "ETF": "etf",
    "MUTUALFUND": "fonds",
    "CURRENCY": "waehrungen",
    "CRYPTOCURRENCY": "krypto",
    "FUTURE": "derivate",
    "OPTION": "derivate",
    "INDEX": "indizes",
    "BOND": "anleihen",
}

# Symbole, die trotz quoteType inhaltlich zu "Anleihen" gehören.
BOND_SYMBOLS = {
    "^IRX", "^FVX", "^TNX", "^TYX", "ZT=F", "ZF=F", "ZN=F", "ZB=F",
    "TLT", "IEF", "SHY", "AGG", "BND", "LQD", "HYG", "TIP", "EUNH.DE", "IBCI.DE",
}

# Renditen (Yields) werden von Yahoo als Index in Prozentpunkten geführt.
YIELD_SYMBOLS = {"^IRX", "^FVX", "^TNX", "^TYX"}

TOP_LISTS: dict[str, list[tuple[str, str]]] = {
    "aktien": [
        ("AAPL", "Apple"), ("MSFT", "Microsoft"), ("NVDA", "NVIDIA"), ("AMZN", "Amazon"),
        ("GOOGL", "Alphabet A"), ("META", "Meta Platforms"), ("TSLA", "Tesla"),
        ("BRK-B", "Berkshire Hathaway B"), ("JPM", "JPMorgan Chase"), ("V", "Visa"),
        ("SAP.DE", "SAP"), ("SIE.DE", "Siemens"), ("ALV.DE", "Allianz"),
        ("DTE.DE", "Deutsche Telekom"), ("RHM.DE", "Rheinmetall"), ("MBG.DE", "Mercedes-Benz Group"),
        ("BMW.DE", "BMW"), ("MUV2.DE", "Munich Re"), ("ASML.AS", "ASML"), ("MC.PA", "LVMH"),
        ("NESN.SW", "Nestlé"), ("NOVO-B.CO", "Novo Nordisk"),
    ],
    "etf": [
        ("EUNL.DE", "iShares Core MSCI World"), ("VWCE.DE", "Vanguard FTSE All-World Acc"),
        ("SXR8.DE", "iShares Core S&P 500"), ("IS3N.DE", "iShares Core MSCI EM IMI"),
        ("SXRV.DE", "iShares Nasdaq 100"), ("EXS1.DE", "iShares Core DAX"),
        ("IUSN.DE", "iShares MSCI World Small Cap"), ("VGWL.DE", "Vanguard FTSE All-World Dist"),
        ("SPY", "SPDR S&P 500"), ("QQQ", "Invesco QQQ"), ("VTI", "Vanguard Total Stock Market"),
        ("VT", "Vanguard Total World Stock"), ("GLD", "SPDR Gold Shares"), ("IWM", "iShares Russell 2000"),
    ],
    "fonds": [
        ("VFIAX", "Vanguard 500 Index Admiral"), ("FXAIX", "Fidelity 500 Index"),
        ("VTSAX", "Vanguard Total Stock Market Admiral"), ("VTIAX", "Vanguard Total Intl Stock Admiral"),
        ("VBTLX", "Vanguard Total Bond Market Admiral"), ("AGTHX", "American Funds Growth Fund of America"),
        ("FCNTX", "Fidelity Contrafund"), ("VWELX", "Vanguard Wellington"),
    ],
    "anleihen": [
        ("^IRX", "US-Staatsanleihen 13 Wochen (Rendite)"), ("^FVX", "US-Staatsanleihen 5 J. (Rendite)"),
        ("^TNX", "US-Staatsanleihen 10 J. (Rendite)"), ("^TYX", "US-Staatsanleihen 30 J. (Rendite)"),
        ("EUNH.DE", "iShares Core € Govt Bond"), ("IBCI.DE", "iShares € Inflation Linked Govt Bond"),
        ("TLT", "iShares 20+ Year Treasury"), ("IEF", "iShares 7-10 Year Treasury"),
        ("SHY", "iShares 1-3 Year Treasury"), ("AGG", "iShares Core US Aggregate Bond"),
        ("LQD", "iShares Investment Grade Corporate"), ("HYG", "iShares High Yield Corporate"),
        ("TIP", "iShares TIPS Bond"),
    ],
    "waehrungen": [
        ("EURUSD=X", "Euro / US-Dollar"), ("EURGBP=X", "Euro / Pfund"), ("EURCHF=X", "Euro / Franken"),
        ("EURJPY=X", "Euro / Yen"), ("EURCNY=X", "Euro / Renminbi"), ("EURSEK=X", "Euro / Schwed. Krone"),
        ("GBPUSD=X", "Pfund / US-Dollar"), ("USDJPY=X", "US-Dollar / Yen"),
        ("USDCHF=X", "US-Dollar / Franken"), ("AUDUSD=X", "Austral. Dollar / US-Dollar"),
    ],
    "krypto": [
        ("BTC-EUR", "Bitcoin"), ("ETH-EUR", "Ethereum"), ("SOL-EUR", "Solana"), ("XRP-EUR", "XRP"),
        ("BNB-EUR", "BNB"), ("ADA-EUR", "Cardano"), ("DOGE-EUR", "Dogecoin"),
        ("LINK-EUR", "Chainlink"), ("AVAX-EUR", "Avalanche"), ("DOT-EUR", "Polkadot"),
    ],
    "derivate": [
        ("ES=F", "E-mini S&P 500 Future"), ("NQ=F", "E-mini Nasdaq 100 Future"),
        ("YM=F", "E-mini Dow Future"), ("RTY=F", "E-mini Russell 2000 Future"),
        ("GC=F", "Gold Future"), ("SI=F", "Silber Future"), ("HG=F", "Kupfer Future"),
        ("CL=F", "WTI Rohöl Future"), ("BZ=F", "Brent Rohöl Future"), ("NG=F", "Erdgas Future"),
        ("ZN=F", "10-Year T-Note Future"), ("6E=F", "Euro FX Future"),
        ("ZW=F", "Weizen Future"), ("ZC=F", "Mais Future"),
    ],
    "indizes": [
        ("^GDAXI", "DAX"), ("^MDAXI", "MDAX"), ("^STOXX50E", "Euro Stoxx 50"), ("^GSPC", "S&P 500"),
        ("^NDX", "Nasdaq 100"), ("^DJI", "Dow Jones"), ("^FTSE", "FTSE 100"), ("^N225", "Nikkei 225"),
        ("^HSI", "Hang Seng"), ("^VIX", "CBOE Volatilitätsindex"),
    ],
}

# Marktüberblick auf der Startseite
MARKET_STRIP = [
    ("^GDAXI", "DAX"), ("^STOXX50E", "Euro Stoxx 50"), ("^GSPC", "S&P 500"),
    ("^NDX", "Nasdaq 100"), ("EURUSD=X", "EUR/USD"), ("GC=F", "Gold"),
    ("BTC-EUR", "Bitcoin"), ("^TNX", "US 10J"),
]

BENCHMARK = "^GSPC"

KNOWN_NAMES = {sym: name for items in TOP_LISTS.values() for sym, name in items}
KNOWN_CLASS = {sym: cls for cls, items in TOP_LISTS.items() for sym, _ in items}


def classify(symbol: str, quote_type: str | None) -> str:
    """Ordnet ein Symbol einer Anlageklasse zu (kuratierte Liste vor Yahoo-quoteType)."""
    if symbol in KNOWN_CLASS:
        return KNOWN_CLASS[symbol]
    if symbol in BOND_SYMBOLS:
        return "anleihen"
    if quote_type and quote_type.upper() in QUOTE_TYPE_MAP:
        return QUOTE_TYPE_MAP[quote_type.upper()]
    if symbol.endswith("=X"):
        return "waehrungen"
    if symbol.endswith("=F"):
        return "derivate"
    if symbol.startswith("^"):
        return "indizes"
    return "aktien"


def periods_per_year(asset_class: str) -> int:
    return 365 if asset_class == "krypto" else 252
