// Kursbuch – Single-Page-App (Hash-Routing, keine Build-Tools).

import { createChart, multiLine } from './chart.js';
import { REFS, REF_ORDER } from './refs.js';
import {
  api, ApiError, compact, dateTime, debounce, esc, h, html, ICONS, money, num, pct, price, raw, toast, tone,
} from './util.js';

const root = document.getElementById('root');
const state = { meta: null, collection: new Set(), cleanup: [], refresh: null, timer: null };
const RANGE_LABELS = ['1T', '1W', '1M', '6M', '1J', '5J', 'MAX'];

/* ------------------------------------------------------------------ Theme */
function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
try { applyTheme(localStorage.getItem('kb-theme')); } catch { /* Speicher gesperrt */ }
function toggleTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('kb-theme', next); } catch { /* egal */ }
}

/* ------------------------------------------------------------------ Login */
function renderLogin(message = '') {
  stopTimer();
  root.innerHTML = html`
    <div class="login">
      <div class="login__inner">
        <h1>Kursbuch</h1>
        <p>Privates Markt- und Depotjournal.</p>
        <form id="login-form" autocomplete="on">
          <label class="field">
            <span class="label">Passwort</span>
            <input id="pw" type="password" name="password" autocomplete="current-password" required autofocus>
          </label>
          <p class="login__error" role="alert">${message}</p>
          <div><button class="btn" type="submit">Anmelden</button></div>
        </form>
      </div>
      <footer>Analytische Signale, keine Anlageberatung.</footer>
    </div>`;
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await api('login', { method: 'POST', body: { password: form.password.value } });
      await boot();
    } catch (err) {
      form.querySelector('.login__error').textContent = err.message;
      form.password.value = '';
      form.password.focus();
    } finally { btn.disabled = false; }
  });
}

window.addEventListener('kb:logout', () => renderLogin('Sitzung abgelaufen – bitte erneut anmelden.'));

/* ------------------------------------------------------------------ Shell */
function renderShell() {
  root.innerHTML = html`
    <header class="masthead">
      <a class="wordmark" href="#/depot">Kursbuch <small>${state.meta.demo ? '' : 'Markt · Depot'}</small>
        ${state.meta.demo ? h`<span class="badge-demo" title="Synthetische Kurse – keine echten Marktdaten">Demo-Daten</span>` : ''}
      </a>
      <div class="search" id="search">
        <label class="search__box">
          ${raw(ICONS.search)}
          <span class="sr-only">Suche</span>
          <input id="q" type="search" placeholder="Aktie, ETF, Anleihe, Währung, Future …" autocomplete="off" spellcheck="false"
            role="combobox" aria-expanded="false" aria-controls="search-results" aria-autocomplete="list">
          <kbd>/</kbd>
        </label>
        <div class="search__results" id="search-results" hidden></div>
      </div>
      <nav class="nav" aria-label="Hauptnavigation">
        <a href="#/depot" data-nav="depot">Depot</a>
        <a href="#/maerkte" data-nav="maerkte">Märkte</a>
        <a href="#/methodik" data-nav="methodik">Methodik</a>
        <button class="icon-btn" id="theme" title="Hell/Dunkel">${raw(ICONS.theme)}</button>
        <button class="icon-btn" id="logout" title="Abmelden">${raw(ICONS.logout)}</button>
      </nav>
    </header>
    <div class="strip" id="strip" aria-label="Marktüberblick"></div>
    <main id="view" tabindex="-1"></main>
    <nav class="tabbar" aria-label="Navigation">
      <a href="#/depot" data-nav="depot">Depot</a>
      <a href="#/maerkte" data-nav="maerkte">Märkte</a>
      <a href="#/methodik" data-nav="methodik">Methodik</a>
    </nav>
    <dialog id="pos-dialog"></dialog>`;
  document.getElementById('logout').addEventListener('click', async () => {
    await api('logout', { method: 'POST' }).catch(() => {});
    renderLogin();
  });
  document.getElementById('theme').addEventListener('click', toggleTheme);
  setupSearch();
}

async function loadStrip() {
  const strip = document.getElementById('strip');
  if (!strip) return;
  try {
    const { items } = await api('market');
    strip.innerHTML = items.map((q) => html`
      <a href="${`#/i/${encodeURIComponent(q.symbol)}`}">
        <b>${q.name}</b>
        <span class="num">${price(q.price, null, { yield: q.is_yield })}</span>
        <span class="num ${tone(q.change_pct)}">${q.is_yield ? deltaPP(q.change) : pct(q.change_pct)}</span>
      </a>`).join('');
  } catch { /* Leiste ist optional */ }
}

const deltaPP = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${num(v, 3)} PP`);

async function loadCollection() {
  const { items } = await api('collection');
  state.collection = new Set(items.map((i) => i.symbol));
  return items;
}

function stopTimer() { clearInterval(state.timer); state.timer = null; }

async function boot() {
  try {
    state.meta = await api('meta');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { renderLogin(); return; }
    root.innerHTML = html`<div class="login"><div class="login__inner"><h1>Kursbuch</h1><p class="error-box">${err.message}</p></div></div>`;
    return;
  }
  renderShell();
  loadCollection().catch(() => {});
  loadStrip();
  stopTimer();
  state.timer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    loadStrip();
    state.refresh?.();
  }, 60_000);
  window.removeEventListener('hashchange', route);
  window.addEventListener('hashchange', route);
  route();
}

/* ------------------------------------------------------------------ Suche */
function setupSearch() {
  const input = document.getElementById('q');
  const box = document.getElementById('search-results');
  let items = []; let active = -1; let seq = 0;

  const close = () => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const open = () => { box.hidden = false; input.setAttribute('aria-expanded', 'true'); };
  const go = (sym) => { close(); input.value = ''; input.blur(); location.hash = `#/i/${encodeURIComponent(sym)}`; };

  const render = () => {
    if (!items.length) { box.innerHTML = '<p class="search__empty">Keine Treffer.</p>'; open(); return; }
    box.innerHTML = html`<ul role="listbox" id="search-list">${items.map((it, i) => h`
      <li class="result" role="option" id="${`opt-${i}`}" data-i="${i}" aria-selected="${i === active}">
        <div><div class="result__name">${it.name}</div><div class="result__meta">${it.symbol}${it.exchange ? ` · ${it.exchange}` : ''}</div></div>
        <span class="tag">${it.asset_class_title}</span>
      </li>`)}</ul>`;
    open();
  };

  const run = debounce(async () => {
    const q = input.value.trim();
    if (!q) { close(); return; }
    const mine = ++seq;
    try {
      const res = await api(`search?q=${encodeURIComponent(q)}`);
      if (mine !== seq) return;
      items = res.items; active = items.length ? 0 : -1; render();
    } catch (err) { box.innerHTML = html`<p class="search__empty">${err.message}</p>`; open(); }
  }, 220);

  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      render();
      input.setAttribute('aria-activedescendant', `opt-${active}`);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[active]) go(items[active].symbol);
      else if (input.value.trim()) go(input.value.trim().toUpperCase());
    } else if (e.key === 'Escape') { close(); input.blur(); }
  });
  box.addEventListener('mousedown', (e) => {
    const li = e.target.closest('.result');
    if (li) { e.preventDefault(); go(items[+li.dataset.i].symbol); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if ((e.key === '/' && !typing) || (e.key === 'k' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); input.focus(); }
  });
}

