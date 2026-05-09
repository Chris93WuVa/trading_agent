# Trading Dashboard Product Plan

_Last updated: 2026-05-09_

## 1. Product direction

The first release will be a modern, professional, hybrid trading dashboard for personal and team-based international investment research. The primary use cases are swing trading and long-term investing, with support for mixed time horizons through separate signal timeframes.

The dashboard will be hosted with GitHub Pages, so the initial application should be implemented as a static frontend with client-side data fetching and optional generated static data snapshots. Any secrets, scheduled data jobs, or private data processing must not run directly in the GitHub Pages frontend.

## 2. Confirmed planning decisions

| Area | Decision |
| --- | --- |
| Target users | Personal dashboard for the user and team, used as an international investment/research tool |
| Trading style | Mixed styles, mainly swing trading and long-term investing |
| Initial universe | US stocks, ETFs, and top 10 crypto assets |
| Recommendation style | Buy / Hold / Sell with explanations, plus optional stop-loss and take-profit risk tools |
| Initial data budget | Free APIs only |
| Crypto analytics depth | Price, derivatives, and selected on-chain analytics |
| Portfolio tracking | Manual portfolio input, with CSV import option; no automatic broker tracking initially |
| Visual style | Hybrid modern professional dashboard |
| Hosting | GitHub Pages |

## 3. Recommended MVP pages

### 3.1 Overview

Purpose: provide the daily market command center.

Core widgets:

- Market status and latest data refresh timestamp.
- Major US indices summary.
- ETF overview for broad market, sector, and risk proxies.
- Top 10 crypto overview.
- Watchlist movers.
- Top gainers and losers from the selected universe.
- Daily recommendation summary.
- Market regime card: bullish, neutral, bearish, or risk-off.

### 3.2 Stocks & ETFs

Purpose: identify promising US stocks and ETFs for swing and long-term decisions.

Core widgets:

- Screener table with sorting and filtering.
- Technical score, fundamental score, valuation score, momentum score, sentiment placeholder, risk score, and total score.
- Recommendation label: Buy, Hold, or Sell.
- Explanation drawer for each symbol.
- Optional stop-loss and take-profit levels.

Initial free-data-friendly metrics:

- Price and daily percentage change.
- Volume and relative volume where available.
- Simple moving averages.
- Exponential moving averages.
- RSI.
- MACD.
- Bollinger Bands.
- 1-month, 3-month, 6-month, and 12-month momentum.
- Volatility and drawdown.

### 3.3 Crypto

Purpose: track the top 10 crypto assets with price, trend, liquidity, selected derivatives, and selected on-chain context.

Core widgets:

- Crypto screener table.
- 24-hour and 7-day performance.
- Volume, market cap, and liquidity proxy.
- Technical trend score.
- Derivatives risk score where free data is available.
- Selected on-chain score where free data is available.
- Buy / Hold / Sell recommendation and explanation.

Initial top 10 crypto selection should be configurable because market rankings change over time.

### 3.4 Asset Detail

Purpose: provide deep analysis for one stock, ETF, or crypto asset.

Core sections:

- Header with symbol, name, current price, change, recommendation, confidence, and last update.
- Main chart with multiple timeframes.
- Technical indicator panel.
- Recommendation explanation panel.
- Risk plan with optional stop-loss and take-profit values.
- Fundamentals section for stocks and ETFs where data is available.
- Crypto-specific section for derivatives and selected on-chain metrics where data is available.

### 3.5 Recommendations

Purpose: provide the daily decision list.

Core widgets:

- Strongest Buy signals.
- Strongest Sell signals.
- Upgrades and downgrades since the previous refresh.
- Highest-risk assets.
- Watchlist-specific signals.
- Explanation and confidence for every recommendation.

### 3.6 Portfolio

Purpose: support manual portfolio review without broker integration.

Core widgets:

- Manual position entry.
- CSV import.
- Holdings table.
- Allocation by asset class, sector, and symbol.
- Unrealized P&L if cost basis is provided.
- Portfolio risk score.
- Concentration warnings.
- Suggested watchlist actions based on dashboard signals.

### 3.7 Settings

Purpose: allow the team to configure the dashboard without code changes.

Core settings:

- Watchlist symbols.
- Top crypto list override.
- Scoring weights.
- Preferred time horizon.
- API provider configuration.
- Data refresh preferences.
- Theme preferences.

## 4. Recommendation model

The first recommendation system should be transparent and rules-based. It should produce a score, a label, and a plain-language explanation. Machine learning can be added later after the rule-based baseline is backtested.

### 4.1 Stock and ETF score

Proposed default weighting:

| Component | Weight |
| --- | ---: |
| Technical trend and momentum | 35% |
| Fundamental quality | 20% |
| Valuation | 15% |
| Risk and volatility | 15% |
| Market regime and sector context | 10% |
| News/sentiment placeholder | 5% |

Recommendation mapping:

