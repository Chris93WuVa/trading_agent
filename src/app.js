const stockWeights = {
  technicalScore: 35,
  fundamentalScore: 20,
  valuationScore: 15,
  riskScore: 15,
  marketScore: 10,
  sentimentScore: 5
};

const cryptoWeights = {
  technicalScore: 35,
  liquidityScore: 20,
  derivativesScore: 15,
  onchainScore: 15,
  marketScore: 10,
  riskScore: 5
};

const cryptoIds = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  TRX: 'tron',
  AVAX: 'avalanche-2',
  LINK: 'chainlink'
};

let snapshot = null;
let portfolio = [];
let selectedSymbol = 'MSFT';

const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const getElement = (id) => document.getElementById(id);

const scoreAsset = (asset) => {
  const weights = asset.type === 'crypto' ? cryptoWeights : stockWeights;
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  return Math.round(Object.entries(weights).reduce((sum, [key, weight]) => sum + (asset[key] ?? 50) * weight, 0) / totalWeight);
};

const recommendationForScore = (score) => {
  if (score >= 75) return 'Buy';
  if (score >= 45) return 'Hold';
  return 'Sell';
};

const classForChange = (value) => (value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral');

const formatChange = (value) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

const sparkline = (values, color = 'var(--blue)') => {
  const width = 220;
  const height = 52;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1 || 1)) * width;
    const y = height - ((value - min) / range) * (height - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="Recent trend"><polyline points="${points}" stroke="${color}"></polyline></svg>`;
};

const scoreBar = (score) => `<div class="score-bar" aria-label="Score ${score}"><span style="width:${score}%"></span></div>`;

const signalBadge = (signal) => `<span class="badge ${signal}">${signal}</span>`;

const assetBySymbol = (symbol) => snapshot.assets.find((asset) => asset.symbol === symbol);

const setSelectedAsset = (symbol) => {
  selectedSymbol = symbol;
  getElement('asset-selector').value = symbol;
  renderAssetDetail();
  activatePage('asset-detail');
};

const activatePage = (pageName) => {
  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === `page-${pageName}`));
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === pageName));
  const page = getElement(`page-${pageName}`);
  getElement('page-title').textContent = page.dataset.title;
};

const renderHeader = () => {
  getElement('data-mode').textContent = snapshot.dataMode;
  getElement('market-status').textContent = snapshot.marketStatus;
  getElement('last-refresh').textContent = new Date(snapshot.generatedAt).toLocaleString();
};

const renderIndexCards = () => {
  getElement('index-cards').innerHTML = snapshot.indices.map((item) => `
    <article class="metric-card">
      <span class="eyebrow">${item.symbol}</span>
      <h2>${item.name}</h2>
      <p class="price">${currency.format(item.price)}</p>
      <span class="change ${classForChange(item.changePct)}">${formatChange(item.changePct)}</span>
      ${sparkline(item.spark, item.changePct >= 0 ? 'var(--green)' : 'var(--red)')}
    </article>
  `).join('');
};

const renderTopSignals = () => {
  const topSignals = [...snapshot.assets]
    .map((asset) => ({ ...asset, totalScore: scoreAsset(asset) }))
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 5);

  getElement('top-signals').innerHTML = topSignals.map((asset) => `
    <article class="signal-card" data-symbol="${asset.symbol}">
      <header>
        <strong>${asset.symbol} · ${asset.name}</strong>
        ${signalBadge(recommendationForScore(asset.totalScore))}
      </header>
      <div>${scoreBar(asset.totalScore)}</div>
      <small>Score ${asset.totalScore} · Confidence ${asset.confidence}% · Stop ${currency.format(asset.stopLoss)} · Target ${currency.format(asset.takeProfit)}</small>
      <p>${asset.explanation}</p>
    </article>
  `).join('');
};

const renderRegime = () => {
  const averageScore = Math.round(snapshot.assets.reduce((sum, asset) => sum + scoreAsset(asset), 0) / snapshot.assets.length);
  const buyCount = snapshot.assets.filter((asset) => recommendationForScore(scoreAsset(asset)) === 'Buy').length;
  const sellCount = snapshot.assets.filter((asset) => recommendationForScore(scoreAsset(asset)) === 'Sell').length;
  const regime = averageScore >= 70 ? 'Bullish' : averageScore >= 50 ? 'Neutral / selective' : 'Risk-off';

  getElement('regime-card').innerHTML = `
    <p class="eyebrow">${regime}</p>
    <h3>Universe score: ${averageScore}/100</h3>
    <p>${buyCount} buy signals, ${sellCount} sell signals, and ${snapshot.assets.length - buyCount - sellCount} hold signals across the current sample universe.</p>
    <p>Use this view to decide whether to emphasize offense, patience, or capital protection before opening individual asset detail pages.</p>
  `;
};

const tableRow = (asset, columns) => `
  <tr data-symbol="${asset.symbol}">
    ${columns.map((column) => `<td>${column(asset)}</td>`).join('')}
  </tr>
`;

const renderStocks = () => {
  const filter = getElement('stock-filter').value;
  const stocks = snapshot.assets
    .filter((asset) => asset.type === 'stock' || asset.type === 'etf')
    .map((asset) => ({ ...asset, totalScore: scoreAsset(asset), computedSignal: recommendationForScore(scoreAsset(asset)) }))
    .filter((asset) => filter === 'all' || asset.computedSignal === filter)
    .sort((a, b) => b.totalScore - a.totalScore);

  getElement('stocks-table').innerHTML = stocks.map((asset) => tableRow(asset, [
    (item) => `<strong>${item.symbol}</strong><br><small>${item.name}</small>`,
    (item) => item.type.toUpperCase(),
    (item) => currency.format(item.price),
    (item) => `<span class="${classForChange(item.changePct)}">${formatChange(item.changePct)}</span>`,
    (item) => `${item.totalScore}${scoreBar(item.totalScore)}`,
    (item) => item.technicalScore,
    (item) => item.fundamentalScore,
    (item) => item.riskScore,
    (item) => signalBadge(item.computedSignal)
  ])).join('');
};

const renderCrypto = () => {
  const crypto = snapshot.assets
    .filter((asset) => asset.type === 'crypto')
    .map((asset) => ({ ...asset, totalScore: scoreAsset(asset), computedSignal: recommendationForScore(scoreAsset(asset)) }))
    .sort((a, b) => b.totalScore - a.totalScore);

  getElement('crypto-table').innerHTML = crypto.map((asset) => tableRow(asset, [
    (item) => `<strong>${item.symbol}</strong><br><small>${item.name}</small>`,
    (item) => currency.format(item.price),
    (item) => `<span class="${classForChange(item.changePct)}">${formatChange(item.changePct)}</span>`,
    (item) => `${item.totalScore}${scoreBar(item.totalScore)}`,
    (item) => item.liquidityScore,
    (item) => item.derivativesScore,
    (item) => item.onchainScore,
    (item) => signalBadge(item.computedSignal)
  ])).join('');
};

const renderRecommendations = () => {
  const groups = ['Buy', 'Hold', 'Sell'];
  getElement('recommendation-columns').innerHTML = groups.map((group) => {
    const assets = snapshot.assets
      .map((asset) => ({ ...asset, totalScore: scoreAsset(asset), computedSignal: recommendationForScore(scoreAsset(asset)) }))
      .filter((asset) => asset.computedSignal === group)
      .sort((a, b) => b.totalScore - a.totalScore);
    return `
      <article class="panel">
        <div class="panel-header"><div><p class="eyebrow">Daily signals</p><h2>${group}</h2></div></div>
        <div class="signal-list">
          ${assets.map((asset) => `
            <article class="recommendation-card" data-symbol="${asset.symbol}">
              <header><strong>${asset.symbol}</strong> ${signalBadge(group)}</header>
              <p>Score ${asset.totalScore} · Confidence ${asset.confidence}%</p>
              <p>${asset.explanation}</p>
            </article>
          `).join('') || '<p class="neutral">No assets in this bucket.</p>'}
        </div>
      </article>
    `;
  }).join('');
};

const renderAssetSelector = () => {
  getElement('asset-selector').innerHTML = snapshot.assets
    .map((asset) => `<option value="${asset.symbol}">${asset.symbol} · ${asset.name}</option>`)
    .join('');
  getElement('asset-selector').value = selectedSymbol;
};

const renderAssetDetail = () => {
  const asset = assetBySymbol(selectedSymbol) ?? snapshot.assets[0];
  selectedSymbol = asset.symbol;
  const totalScore = scoreAsset(asset);
  const signal = recommendationForScore(totalScore);
  getElement('asset-heading').textContent = `${asset.symbol} · ${asset.name}`;
  getElement('asset-chart').innerHTML = `
    <div class="panel-header">
      <div><p class="eyebrow">Price trend</p><h2>${currency.format(asset.price)} <span class="${classForChange(asset.changePct)}">${formatChange(asset.changePct)}</span></h2></div>
      ${signalBadge(signal)}
    </div>
    ${sparkline(asset.spark, asset.changePct >= 0 ? 'var(--green)' : 'var(--red)')}
  `;

  const scoreKeys = asset.type === 'crypto'
    ? ['technicalScore', 'liquidityScore', 'derivativesScore', 'onchainScore', 'marketScore', 'riskScore']
    : ['technicalScore', 'fundamentalScore', 'valuationScore', 'riskScore', 'marketScore', 'sentimentScore'];

  getElement('asset-scores').innerHTML = scoreKeys.map((key) => `
    <div class="score-tile">
      <span>${key.replace('Score', '').replace(/([A-Z])/g, ' $1').trim()}</span>
      <strong>${asset[key] ?? 50}</strong>
      ${scoreBar(asset[key] ?? 50)}
    </div>
  `).join('');

  getElement('asset-insight').innerHTML = `
    <p class="eyebrow">Signal explanation</p>
    <h3>${signal} · ${totalScore}/100 · ${asset.confidence}% confidence</h3>
    <p>${asset.explanation}</p>
    <div>
      <strong>Risk tools</strong>
      <p>Stop-loss reference: ${currency.format(asset.stopLoss)}<br>Take-profit reference: ${currency.format(asset.takeProfit)}</p>
    </div>
    <div>
      <strong>Data context</strong>
      <p>${snapshot.dataMode}. Last snapshot: ${new Date(snapshot.generatedAt).toLocaleString()}.</p>
    </div>
  `;
};

const loadPortfolio = () => {
  const saved = localStorage.getItem('trading-agent-portfolio');
  portfolio = saved ? JSON.parse(saved) : snapshot.portfolio;
};

const savePortfolio = () => localStorage.setItem('trading-agent-portfolio', JSON.stringify(portfolio));

const renderPortfolio = () => {
  const rows = portfolio.map((position) => {
    const asset = assetBySymbol(position.symbol.toUpperCase());
    const price = asset?.price ?? 0;
    const value = position.quantity * price;
    const cost = position.quantity * position.costBasis;
    return { ...position, asset, value, pnl: value - cost };
  });
  const totalValue = rows.reduce((sum, row) => sum + row.value, 0);
  const totalPnl = rows.reduce((sum, row) => sum + row.pnl, 0);

  getElement('portfolio-table').innerHTML = rows.map((row) => `
    <tr data-symbol="${row.symbol}">
      <td><strong>${row.symbol}</strong><br><small>${row.asset?.name ?? 'Price unavailable'}</small></td>
      <td>${formatter.format(row.quantity)}</td>
      <td>${currency.format(row.costBasis)}</td>
      <td>${currency.format(row.value)}</td>
      <td class="${classForChange(row.pnl)}">${currency.format(row.pnl)}</td>
    </tr>
  `).join('');

  const concentration = rows
    .map((row) => ({ symbol: row.symbol, weight: totalValue ? row.value / totalValue : 0 }))
    .sort((a, b) => b.weight - a.weight)[0];

  getElement('portfolio-summary').innerHTML = `
    <p class="eyebrow">Manual portfolio</p>
    <h3>${currency.format(totalValue)} total value</h3>
    <p class="${classForChange(totalPnl)}">Total unrealized P&L: ${currency.format(totalPnl)}</p>
    <p>${concentration ? `Largest position: ${concentration.symbol} at ${(concentration.weight * 100).toFixed(1)}% of tracked value.` : 'Add a position to see allocation warnings.'}</p>
    <p>${concentration && concentration.weight > 0.35 ? 'Concentration warning: largest position is above 35%.' : 'No high concentration warning from the current manual positions.'}</p>
  `;
};

const parsePortfolioCsv = (text) => text.trim().split(/\r?\n/).slice(1).map((line) => {
  const [symbol, quantity, costBasis] = line.split(',').map((value) => value.trim());
  return { symbol: symbol.toUpperCase(), quantity: Number(quantity), costBasis: Number(costBasis) };
}).filter((row) => row.symbol && Number.isFinite(row.quantity) && Number.isFinite(row.costBasis));

const renderWeights = () => {
  getElement('weights-form').innerHTML = Object.entries(stockWeights).map(([key, value]) => `
    <label class="weight-field">
      <span>${key.replace('Score', '').replace(/([A-Z])/g, ' $1').trim()}</span>
      <input type="number" min="0" max="100" value="${value}" data-weight="${key}" />
    </label>
  `).join('');
};

const refreshCryptoPrices = async () => {
  const ids = snapshot.assets.filter((asset) => asset.type === 'crypto').map((asset) => cryptoIds[asset.symbol]).filter(Boolean).join(',');
  const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`);
  const prices = await response.json();
  snapshot.assets = snapshot.assets.map((asset) => {
    const id = cryptoIds[asset.symbol];
    if (!id || !prices[id]) return asset;
    return {
      ...asset,
      price: prices[id].usd ?? asset.price,
      changePct: prices[id].usd_24h_change ?? asset.changePct,
      volume: prices[id].usd_24h_vol ?? asset.volume
    };
  });
  snapshot.generatedAt = new Date().toISOString();
  renderAll();
};