/* ------------------------------------------------------------------ Router */
function route() {
  for (const fn of state.cleanup.splice(0)) fn();
  state.refresh = null;
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [page = 'depot', a, b] = parts;
  document.querySelectorAll('[data-nav]').forEach((n) => {
    if (n.dataset.nav === (page === 'i' ? 'maerkte' : page)) n.setAttribute('aria-current', 'page');
    else n.removeAttribute('aria-current');
  });
  const view = document.getElementById('view');
  if (!view) return;
  view.innerHTML = '';
  window.scrollTo(0, 0);
  if (page === 'maerkte') maerkteView(view, a || 'aktien', b);
  else if (page === 'i' && a) instrumentView(view, a.toUpperCase());
  else if (page === 'methodik') methodikView(view);
  else depotView(view);
}

/* ------------------------------------------------------------------ Bausteine */
function starButton(symbol, name) {
  const on = state.collection.has(symbol);
  return h`<button class="star" data-star="${symbol}" data-name="${name ?? ''}" aria-pressed="${on}"
    title="${on ? 'Aus Sammlung entfernen' : 'Zur Sammlung hinzufügen'}">${raw(ICONS.star)}</button>`;
}

async function toggleCollection(symbol, name) {
  const on = state.collection.has(symbol);
  try {
    if (on) {
      await api(`collection?s=${encodeURIComponent(symbol)}`, { method: 'DELETE' });
      state.collection.delete(symbol);
      toast(`${name || symbol} aus der Sammlung entfernt`);
    } else {
      await api('collection', { method: 'POST', body: { symbol, name: name || null } });
      state.collection.add(symbol);
      toast(`${name || symbol} zur Sammlung hinzugefügt`);
    }
  } catch (err) { toast(err.message); }
  document.querySelectorAll(`[data-star="${CSS.escape(symbol)}"]`).forEach((b) => {
    const now = state.collection.has(symbol);
    b.setAttribute('aria-pressed', now);
    b.title = now ? 'Aus Sammlung entfernen' : 'Zur Sammlung hinzufügen';
    if (b.classList.contains('btn')) {
      b.classList.toggle('btn--on', now);
      b.lastChild.textContent = now ? ' In Sammlung' : ' Sammlung';
    }
  });
}

document.addEventListener('click', (e) => {
  const star = e.target.closest('[data-star]');
  if (star) { e.preventDefault(); e.stopPropagation(); toggleCollection(star.dataset.star, star.dataset.name); return; }
  const row = e.target.closest('[data-href]');
  if (row && !e.target.closest('a, button')) location.hash = row.dataset.href;
});

function rangeBar(current) {
  return h`<div class="ranges" role="group" aria-label="Zeitraum">${RANGE_LABELS.map((r) => h`
    <button type="button" data-range="${r}" aria-pressed="${r === current}">${r}</button>`)}</div>`;
}

function errorBox(err) { return html`<div class="error-box" role="alert">${err.message || err}</div>`; }

const fact = (label, value, title) => h`<div class="fact"><dt>${title ? h`<abbr title="${title}">${label}</abbr>` : label}</dt><dd>${value}</dd></div>`;

/* Chart + Kopfwert-Interaktion: Hover setzt den großen Wert wie bei Trade Republic. */
function mountChart({ container, ranges, load, onHover, initial = '1J', yieldMode = false }) {
  const chart = createChart(container, { onHover: (p) => onHover(p, current), yieldMode });
  let current = null; let seq = 0;
  async function show(r) {
    current = null;
    ranges.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.range === r));
    chart.loading();
    const mine = ++seq;
    try {
      const data = await load(r);
      if (mine !== seq) return;
      current = data;
      chart.set(data);
      onHover(null, data);
    } catch (err) { if (mine === seq) chart.error(err.message); }
  }
  ranges.addEventListener('click', (e) => { const b = e.target.closest('[data-range]'); if (b) show(b.dataset.range); });
  state.cleanup.push(() => chart.destroy());
  show(initial);
  return { reload: () => show(ranges.querySelector('[aria-pressed="true"]')?.dataset.range || initial) };
}

