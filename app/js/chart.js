// A small line chart drawn as SVG, on a scale the caller fixes (so weeks compare fairly).
import { html, raw, esc } from './util.js';
import { fmtNum } from './training.js';

const W = 320;
const H = 150;
const PAD = { l: 38, r: 14, t: 14, b: 26 };

/** A rounded scale that holds every value, with a little room above and below. */
export function niceScale(values) {
  const v = values.filter((x) => x != null);
  if (!v.length) return null;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || Math.max(1, Math.abs(max) * 0.1);
  const step = span > 40 ? 10 : span > 8 ? 5 : span > 2 ? 1 : 0.5;
  const lo = Math.max(0, Math.floor((min - span * 0.15) / step) * step);
  const hi = Math.ceil((max + span * 0.15) / step) * step;
  return { lo, hi: hi > lo ? hi : lo + step };
}

/**
 * points: [{ x: 0..1, y }], scale: { lo, hi }, xLabels: [{ x: 0..1, text }].
 * label: what the chart says to a screen reader.
 */
export function lineChart({ points, scale, xLabels, label, unit = '' }) {
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const px = (x) => PAD.l + x * iw;
  const py = (y) => PAD.t + (1 - (y - scale.lo) / (scale.hi - scale.lo)) * ih;
  const pts = points.filter((p) => p.y != null);
  // an empty week breaks the line, so a gap shows as a gap
  const runs = [];
  let run = [];
  for (const p of points) {
    if (p.y == null) { if (run.length) runs.push(run); run = []; } else run.push(p);
  }
  if (run.length) runs.push(run);
  const lines = runs.filter((r) => r.length > 1).map((r) => r.map((p) => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' '));
  const last = pts[pts.length - 1];
  const grid = [scale.lo, (scale.lo + scale.hi) / 2, scale.hi];
  return html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
    ${grid.map((g, i) => raw(`<line class="grid${i ? '' : ' base'}" x1="${PAD.l}" x2="${W - PAD.r}" y1="${py(g)}" y2="${py(g)}"/>`))}
    ${[scale.lo, scale.hi].map((g) => raw(`<text class="axis" x="${PAD.l - 6}" y="${py(g) + 4}" text-anchor="end">${esc(fmtNum(g))}</text>`))}
    ${xLabels.map((l) => raw(`<text class="axis" x="${px(l.x)}" y="${H - 7}" text-anchor="middle">${esc(l.text)}</text>`))}
    ${lines.map((l) => raw(`<polyline class="line" points="${l}"/>`))}
    ${pts.map((p) => raw(`<circle class="pt" cx="${px(p.x)}" cy="${py(p.y)}" r="4"/>`))}
    ${last ? raw(`<text class="val" x="${Math.min(px(last.x), W - PAD.r - 2)}" y="${py(last.y) - 10}" text-anchor="${px(last.x) > W - 60 ? 'end' : 'middle'}">${esc(fmtNum(last.y) + (unit ? ` ${unit}` : ''))}</text>`) : ''}
  </svg>`;
}
