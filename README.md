# trading_agent

A GitHub Pages-hosted trading dashboard for personal and team-based investment research across US stocks, ETFs, and crypto assets.

## Implemented dashboard

The repository now contains a static, GitHub Pages-compatible dashboard implementation:

- Professional dark hybrid dashboard UI.
- Overview page with market cards, top signals, and market-regime summary.
- Stocks & ETFs screener with Buy / Hold / Sell analytical signals.
- Crypto screener with price, liquidity, derivatives, and selected on-chain score placeholders.
- Asset detail page with professional technical chart analysis, score breakdown, explanation, stop-loss, and take-profit references.
- Recommendations page grouped by Buy, Hold, and Sell.
- Manual portfolio tracker with local browser storage, CSV import support, and delete actions for custom positions.
- Settings page for scoring-weight visibility and professionalization roadmap.
- Daily snapshot generation script and GitHub Pages deployment workflow.

## Access protection

The static GitHub Pages dashboard displays a client-side password gate before loading dashboard data. The configured dashboard password is `stitch32`. Because GitHub Pages serves static public files, this is a casual-access barrier and not a replacement for server-side authentication.

## Run locally

Because the app fetches `data/market_snapshot.json`, serve the repository with a local static server instead of opening `index.html` directly:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Data refresh

The first implementation uses `data/market_snapshot.json` as the dashboard snapshot. The snapshot can be regenerated with:

```bash
npm run generate:data
```

The generator includes deterministic fallback data and attempts to refresh public crypto prices when network access is available. GitHub Actions runs the generator and validates the dashboard before deploying to GitHub Pages.

## Validation

Run the static validation suite with:

```bash
npm test
```

## Project plan

The planning document remains available in [`docs/dashboard_product_plan.md`](docs/dashboard_product_plan.md).