/* ------------------------------------------------------------------ Depot */
async function depotView(view) {
  view.innerHTML = html`<div class="page split">
    <section>
      <div class="hero">
        <div class="hero__eyebrow"><span class="label">Depot</span><span id="pf-note" class="faint"></span></div>
        <div class="hero__value" id="pf-value"><span class="skeleton">00.000,00 €</span></div>
        <div class="hero__delta" id="pf-delta">&nbsp;</div>
      </div>
      <div id="pf-chart"></div>
      ${rangeBar('1J')}
      <div id="pf-body"></div>
    </section>
    <aside>
      <div class="section" style="margin-top:36px">
        <div class="section__head"><h2>Sammlung</h2><a class="aside link" href="#/maerkte">+ Entdecken</a></div>
        <div id="watch"><p class="muted">Lädt …</p></div>
      </div>
    </aside>
  </div>`;

  let pf = null;
  const valueEl = view.querySelector('#pf-value');
  const deltaEl = view.querySelector('#pf-delta');

  const setHero = (value, delta, deltaPct, when) => {
    valueEl.innerHTML = html`${money(value, null)}<span class="ccy">€</span>`;
    deltaEl.innerHTML = html`<span class="${tone(delta)}">${money(delta, 'EUR', true)}</span>
      <span class="${tone(delta)}">(${pct(deltaPct)})</span><span class="when">${when}</span>`;
  };
  const defaultHero = () => {
    if (!pf) return;
    if (!pf.holdings.length) { valueEl.innerHTML = html`0,00<span class="ccy">€</span>`; deltaEl.innerHTML = '<span class="when">Noch keine Positionen</span>'; return; }
    setHero(pf.value_eur, pf.day_change_eur, pf.day_change_pct, 'Heute');
  };

  const chartBox = view.querySelector('#pf-chart');
  const ranges = view.querySelector('.ranges');

  async function loadData() {
    const [p, items] = await Promise.all([api('portfolio'), loadCollection()]);
    pf = p;
    renderBody();
    renderWatch(items);
    defaultHero();
  }

  function renderBody() {
    const body = view.querySelector('#pf-body');
    view.querySelector('#pf-note').textContent = pf.complete ? '' : 'Einige Kurse fehlen';
    if (!pf.holdings.length) {
      chartBox.hidden = true; ranges.hidden = true;
      body.innerHTML = html`<div class="section"><div class="empty">
        <h3>Ein leeres Kursbuch.</h3>
        <p>Suche oben nach einem Wertpapier oder stöbere in den <a class="link" href="#/maerkte">Märkten</a>.
        Auf der Detailseite kannst du es zur Sammlung hinzufügen oder eine Position mit Stückzahl und Kaufkurs erfassen.</p>
      </div></div>`;
      return;
    }
    chartBox.hidden = false; ranges.hidden = false;
    const alloc = pf.allocation;
    body.innerHTML = html`
      <div class="section">
        <div class="section__head"><h2>Aufteilung</h2><span class="aside">Gesamt-G/V <b class="num ${tone(pf.pnl_eur)}">${money(pf.pnl_eur, 'EUR', true)} (${pct(pf.pnl_pct)})</b></span></div>
        <div class="alloc">${alloc.map((a, i) => h`<i class="${`c${i % 8}`}" style="${`flex:${a.weight}`}" title="${`${a.title} ${pct(a.weight, 1, false)}`}"></i>`)}</div>
        <ul class="legend">${alloc.map((a, i) => h`<li><i class="${`c${i % 8}`}"></i>${a.title} <span class="num muted">${pct(a.weight, 1, false)}</span></li>`)}</ul>
      </div>
      <div class="section">
        <div class="section__head"><h2>Positionen</h2><span class="aside">${pf.holdings.length} Werte</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Wert</th><th class="hide-sm">Anteil</th><th class="hide-sm">Stück</th><th class="hide-sm">Ø Kaufkurs</th><th>Kurs</th><th>Heute</th><th>Wert €</th><th>G/V</th></tr></thead>
          <tbody>${pf.holdings.map((r) => h`
            <tr data-href="${`#/i/${encodeURIComponent(r.symbol)}`}">
              <td><div class="cell-name"><b>${r.name}</b><span>${r.symbol}</span></div></td>
              <td class="num hide-sm">${pct(r.weight, 1, false)}</td>
              <td class="num hide-sm">${num(r.quantity, r.quantity % 1 ? 4 : 0)}</td>
              <td class="num hide-sm">${price(r.avg_price, r.currency)}</td>
              <td class="num">${price(r.price, r.currency)}</td>
              <td class="num ${tone(r.change_pct)}">${pct(r.change_pct)}</td>
              <td class="num">${money(r.value_eur, 'EUR')}</td>
              <td class="num ${tone(r.pnl_pct)}">${pct(r.pnl_pct)}</td>
            </tr>`)}</tbody>
        </table></div>
        <p class="disclaimer">${pf.note}</p>
      </div>`;
  }

  function renderWatch(items) {
    const box = view.querySelector('#watch');
    if (!items.length) {
      box.innerHTML = '<p class="muted">Noch leer. Markiere Werte mit dem Stern, um sie hier zu verfolgen.</p>';
      return;
    }
    box.innerHTML = html`<ul class="rows">${items.map((it) => h`
      <li class="row" data-href="${`#/i/${encodeURIComponent(it.symbol)}`}" style="cursor:pointer">
        <div style="min-width:0">
          <div class="row__name">${it.held ? h`<span class="dot-held" title="Im Depot"></span>` : ''}${it.name}</div>
          <div class="row__sub">${it.symbol}</div>
        </div>
        <div class="row__right">
          <div class="row__price">${price(it.price, it.currency, { yield: it.is_yield })}</div>
          <div class="row__chg ${tone(it.change_pct)}">${pct(it.change_pct)}</div>
        </div>
      </li>`)}</ul>`;
  }

  mountChart({
    container: chartBox,
    ranges,
    load: (r) => api(`portfolio/chart?range=${r}`),
    onHover: (p, data) => {
      if (!pf || !pf.holdings.length) return;
      if (!p || !data) {
        if (data?.points?.length && data.range !== '1T') {
          const first = data.baseline; const last = pf.value_eur;
          setHero(last, last - first, first ? last / first - 1 : null, `seit ${dateTime(data.points[0][0], false)}`);
        } else defaultHero();
        return;
      }
      const base = data.baseline;
      setHero(p.value, p.value - base, base ? p.value / base - 1 : null, dateTime(p.ts, data.intraday));
    },
  });

  try { await loadData(); } catch (err) { view.querySelector('#pf-body').innerHTML = errorBox(err); }
  state.refresh = () => loadData().catch(() => {});
}

/* ------------------------------------------------------------------ Märkte */
async function maerkteView(view, cls, screen) {
  const classes = state.meta.asset_classes;
  if (!classes.some((c) => c.key === cls)) cls = 'aktien';
  view.innerHTML = html`<div class="page">
    <div class="hero"><span class="label">Märkte</span><h1 class="hero__title">Was bewegt sich?</h1></div>
    <nav class="tabs" aria-label="Anlageklassen">${classes.map((c) => h`
      <a href="${`#/maerkte/${c.key}`}" aria-current="${c.key === cls}">${c.title}</a>`)}</nav>
    <div id="subtabs"></div>
    <div id="list"><p class="muted" style="margin-top:24px">Lädt Kurse …</p></div>
    ${cls === 'derivate' ? h`<p class="note">Futures stammen von Yahoo Finance (CME/ICE, verzögert). Optionsketten findest du auf der Detailseite von US-Aktien und US-ETFs. Hebelprodukte wie Optionsscheine oder Knock-outs sind über freie Datenquellen nicht verfügbar.</p>` : ''}
    ${cls === 'anleihen' ? h`<p class="note">Einzelanleihen sind über freie Datenquellen kaum verfügbar. Die Liste zeigt Staatsanleiherenditen (Prozent, Veränderung in Prozentpunkten) sowie liquide Anleihe-ETFs.</p>` : ''}
  </div>`;

  let sortKey = null; let sortDir = 1; let data = null;

  async function load() {
    data = await api(`top/${cls}${screen ? `?screen=${encodeURIComponent(screen)}` : ''}`);
    render();
  }

  function render() {
    const sub = view.querySelector('#subtabs');
    sub.innerHTML = data.screens.length > 1 ? html`<div class="subtabs">${data.screens.map((s) => h`
      <a href="${`#/maerkte/${cls}${s.key === 'kuratiert' ? '' : `/${s.key}`}`}" aria-current="${s.key === data.screen}">${s.title}</a>`)}</div>` : '';
    let items = [...data.items];
    if (sortKey) {
      items.sort((a, b) => {
        const va = a[sortKey]; const vb = b[sortKey];
        if (va == null) return 1; if (vb == null) return -1;
        return (typeof va === 'string' ? va.localeCompare(vb, 'de') : va - vb) * sortDir;
      });
    }
    const th = (key, label, cls2 = '') => h`<th class="${cls2}"><button data-sort="${key}" ${raw(sortKey === key ? `data-dir="${sortDir > 0 ? '↑' : '↓'}"` : '')}>${label}</button></th>`;
    view.querySelector('#list').innerHTML = items.length ? html`
      <div class="table-wrap" style="margin-top:18px"><table class="data">
        <thead><tr>${th('name', 'Name')}${th('price', 'Kurs')}${th('change_pct', 'Heute')}<th class="hide-sm">Börse</th><th><span class="sr-only">Sammlung</span></th></tr></thead>
        <tbody>${items.map((q) => h`
          <tr data-href="${`#/i/${encodeURIComponent(q.symbol)}`}">
            <td><div class="cell-name"><b>${q.name}</b><span>${q.symbol}</span></div></td>
            <td class="num">${q.unavailable ? h`<span class="faint">nicht verfügbar</span>` : price(q.price, q.currency, { yield: q.is_yield })}</td>
            <td class="num ${tone(q.change_pct)}">${q.is_yield ? deltaPP(q.change) : pct(q.change_pct)}</td>
            <td class="hide-sm muted" style="font-size:13px">${q.exchange || ''}</td>
            <td>${starButton(q.symbol, q.name)}</td>
          </tr>`)}</tbody></table></div>`
      : '<p class="empty">Diese Liste ist gerade leer.</p>';
  }

  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    if (sortKey === b.dataset.sort) sortDir *= -1; else { sortKey = b.dataset.sort; sortDir = sortKey === 'name' ? 1 : -1; }
    render();
  });

  try { await load(); } catch (err) { view.querySelector('#list').innerHTML = errorBox(err); }
  state.refresh = () => load().catch(() => {});
}

