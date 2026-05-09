import { readFile } from 'node:fs/promises';

const requiredFiles = [
  'index.html',
  'src/app.js',
  'src/styles.css',
  'data/market_snapshot.json',
  'scripts/generate-snapshot.mjs'
];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

for (const file of requiredFiles) {
  const content = await readFile(file, 'utf8');
  assert(content.length > 0, `${file} must not be empty`);
}

const html = await readFile('index.html', 'utf8');
for (const page of ['overview', 'stocks', 'crypto', 'recommendations', 'asset-detail', 'portfolio', 'settings']) {
  assert(html.includes(`page-${page}`), `index.html is missing ${page} page`);
}
assert(html.includes('id="auth-gate"'), 'index.html is missing the password gate');
assert(html.includes('id="auth-password"'), 'index.html is missing the password input');
assert(html.includes('app-shell is-locked'), 'dashboard shell should start locked');

const app = await readFile('src/app.js', 'utf8');
for (const feature of ['scoreAsset', 'refreshCryptoPrices', 'parsePortfolioCsv', 'renderRecommendations', 'requireDashboardPassword']) {
  assert(app.includes(feature), `src/app.js is missing ${feature}`);
}

const snapshot = JSON.parse(await readFile('data/market_snapshot.json', 'utf8'));
assert(app.includes('c7dfc928bbaa76025694a02a78d57b310f67a4660f3f300e712d310c2f17e6d5'), 'src/app.js is missing the configured password hash');
assert(app.includes('await requireDashboardPassword();'), 'dashboard data should load only after password unlock');

assert(Array.isArray(snapshot.assets), 'snapshot.assets must be an array');
assert(snapshot.assets.length >= 10, 'snapshot must include at least 10 assets');
assert(snapshot.assets.some((asset) => asset.type === 'stock'), 'snapshot must include stocks');
assert(snapshot.assets.some((asset) => asset.type === 'etf'), 'snapshot must include ETFs');
assert(snapshot.assets.some((asset) => asset.type === 'crypto'), 'snapshot must include crypto');
assert(snapshot.assets.filter((asset) => asset.type === 'crypto').length >= 10, 'snapshot must include at least top 10 crypto assets');
assert(Array.isArray(snapshot.portfolio), 'snapshot.portfolio must be an array');

for (const asset of snapshot.assets) {
  assert(asset.symbol && asset.name && asset.type, `asset missing identity: ${JSON.stringify(asset)}`);
  assert(['Buy', 'Hold', 'Sell'].includes(asset.recommendation), `${asset.symbol} has invalid recommendation`);
  assert(Number.isFinite(asset.price), `${asset.symbol} has invalid price`);
  assert(Array.isArray(asset.spark) && asset.spark.length >= 2, `${asset.symbol} needs sparkline data`);
  assert(asset.explanation?.length > 20, `${asset.symbol} needs an explanation`);
}

console.log('Dashboard validation passed.');