| Total score | Label |
| ---: | --- |
| 75-100 | Buy |
| 45-74 | Hold |
| 0-44 | Sell |

### 4.2 Crypto score

Proposed default weighting:

| Component | Weight |
| --- | ---: |
| Technical trend and momentum | 35% |
| Liquidity and volume | 20% |
| Derivatives positioning | 15% |
| Selected on-chain metrics | 15% |
| Market regime | 10% |
| Risk and volatility | 5% |

Recommendation mapping:

| Total score | Label |
| ---: | --- |
| 75-100 | Buy |
| 45-74 | Hold |
| 0-44 | Sell |

## 5. GitHub Pages architecture

GitHub Pages can host the frontend, but it should not expose private API keys or run server-side jobs. The initial architecture should therefore separate the public static app from data generation.

Recommended structure:

```text
GitHub Pages static frontend
  - Dashboard UI
  - Charts
  - Tables
  - Client-side filters
  - Public/free API calls where no secret is required

GitHub Actions scheduled jobs
  - Daily data refresh
  - Generate static JSON snapshots
  - Commit or publish generated data artifacts
  - Run recommendation scoring

Optional later backend
  - Secure API proxy for paid providers
  - Private team authentication
  - Database for watchlists and portfolios
```

### 5.1 Data freshness model

- Crypto prices can update more frequently because many crypto APIs expose free public endpoints.
- Stock data should start with free delayed or daily data if real-time free coverage is not reliable.
- Recommendation scores should update daily at minimum.
- The UI should always show the latest refresh timestamp and whether data is real-time, delayed, or end-of-day.

## 6. Free API candidates for the MVP

Free API terms change frequently, so each provider must be checked before implementation.

Potential stock and ETF data options:

- Alpha Vantage free tier.
- Stooq daily data.
- Yahoo Finance through community libraries, with caution because unofficial access can break.
- Financial Modeling Prep free tier for limited fundamentals, if available.
- Nasdaq or exchange-provided public data where terms allow.

Potential crypto data options:

- CoinGecko public API.
- Binance public market data endpoints.
- Coinbase public endpoints.
- DefiLlama public APIs for selected DeFi and stablecoin context.
- Blockchain.com or other public endpoints for selected Bitcoin network metrics.

Potential derivatives and on-chain sources:

- Binance public futures endpoints for funding and open interest where available.
- CoinGlass may be useful if the free tier allows the needed metrics.
- DefiLlama for selected DeFi, stablecoin, and protocol-level context.
- Public chain explorers only where rate limits and terms allow.

## 7. Design system

### 7.1 Visual principles

- Professional dark-first interface.
- High-density information layout without visual clutter.
- Clear green/red/neutral semantics for market movement.
- Confidence and risk shown separately to avoid misleading recommendations.
- Every score should be explainable.
- Every market data widget should display a freshness timestamp.

### 7.2 Navigation

```text
Overview | Stocks & ETFs | Crypto | Recommendations | Asset Detail | Portfolio | Settings
```

### 7.3 Layout pattern

```text
Top bar:
  Global search, market status, last refresh, data mode, settings

Left rail:
  Watchlists, saved screens, asset filters

Main canvas:
  Charts, screeners, recommendations, portfolio views

Right insight panel:
  Signal explanation, risks, news/context, alerts later
```

## 8. Risk and compliance principles

- Recommendations must be labeled as analytical signals, not guaranteed investment advice.
- The dashboard should show confidence, risk, and data freshness next to every signal.
- The system should distinguish delayed, daily, and real-time data.
- Backtesting should be added before relying heavily on any signal model.
- API provider terms must be respected, especially for redistribution through GitHub Pages.

## 9. Open planning decisions

The next planning discussion should decide:

1. Which frontend framework to use for GitHub Pages: plain static site, Vite + React, Next.js static export, or another option.
2. Whether the first implementation should prioritize a clickable prototype or a data-connected MVP.
3. Which free stock API to use first.
4. Which free crypto API to use first.
5. Whether the team needs authentication in the first version; GitHub Pages is public unless additional access controls are introduced elsewhere.
6. Whether portfolios should be stored locally in the browser first or imported from CSV each session.
7. Whether recommendations should be generated in the browser or by scheduled GitHub Actions.

## 10. Recommended next step

Build a GitHub Pages-compatible prototype with static sample data first. This allows the team to validate the information architecture, layout, and recommendation explanations before connecting live data providers.

Suggested implementation order:

1. Create the static frontend shell.
2. Add sample data files for stocks, ETFs, crypto, recommendations, and portfolio positions.
3. Build the Overview page.
4. Build the Stocks & ETFs screener.
5. Build the Crypto screener.
6. Build the Recommendations page.
7. Add CSV import for portfolio positions.
8. Add GitHub Actions daily snapshot generation.
9. Connect free APIs one provider at a time.
10. Add backtesting and alerts after the scoring baseline is stable.