/* ------------------------------------------------------------------ Detail */
async function instrumentView(view, symbol) {
  view.innerHTML = html`<div class="page"><div class="hero">
    <div class="hero__eyebrow"><span class="skeleton">Aktien · Börse</span></div>
    <h1 class="hero__title"><span class="skeleton">Instrument wird geladen</span></h1></div></div>`;
  let inst;
  try { inst = await api(`instrument?s=${encodeURIComponent(symbol)}`); } catch (err) {
    view.innerHTML = html`<div class="page"><div class="hero"><span class="label">${symbol}</span>
      <h1 class="hero__title">Nicht gefunden</h1></div>${raw(errorBox(err))}
      <p class="muted">Prüfe das Symbol (Yahoo-Schreibweise, z. B. <code>SAP.DE</code>, <code>EURUSD=X</code>, <code>BTC-EUR</code>) oder nutze die Suche.</p></div>`;
    return;
  }
  const q = inst.quote;
  const isYield = q.is_yield;
  const inColl = state.collection.has(symbol);
  document.title = `${q.name} · Kursbuch`;
  state.cleanup.push(() => { document.title = 'Kursbuch'; });

  view.innerHTML = html`<div class="page">
    <div class="hero">
      <div class="hero__eyebrow">
        <a class="label" href="${`#/maerkte/${q.asset_class}`}">${inst.asset_class_title}</a>
        <span class="mono">${symbol}</span>
        ${q.exchange ? h`<span>${q.exchange}</span>` : ''}
        ${q.currency ? h`<span>${q.currency}</span>` : ''}
      </div>
      <h1 class="hero__title">${q.name}</h1>
      <div class="hero__row">
        <div>
          <div class="hero__value" id="i-value"></div>
          <div class="hero__delta" id="i-delta"></div>
        </div>
        <div class="hero__actions">
          <button class="btn btn--ghost ${inColl ? 'btn--on' : ''}" data-star="${symbol}" data-name="${q.name}" aria-pressed="${inColl}">${raw(ICONS.star.replace('<svg', '<svg width="16" height="16"'))}<span> ${inColl ? 'In Sammlung' : 'Sammlung'}</span></button>
          ${isYield ? '' : h`<button class="btn" id="add-pos">Position erfassen</button>`}
        </div>
      </div>
    </div>
    <div id="i-chart"></div>
    ${rangeBar('1J')}
    <div id="i-position"></div>
    <div id="i-analysis"><div class="section"><div class="section__head"><h2>Einschätzung</h2></div><p class="muted">Berechne Kennzahlen aus bis zu zehn Jahren Kurshistorie …</p></div></div>
    <div id="i-funda"></div>
    <div id="i-options"></div>
    <p class="disclaimer">Daten: ${inst.provider}. ${inst.delay_note}. Analytische Auswertung ohne Gewähr – keine Anlageberatung.</p>
  </div>`;

  const valueEl = view.querySelector('#i-value');
  const deltaEl = view.querySelector('#i-delta');
  const setHero = (value, delta, deltaPct, when) => {
    valueEl.innerHTML = isYield ? html`${num(value, 3)}<span class="ccy">%</span>`
      : html`${price(value, null)}<span class="ccy">${q.currency ? raw(esc(currencyShort(q.currency))) : ''}</span>`;
    deltaEl.innerHTML = html`<span class="${tone(delta)}">${isYield ? deltaPP(delta) : `${delta > 0 ? '+' : ''}${price(delta, null)}`}</span>
      ${isYield ? '' : h`<span class="${tone(delta)}">(${pct(deltaPct)})</span>`}<span class="when">${when}</span>`;
  };
  let live = q;
  const defaultHero = () => setHero(live.price, live.change, live.change_pct, 'Heute');
  defaultHero();

  const addBtn = view.querySelector('#add-pos');
  addBtn?.addEventListener('click', () => openPositionDialog(symbol, q, () => { renderPosition(); }));

  mountChart({
    container: view.querySelector('#i-chart'),
    ranges: view.querySelector('.ranges'),
    yieldMode: isYield,
    load: (r) => api(`chart?s=${encodeURIComponent(symbol)}&range=${r}`),
    onHover: (p, data) => {
      if (!data) return;
      const base = data.baseline;
      if (!p) {
        if (data.range === '1T' || !data.points?.length) { defaultHero(); return; }
        setHero(live.price, live.price - base, base ? live.price / base - 1 : null, `seit ${dateTime(data.points[0][0], false)}`);
        return;
      }
      setHero(p.value, p.value - base, base ? p.value / base - 1 : null, dateTime(p.ts, data.intraday));
    },
  });

  async function renderPosition() {
    const box = view.querySelector('#i-position');
    try {
      const pf = await api('portfolio');
      const hold = pf.holdings.find((x) => x.symbol === symbol);
      if (!hold) { box.innerHTML = ''; return; }
      box.innerHTML = html`<div class="section">
        <div class="section__head"><h2>Deine Position</h2><span class="aside">${pct(hold.weight, 1, false)} des Depots</span></div>
        <dl class="facts">
          ${fact('Stück', num(hold.quantity, hold.quantity % 1 ? 4 : 0))}
          ${fact('Ø Kaufkurs', price(hold.avg_price, hold.currency))}
          ${fact('Wert', price(hold.value, hold.currency))}
          ${fact('Wert in EUR', money(hold.value_eur))}
          ${fact('G/V', h`<span class="${tone(hold.pnl)}">${price(hold.pnl, hold.currency)}</span>`)}
          ${fact('G/V %', h`<span class="${tone(hold.pnl_pct)}">${pct(hold.pnl_pct)}</span>`)}
        </dl>
        <ul class="lots">${hold.lots.map((l) => h`<li>
          <span>${num(l.quantity, l.quantity % 1 ? 4 : 0)} × ${price(l.price, hold.currency)}${l.bought_on ? ` · ${new Date(l.bought_on).toLocaleDateString('de-DE')}` : ''}</span>
          <button class="icon-btn" data-del-lot="${l.id}" title="Kauf löschen">${raw(ICONS.trash)}</button></li>`)}</ul>
      </div>`;
    } catch (err) { box.innerHTML = errorBox(err); }
  }
  view.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del-lot]');
    if (!del) return;
    if (!confirm('Diesen Kauf aus dem Depot löschen?')) return;
    try { await api(`positions/${del.dataset.delLot}`, { method: 'DELETE' }); toast('Kauf gelöscht'); renderPosition(); } catch (err) { toast(err.message); }
  });
  renderPosition();

  renderFundamentals(view.querySelector('#i-funda'), inst);
  loadAnalysis(view.querySelector('#i-analysis'), symbol, inst);
  if (inst.has_options) renderOptions(view.querySelector('#i-options'), symbol, q);

  state.refresh = async () => {
    try {
      const fresh = await api(`instrument?s=${encodeURIComponent(symbol)}`);
      live = fresh.quote;
      if (!view.querySelector('.chart__cross[visibility="visible"]')) defaultHero();
    } catch { /* still */ }
  };
}

const currencyShort = (c) => ({ EUR: '€', USD: '$', GBP: '£', JPY: '¥', GBp: 'p' }[c] ?? ` ${c}`);

function renderFundamentals(box, inst) {
  const f = inst.fundamentals || {};
  const q = inst.quote;
  const cls = q.asset_class;
  const rows = [];
  if (cls === 'aktien') {
    rows.push(
      fact('Marktkapitalisierung', compact(f.market_cap, q.currency)),
      fact('KGV', num(f.trailing_pe), 'Kurs-Gewinn-Verhältnis, letzte 12 Monate'),
      fact('KGV erwartet', num(f.forward_pe), 'Auf Basis der Analystenschätzungen'),
      fact('KBV', num(f.price_to_book), 'Kurs-Buchwert-Verhältnis'),
      fact('KUV', num(f.price_to_sales), 'Kurs-Umsatz-Verhältnis, 12 Monate'),
      fact('EV/EBITDA', num(f.ev_to_ebitda)),
      fact('Gewinn je Aktie', price(f.trailing_eps, q.currency)),
      fact('Dividendenrendite', pct(f.dividend_yield_ttm, 2, false), 'Summe der Ausschüttungen der letzten 12 Monate / Kurs'),
      fact('Eigenkapitalrendite', pct(f.return_on_equity, 1, false)),
      fact('Bruttomarge', pct(f.gross_margin, 1, false)),
      fact('Operative Marge', pct(f.operating_margin, 1, false)),
      fact('Nettomarge', pct(f.profit_margin, 1, false)),
      fact('Umsatzwachstum', pct(f.revenue_growth, 1), 'Quartal gg. Vorjahresquartal'),
      fact('Verschuldungsgrad', f.debt_to_equity != null ? `${num(f.debt_to_equity)}×` : '—', 'Finanzverbindlichkeiten / Eigenkapital'),
      fact('Ausschüttungsquote', pct(f.payout_ratio, 1, false)),
      fact('Sektor', f.sector || '—'),
      fact('Branche', f.industry || '—'),
      fact('Land', f.country || '—'),
      fact('Mitarbeiter', f.employees ? num(f.employees, 0) : '—'),
    );
  } else if (cls === 'etf' || cls === 'fonds' || (cls === 'anleihen' && f.total_assets)) {
    rows.push(
      fact('Fondsvolumen', compact(f.total_assets, q.currency)),
      fact('Kostenquote', f.expense_ratio_pct != null ? `${num(f.expense_ratio_pct)} %` : '—', 'Laufende Kosten laut Yahoo Finance'),
      fact('Ausschüttungsrendite', pct(f.dividend_yield_ttm, 2, false), 'Ausschüttungen der letzten 12 Monate / Kurs'),
      fact('Anbieter', f.fund_family || '—'),
      fact('Kategorie', f.category || '—'),
    );
  }
  const analyst = cls === 'aktien' && f.analyst_count ? h`
    <div class="section">
      <div class="section__head"><h2>Analystenkonsens</h2><span class="aside">${f.analyst_count} Analysten · Yahoo Finance</span></div>
      <dl class="facts">
        ${fact('Empfehlung', ratingDe(f.analyst_rating))}
        ${fact('Durchschnitt', f.analyst_mean ? `${num(f.analyst_mean, 2)} / 5` : '—', '1 = Strong Buy … 5 = Strong Sell')}
        ${fact('Kursziel Ø', price(f.target_mean, q.currency))}
        ${fact('Potenzial', pct(f.target_mean && q.price ? f.target_mean / q.price - 1 : null, 1))}
        ${fact('Kursziel Spanne', f.target_low ? `${price(f.target_low)} – ${price(f.target_high)}` : '—')}
      </dl>
      <p class="disclaimer">Der Analystenkonsens wird nur angezeigt und fließt nicht in die Einschätzung ein.</p>
    </div>` : '';
  box.innerHTML = html`
    ${rows.length ? h`<div class="section"><div class="section__head"><h2>Fundamentaldaten</h2><span class="aside">Yahoo Finance</span></div><dl class="facts">${rows}</dl></div>` : ''}
    ${analyst}
    ${f.summary ? h`<div class="section"><div class="section__head"><h2>Über</h2>${f.website ? h`<a class="aside link" href="${f.website}" target="_blank" rel="noopener noreferrer">Website ↗</a>` : ''}</div>
      <p class="summary clamp" id="summary">${f.summary}</p><button class="link" id="more" type="button">Mehr anzeigen</button></div>` : ''}`;
  box.querySelector('#more')?.addEventListener('click', (e) => {
    const s = box.querySelector('#summary'); s.classList.toggle('clamp');
    e.target.textContent = s.classList.contains('clamp') ? 'Mehr anzeigen' : 'Weniger anzeigen';
  });
}

const ratingDe = (k) => ({ strong_buy: 'Stark kaufen', buy: 'Kaufen', hold: 'Halten', underperform: 'Untergewichten', sell: 'Verkaufen', strong_sell: 'Stark verkaufen' }[k] || '—');

function refLinks(keys) {
  return h`<sup>${keys.map((k, i) => h`<a href="${`#/methodik/${k}`}" title="${REFS[k]?.text || k}">${REF_ORDER.indexOf(k) + 1}</a>${i < keys.length - 1 ? ',' : ''}`)}</sup>`;
}

async function loadAnalysis(box, symbol, inst) {
  let a;
  try { a = await api(`analysis?s=${encodeURIComponent(symbol)}`); } catch (err) {
    box.innerHTML = html`<div class="section"><div class="section__head"><h2>Einschätzung</h2></div>${raw(errorBox(err))}</div>`;
    return;
  }
  const q = inst.quote;
  const s = a.signal;
  const m = a.metrics;
  const t = m.technical; const r = m.risk; const ret = m.returns;
  const isYield = q.is_yield;
  const word = { Kaufen: 'buy', Verkaufen: 'sell', Halten: 'hold' }[s.label] || 'na';
  const pos = (v) => `${((Math.max(-1, Math.min(1, v)) + 1) / 2) * 100}%`;
  const ccy = isYield ? null : q.currency;
  const pv = (v) => (isYield ? `${num(v, 3)} %` : price(v, ccy));

  const verdict = s.score == null ? h`
    <div class="section"><div class="section__head"><h2>Einschätzung</h2></div>
      <p class="verdict__word na">Keine Einschätzung</p>${s.notes.map((n) => h`<p class="note">${n}</p>`)}</div>` : h`
    <div class="section">
      <div class="section__head"><h2>Einschätzung</h2><span class="aside">Regelbasiert · ${new Date(a.generated_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</span></div>
      <div class="verdict">
        <div>
          <p class="verdict__word ${word}">${s.label}</p>
          <div class="verdict__score">Score ${num(s.score, 2)} auf einer Skala von −1 bis +1</div>
          <div class="verdict__stats">
            <div><span title="Gewichteter Anteil der Faktoren, die in Richtung des Gesamtscores zeigen">Konsistenz</span><b>${pct(s.agreement, 0, false)}</b></div>
            <div><span title="Anteil der berechenbaren Faktorgewichte">Datenabdeckung</span><b>${pct(s.coverage, 0, false)}</b></div>
            ${s.risk_levels ? h`
              <div><span title="${s.risk_levels.method}">Stop (2×ATR)</span><b>${pv(s.risk_levels.stop)}</b></div>
              <div><span title="${s.risk_levels.method}">Ziel (3×ATR)</span><b>${pv(s.risk_levels.target)}</b></div>` : ''}
          </div>
        </div>
        <div>
          <div class="scale" aria-hidden="true">
            <span class="scale__zone" style="left:0">Verkaufen</span>
            <span class="scale__zone" style="left:50%;transform:translateX(-50%)">Halten</span>
            <span class="scale__zone" style="right:0">Kaufen</span>
            <div class="scale__track"></div>
            <div class="scale__tick" style="left:0"></div>
            <div class="scale__tick" style="${`left:${pos(s.thresholds.sell)}`}"></div>
            <div class="scale__tick" style="${`left:${pos(s.thresholds.buy)}`}"></div>
            <div class="scale__tick" style="left:calc(100% - 1px)"></div>
            <div class="scale__marker" style="${`left:${pos(s.score)}`}" data-v="${num(s.score, 2)}"></div>
          </div>
          <ul class="factors">${s.factors.map((f) => h`
            <li class="factor ${f.score == null ? 'factor--off' : ''}">
              <div><div class="factor__title">${f.title}${refLinks(f.refs)}</div><div class="factor__desc">${f.description}${f.score == null ? ' – nicht verfügbar' : ''}</div></div>
              <div class="factor__bar" title="${f.score == null ? '' : `Score ${num(f.score, 2)}`}">${f.score == null ? '' : h`<i class="${f.score >= 0 ? 'pos' : 'neg'}" style="${`width:${Math.abs(f.score) * 50}%`}"></i>`}</div>
              <div class="factor__w">${f.score == null ? '—' : pct(f.weight, 0, false)}</div>
            </li>`)}</ul>
        </div>
      </div>
      ${s.notes.map((n) => h`<p class="note">${n}</p>`)}
      <p class="disclaimer">Gewichteter Mittelwert literaturgestützter Faktoren; Kaufen ab +${num(s.thresholds.buy, 2)}, Verkaufen ab ${num(s.thresholds.sell, 2)}.
        Die zugrunde liegenden Studien belegen Effekte für breit gestreute Portfolios – für einen Einzelwert ist das keine Prognose und keine Anlageberatung. <a class="link" href="#/methodik">Methodik &amp; Quellen</a></p>
    </div>`;

  const perf = isYield ? '' : h`<div class="section">
    <div class="section__head"><h2>Wertentwicklung</h2><span class="aside">inkl. Dividenden (adjustierte Kurse)</span></div>
    <div class="perf">${[['1M', ret['1m']], ['3M', ret['3m']], ['6M', ret['6m']], ['YTD', ret.ytd], ['1J', ret['1y']], ['3J', ret['3y']], ['5J', ret['5y']], ['p. a.', ret.cagr]].map(([k, v]) => h`
      <div><span>${k}</span><b class="${isYield ? '' : tone(v)}">${isYield ? '—' : pct(v, 1)}</b></div>`)}</div>
  </div>`;

  const figures = h`<div class="section">
    <div class="section__head"><h2>Kennzahlen</h2><span class="aside">${m.first_date ? `${new Date(m.first_date).toLocaleDateString('de-DE')} – ${new Date(m.last_date).toLocaleDateString('de-DE')} · ${num(m.observations, 0)} Tage` : ''}</span></div>
    <dl class="facts">
      ${fact('52W Hoch', pv(t.high_52w))}
      ${fact('52W Tief', pv(t.low_52w))}
      ${isYield ? '' : fact('Abstand 52W Hoch', pct(t.high_52w_ratio != null ? t.high_52w_ratio - 1 : null, 1))}
      ${isYield ? '' : h`
      ${fact('Volatilität 1J', pct(r.volatility_1y, 1, false), 'Annualisierte Standardabweichung der Log-Renditen')}
      ${fact('Volatilität 3M', pct(r.volatility_3m, 1, false))}
      ${fact('Max. Drawdown', pct(r.max_drawdown, 1), 'Größter Verlust vom Höchststand, gesamte Historie')}
      ${fact('Drawdown 1J', pct(r.max_drawdown_1y, 1))}
      ${fact('Aktueller Drawdown', pct(r.current_drawdown, 1))}
      ${fact('Sharpe 1J', num(r.sharpe_1y), 'Annualisiert, risikofreier Zins = 0')}
      ${fact('Sortino 1J', num(r.sortino_1y), 'Zielrendite 0')}
      ${a.assumptions.benchmark ? fact('Beta 1J', num(r.beta_1y), 'Gegenüber S&P 500, tägliche Renditen') : ''}
      `}
      ${fact('SMA 50', pv(t.sma50), 'Gleitender Durchschnitt, 50 Tage')}
      ${fact('SMA 200', pv(t.sma200), 'Gleitender Durchschnitt, 200 Tage')}
      ${fact('Abstand SMA 200', pct(t.dist_sma200, 1))}
      ${fact('SMA 50 / 200', t.golden_cross == null ? '—' : t.golden_cross ? 'Golden Cross' : 'Death Cross')}
      ${fact('RSI 14', num(t.rsi14, 1), 'Relative Strength Index nach Wilder; >70 überkauft, <30 überverkauft')}
      ${fact('MACD', num(t.macd, 3), 'EMA12 − EMA26')}
      ${fact('MACD Signal', num(t.macd_signal, 3))}
      ${fact('Bollinger %B', num(t.boll_pct_b, 2), 'Position im 20-Tage-Band (0 = unteres, 1 = oberes Band)')}
      ${fact('ATR 14', pv(t.atr14), 'Average True Range – typische Tagesspanne')}
      ${isYield ? '' : fact('Momentum 12-1', pct(t.momentum_12_1, 1), 'Rendite von vor 12 bis vor 1 Monat')}
    </dl>
  </div>`;

  const bt = a.backtest;
  const backtest = bt ? h`<div class="section">
    <div class="section__head"><h2>Trendregel im Rückblick</h2><span class="aside">${new Date(bt.start).toLocaleDateString('de-DE')} – ${new Date(bt.end).toLocaleDateString('de-DE')}</span></div>
    <p class="muted" style="max-width:72ch;margin-top:0">Investiert, solange der Vortagesschluss über dem 200-Tage-Durchschnitt lag, sonst Cash (0 %). ${num(bt.cost_bps, 0)} Basispunkte Kosten je Wechsel, ${bt.switches} Wechsel, ${pct(bt.exposure, 0, false)} der Zeit investiert.</p>
    <ul class="legend" style="margin:12px 0"><li><i style="background:var(--accent)"></i>Trendregel</li><li><i style="background:var(--ink-3)"></i>Kaufen &amp; Halten</li></ul>
    <div id="bt-chart" style="height:200px"></div>
    <div class="table-wrap"><table class="data" style="margin-top:14px">
      <thead><tr><th></th><th>Rendite p. a.</th><th>Volatilität</th><th>Max. Drawdown</th><th>Sharpe</th><th>Gesamt</th></tr></thead>
      <tbody>${[['Trendregel', bt.strategy], ['Kaufen & Halten', bt.buy_hold]].map(([n, x]) => h`<tr style="cursor:default">
        <td>${n}</td><td class="num ${tone(x.cagr)}">${pct(x.cagr, 1)}</td><td class="num">${pct(x.volatility, 1, false)}</td>
        <td class="num">${pct(x.max_drawdown, 1)}</td><td class="num">${num(x.sharpe)}</td><td class="num ${tone(x.total_return)}">${pct(x.total_return, 0)}</td></tr>`)}</tbody>
    </table></div>
    <p class="disclaimer">In-Sample-Rückblick auf einem Einzelwert ohne Steuern. Historische Ergebnisse technischer Regeln sind anfällig für Data-Snooping${refLinks(['sullivan1999', 'park2007'])} und sagen nichts über künftige Renditen aus.</p>
  </div>` : '';

  box.innerHTML = html`${verdict}${perf}${figures}${backtest}`;
  if (bt) {
    const el = box.querySelector('#bt-chart');
    const draw = () => multiLine(el, [
      { values: bt.equity.map((e) => e[2]), color: 'var(--ink-3)' },
      { values: bt.equity.map((e) => e[1]), color: 'var(--accent)' },
    ], bt.equity.map((e) => e[0]));
    draw();
    const ro = new ResizeObserver(debounce(draw, 100));
    ro.observe(el);
    state.cleanup.push(() => ro.disconnect());
  }
}

async function renderOptions(box, symbol, q) {
  box.innerHTML = html`<div class="section"><div class="section__head"><h2>Optionskette</h2><span class="aside">US-Listing · Yahoo Finance</span></div><div id="opt-body"><p class="muted">Lädt …</p></div></div>`;
  const body = box.querySelector('#opt-body');
  async function load(expiry) {
    try {
      const o = await api(`options?s=${encodeURIComponent(symbol)}${expiry ? `&expiry=${expiry}` : ''}`);
      if (!o.expiries.length) { box.innerHTML = ''; return; }
      const near = (rows) => {
        const idx = rows.findIndex((r) => r.strike >= q.price);
        const c = idx < 0 ? rows.length - 1 : idx;
        return rows.slice(Math.max(0, c - 8), c + 8);
      };
      const table = (title, rows) => h`<div style="min-width:0"><h3 class="label" style="margin:16px 0 0">${title}</h3>
        <div class="table-wrap"><table class="data"><thead><tr><th>Strike</th><th>Geld</th><th>Brief</th><th class="hide-sm">Letzter</th><th>IV</th><th class="hide-sm">Open Int.</th></tr></thead>
        <tbody>${near(rows).map((r) => h`<tr style="cursor:default${r.inTheMoney ? ';background:var(--paper-2)' : ''}">
          <td class="num"><b>${num(r.strike)}</b></td><td class="num">${num(r.bid)}</td><td class="num">${num(r.ask)}</td>
          <td class="num hide-sm">${num(r.lastPrice)}</td><td class="num">${pct(r.impliedVolatility, 1, false)}</td><td class="num hide-sm">${r.openInterest != null ? num(r.openInterest, 0) : '—'}</td></tr>`)}</tbody></table></div></div>`;
      body.innerHTML = html`
        <label class="field" style="max-width:220px"><span class="label">Verfall</span>
          <select id="expiry">${o.expiries.map((e) => h`<option value="${e}" ${raw(e === o.expiry ? 'selected' : '')}>${new Date(e).toLocaleDateString('de-DE')}</option>`)}</select></label>
        <div class="split" style="grid-template-columns:1fr 1fr;gap:32px">${table('Calls', o.calls)}${table('Puts', o.puts)}</div>
        <p class="disclaimer">Hinterlegt: im Geld. Strikes um den aktuellen Kurs (${price(q.price, q.currency)}). Implizite Volatilität laut Yahoo.</p>`;
      body.querySelector('#expiry').addEventListener('change', (e) => load(e.target.value));
    } catch (err) { body.innerHTML = errorBox(err); }
  }
  load();
}

/* ------------------------------------------------------------------ Dialog */
function openPositionDialog(symbol, q, done) {
  const dlg = document.getElementById('pos-dialog');
  const today = new Date().toISOString().slice(0, 10);
  dlg.innerHTML = html`
    <h2>Position erfassen</h2>
    <p class="muted" style="margin:0">${q.name} · <span class="mono">${symbol}</span></p>
    <form method="dialog" id="pos-form">
      <label class="field"><span class="label">Stückzahl</span><input name="quantity" type="number" step="any" min="0" required inputmode="decimal"></label>
      <label class="field"><span class="label">Kaufkurs je Stück (${q.currency || ''})</span><input name="price" type="number" step="any" min="0" required inputmode="decimal" value="${q.price != null ? +q.price.toPrecision(8) : ''}"></label>
      <label class="field"><span class="label">Kaufdatum</span><input name="bought_on" type="date" max="${today}" value="${today}"></label>
      <p class="login__error" id="pos-err"></p>
      <div class="actions"><button class="btn btn--ghost" value="cancel" formnovalidate>Abbrechen</button><button class="btn" value="save">Speichern</button></div>
    </form>`;
  const form = dlg.querySelector('form');
  form.addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    try {
      await api('positions', { method: 'POST', body: {
        symbol, quantity: parseFloat(form.quantity.value), price: parseFloat(form.price.value), bought_on: form.bought_on.value || null,
      } });
      state.collection.add(symbol);
      dlg.close();
      toast('Position gespeichert');
      done?.();
    } catch (err) { dlg.querySelector('#pos-err').textContent = err.message; }
  });
  dlg.showModal();
  form.quantity.focus();
}

