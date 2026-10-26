// Schlanker SVG-Linienchart mit Fadenkreuz (Maus & Touch), ohne Abhängigkeiten.

import { dateTime, price } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

export function createChart(container, { onHover, yieldMode = false } = {}) {
  container.classList.add('chart');
  container.innerHTML = '';
  const svg = el('svg', { role: 'img', 'aria-label': 'Kursverlauf' });
  const msg = document.createElement('div');
  msg.className = 'chart__msg';
  container.append(svg, msg);

  let data = null;
  let geom = null;
  const pad = { t: 22, r: 8, b: 22, l: 8 };

  function draw() {
    svg.innerHTML = '';
    const w = container.clientWidth;
    const hgt = container.clientHeight;
    if (!data || !data.points?.length || w === 0) return;
    const pts = data.points;
    const values = pts.map((p) => p[1]);
    if (data.baseline != null) values.push(data.baseline);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    min -= span * 0.04; max += span * 0.04;
    const x = (i) => pad.l + (i / Math.max(pts.length - 1, 1)) * (w - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - min) / (max - min)) * (hgt - pad.t - pad.b);
    geom = { x, y, w, hgt };

    const last = pts[pts.length - 1][1];
    const ref = data.baseline ?? pts[0][1];
    const cls = last >= ref ? 'up' : 'down';

    if (data.baseline != null) {
      svg.append(el('line', { class: 'chart__base', x1: pad.l, x2: w - pad.r, y1: y(data.baseline), y2: y(data.baseline) }));
    }
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    svg.append(el('path', { class: `chart__line ${cls}`, d }));

    // Hoch/Tief beschriften (wie im Trade-Republic-Chart)
    let hi = 0; let lo = 0;
    pts.forEach((p, i) => { if (p[1] > pts[hi][1]) hi = i; if (p[1] < pts[lo][1]) lo = i; });
    const label = (i, above) => {
      const tx = Math.min(Math.max(x(i), 40), w - 40);
      const t = el('text', { class: 'chart__ext', x: tx, y: above ? y(pts[i][1]) - 8 : y(pts[i][1]) + 16, 'text-anchor': 'middle' });
      t.textContent = price(pts[i][1], null, { yield: yieldMode });
      svg.append(t);
    };
    if (pts.length > 2) { label(hi, true); if (lo !== hi) label(lo, false); }

    const cross = el('line', { class: 'chart__cross', y1: 0, y2: hgt, visibility: 'hidden' });
    const dot = el('circle', { class: 'chart__dot', r: 4.5, visibility: 'hidden' });
    const tip = el('text', { class: 'chart__tip', y: 11, visibility: 'hidden' });
    svg.append(cross, dot, tip);
    geom.hover = { cross, dot, tip };
  }

  function hoverAt(clientX) {
    if (!geom?.hover || !data?.points?.length) return;
    const rect = svg.getBoundingClientRect();
    const rel = (clientX - rect.left - pad.l) / (geom.w - pad.l - pad.r);
    const i = Math.round(Math.min(Math.max(rel, 0), 1) * (data.points.length - 1));
    const [ts, v] = data.points[i];
    const { cross, dot, tip } = geom.hover;
    const px = geom.x(i);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px);
    dot.setAttribute('cx', px); dot.setAttribute('cy', geom.y(v));
    tip.textContent = dateTime(ts, data.intraday);
    tip.setAttribute('x', Math.min(Math.max(px, 60), geom.w - 60));
    tip.setAttribute('text-anchor', 'middle');
    for (const n of [cross, dot, tip]) n.setAttribute('visibility', 'visible');
    onHover?.({ ts, value: v, index: i });
  }

  function leave() {
    if (geom?.hover) for (const n of Object.values(geom.hover)) n.setAttribute('visibility', 'hidden');
    onHover?.(null);
  }

  svg.addEventListener('pointermove', (e) => hoverAt(e.clientX));
  svg.addEventListener('pointerdown', (e) => hoverAt(e.clientX));
  svg.addEventListener('pointerleave', leave);
  svg.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') leave(); });
  svg.addEventListener('pointercancel', leave);

  const ro = new ResizeObserver(() => draw());
  ro.observe(container);

  return {
    set(next) {
      data = next;
      msg.textContent = next?.points?.length ? '' : 'Keine Kursdaten für diesen Zeitraum';
      draw();
    },
    loading() { data = null; svg.innerHTML = ''; msg.textContent = 'Lädt …'; },
    error(text) { data = null; svg.innerHTML = ''; msg.textContent = text; },
    destroy() { ro.disconnect(); },
  };
}

// Statischer Mehrlinienchart (Backtest): series = [{ values, cls, label }], dates = [iso]
export function multiLine(container, series, dates) {
  container.innerHTML = '';
  const w = container.clientWidth || 600;
  const hgt = container.clientHeight || 200;
  const all = series.flatMap((s) => s.values);
  const lmin = Math.log(Math.min(...all));
  const lmax = Math.log(Math.max(...all));
  const pad = { t: 10, r: 4, b: 20, l: 4 };
  const n = dates.length;
  const x = (i) => pad.l + (i / Math.max(n - 1, 1)) * (w - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (Math.log(v) - lmin) / (lmax - lmin || 1)) * (hgt - pad.t - pad.b);
  const svg = el('svg', { viewBox: `0 0 ${w} ${hgt}`, role: 'img', 'aria-label': 'Backtest-Verlauf (log. Skala)' });
  svg.style.width = '100%'; svg.style.height = `${hgt}px`;
  svg.append(el('line', { class: 'chart__base', x1: pad.l, x2: w - pad.r, y1: y(1), y2: y(1) }));
  for (const s of series) {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const path = el('path', { d, fill: 'none', 'stroke-width': 1.6, 'stroke-linejoin': 'round' });
    path.style.stroke = s.color;
    if (s.dash) path.setAttribute('stroke-dasharray', '4 3');
    svg.append(path);
  }
  for (const i of [0, n - 1]) {
    const t = el('text', { class: 'chart__ext', x: x(i), y: hgt - 4, 'text-anchor': i ? 'end' : 'start' });
    t.textContent = new Date(dates[i]).getFullYear();
    svg.append(t);
  }
  container.append(svg);
}