const bindEvents = () => {
  getElement('dashboard-nav').addEventListener('click', (event) => {
    const button = event.target.closest('.nav-item');
    if (button) activatePage(button.dataset.page);
  });

  getElement('stock-filter').addEventListener('change', renderStocks);
  getElement('asset-selector').addEventListener('change', (event) => setSelectedAsset(event.target.value));
  getElement('refresh-crypto').addEventListener('click', () => refreshCryptoPrices());

  document.body.addEventListener('click', (event) => {
    const row = event.target.closest('[data-symbol]');
    if (row?.dataset.symbol) setSelectedAsset(row.dataset.symbol);
  });

  getElement('symbol-search').addEventListener('change', (event) => {
    const symbol = event.target.value.trim().toUpperCase();
    if (assetBySymbol(symbol)) setSelectedAsset(symbol);
  });

  getElement('portfolio-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    portfolio.push({
      symbol: String(data.get('symbol')).toUpperCase(),
      quantity: Number(data.get('quantity')),
      costBasis: Number(data.get('costBasis'))
    });
    savePortfolio();
    renderPortfolio();
    event.currentTarget.reset();
  });

  getElement('portfolio-csv').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    portfolio = parsePortfolioCsv(await file.text());
    savePortfolio();
    renderPortfolio();
  });
};

const renderAll = () => {
  renderHeader();
  renderIndexCards();
  renderTopSignals();
  renderRegime();
  renderStocks();
  renderCrypto();
  renderRecommendations();
  renderAssetSelector();
  renderAssetDetail();
  renderPortfolio();
  renderWeights();
};

const init = async () => {
  const response = await fetch('data/market_snapshot.json');
  snapshot = await response.json();
  loadPortfolio();
  bindEvents();
  renderAll();
};

init();