/* ------------------------------------------------------------------ Methodik */
function methodikView(view) {
  const target = location.hash.split('/')[2];
  view.innerHTML = html`<div class="page"><div class="prose">
    <div class="hero"><span class="label">Methodik</span><h1 class="hero__title">Wie die Einschätzung entsteht</h1></div>
    <p>Kursbuch berechnet alle Kennzahlen selbst aus täglichen, um Dividenden und Splits bereinigten Schlusskursen (bis zu zehn Jahre).
    Die Einschätzung <strong>Kaufen / Halten / Verkaufen</strong> ist ein gewichteter Mittelwert einzelner Faktoren im Bereich −1 bis +1.
    Jeder Faktor beruht auf einem in begutachteter Literatur dokumentierten Effekt. Alle Gewichte, Normierungen und Schwellen stehen offen im Quellcode
    (<code>backend/app/signals.py</code>).</p>

    <h2>Faktoren</h2>
    <h3>Trend (25 %)</h3>
    <p>Abstand des Kurses zum 200-Tage-Durchschnitt, geglättet über tanh(Abstand / 5 %). Einfache Durchschnittsregeln wurden für den Dow Jones über ein Jahrhundert untersucht${refLinks(['brock1992'])} und als Timing-Regel für Anlageklassen beschrieben${refLinks(['faber2007'])}.</p>
    <h3>Momentum 12-1 (25 %)</h3>
    <p>Rendite von vor zwölf bis vor einem Monat, geteilt durch die Jahresvolatilität. Querschnitts-Momentum${refLinks(['jegadeesh1993'])}, Zeitreihen-Momentum über Anlageklassen hinweg${refLinks(['moskowitz2012'])}; Volatilitätsskalierung mildert Momentum-Crashs${refLinks(['barroso2015'])}.</p>
    <h3>Nähe zum 52-Wochen-Hoch (15 %)</h3>
    <p>Kurs / 52-Wochen-Hoch; 1,0 ergibt +1, 0,85 ergibt 0, ≤ 0,70 ergibt −1${refLinks(['george2004'])}.</p>
    <h3>Risiko (15 %)</h3>
    <p>Jahresvolatilität relativ zu einer Referenz je Anlageklasse (z. B. Aktien 30 %, ETFs 18 %, Krypto 70 %). Hohe Volatilität ging historisch mit schwächeren risikobereinigten Renditen einher${refLinks(['ang2006', 'frazzini2014', 'moreira2017'])}.</p>
    <h3>Nur Einzelaktien: Kurzfrist-Umkehr, Bewertung, Profitabilität (je 10 %)</h3>
    <p>Starke Monatsgewinner zeigen kurzfristig eine leichte Gegenbewegung${refLinks(['jegadeesh1990', 'lehmann1990'])}. Bewertung über Gewinnrendite (1/KGV) und Buchwertrendite (1/KBV)${refLinks(['basu1977', 'fama1992'])}. Profitabilität über Eigenkapitalrendite und Bruttomarge${refLinks(['novymarx2013', 'fama2015'])}.</p>

    <h2>Grenzen</h2>
    <p>Die Studien messen Effekte im Querschnitt vieler Wertpapiere bzw. in diversifizierten Portfolios. Auf einen Einzelwert übertragen ist das Signal eine <strong>strukturierte Zusammenfassung</strong>, keine Prognose.
    Veröffentlichte Anomalien schwächen sich nach Publikation ab${refLinks(['mclean2016'])}, viele Faktoren sind statistisch fragil${refLinks(['harvey2016'])}, und Erfolge technischer Regeln sind anfällig für Data-Snooping${refLinks(['sullivan1999', 'park2007'])}.
    Die Normierungsschwellen (z. B. Referenz-KGV 20) sind Heuristiken dieses Projekts. Der Analystenkonsens wird nur angezeigt.</p>
    <p>Stop- und Zielmarken (2× bzw. 3× ATR) sind volatilitätsbasierte Orientierungshilfen${refLinks(['wilder1978'])}, keine Order-Empfehlung.</p>

    <h2>Kennzahlen</h2>
    <p>Volatilität: Standardabweichung der täglichen Log-Renditen × √252 (Krypto √365). Sharpe- und Sortino-Ratio mit risikofreiem Zins 0${refLinks(['sharpe1994', 'sortino1994'])}. Beta gegenüber dem S&amp;P 500 aus 252 Tagesrenditen${refLinks(['sharpe1964'])}.
    RSI und ATR nach Wilder${refLinks(['wilder1978'])}, MACD (12/26/9)${refLinks(['appel2005'])}, Bollinger-Bänder (20 Tage, 2σ)${refLinks(['bollinger2001'])}. Dividendenrendite: tatsächliche Ausschüttungen der letzten zwölf Monate geteilt durch den Kurs.</p>

    <h2>Daten</h2>
    <p>Quelle: ${state.meta.provider}. ${state.meta.delay_note}. Yahoo Finance hat keine offizielle API; Ausfälle und Datenfehler sind möglich. Nur für private Nutzung.</p>

    <h2>Literatur</h2>
    <ol class="refs">${REF_ORDER.map((k, i) => h`<li id="${`ref-${k}`}"><code>[${i + 1}] ${k}</code><span>${REFS[k].text}${REFS[k].doi ? h` <a href="${`https://doi.org/${REFS[k].doi}`}" target="_blank" rel="noopener noreferrer">doi:${REFS[k].doi}</a>` : ''}</span></li>`)}</ol>
  </div></div>`;
  if (target) document.getElementById(`ref-${target}`)?.scrollIntoView({ block: 'center' });
}

/* ------------------------------------------------------------------ Start */
boot();
