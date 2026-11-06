// Shared UI pieces: toast, theme, small component builders.
import { html, icon, esc } from './util.js';

// ---------- toast (one at a time, with optional action) ----------
let toastTimer = null;
let toastEl = null;

export function toast(message, { action, duration = 5000 } = {}) {
  const region = document.getElementById('toasts');
  dismissToast(true);
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="msg">${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) {
    el.querySelector('button').addEventListener('click', async () => {
      dismissToast();
      await action.run();
    });
  }
  region.append(el);
  toastEl = el;
  startTimer(duration);
}

function startTimer(duration) {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dismissToast(), duration);
}

export function dismissToast(instant = false) {
  clearTimeout(toastTimer);
  const el = toastEl;
  toastEl = null;
  if (!el) return;
  if (instant) { el.remove(); return; }
  el.classList.add('is-leaving');
  setTimeout(() => el.remove(), 180);
}

// Pause the toast timer while the app is hidden, so an Undo isn't lost.
document.addEventListener('visibilitychange', () => {
  if (!toastEl) return;
  if (document.hidden) clearTimeout(toastTimer);
  else startTimer(3000);
});

// ---------- theme ----------
const THEME_BG = { light: '#FFB7C5', dark: '#0A3323', barnacles: '#9693D6' };

export function applyTheme(theme) {
  // remembered on this device so index.html can set it before first paint (no flash on launch)
  try { localStorage.setItem('training-theme', THEME_BG[theme] ? theme : 'system'); } catch { /* storage blocked */ }
  const root = document.documentElement;
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  if (THEME_BG[theme]) {
    root.dataset.theme = theme;
    metas.forEach((m) => m.setAttribute('content', THEME_BG[theme]));
  } else {
    delete root.dataset.theme;
    metas.forEach((m) => m.setAttribute('content', m.media.includes('dark') ? THEME_BG.dark : THEME_BG.light));
  }
}

// ---------- builders ----------

export const backLink = (href, label) =>
  html`<a class="back pressable" href="${href}">${icon('back')}<span>${label}</span></a>`;

/** Radio-based segmented control. options: [{value, label}] */
export function segmented(name, options, value, { label } = {}) {
  return html`<div class="seg" role="radiogroup" aria-label="${label || name}">
    ${options.map((o) => html`<label><input type="radio" name="${name}" value="${o.value}" ${o.value === value ? 'checked' : ''}><span>${o.label}</span></label>`)}
  </div>`;
}

export function stepper({ field, value, min, max, label, slot, week = '' }) {
  const attrs = html`data-action="step" data-slot="${slot}" data-field="${field}" data-week="${week}"`;
  return html`<div class="stepper" role="group" aria-label="${label}">
    <button type="button" ${attrs} data-delta="-1" aria-label="Decrease ${label}" ${value <= min ? 'disabled' : ''}>${icon('minus', 'icon-sm')}</button>
    <output aria-live="polite">${value}</output>
    <button type="button" ${attrs} data-delta="1" aria-label="Increase ${label}" ${value >= max ? 'disabled' : ''}>${icon('plus', 'icon-sm')}</button>
  </div>`;
}

export const hasNativeSwitch = 'switch' in document.createElement('input');
if (!hasNativeSwitch) document.documentElement.classList.add('no-native-switch');

/**
 * Run a screen change inside a view transition when one is available.
 * The DOM update never depends on the animation: if the transition is skipped,
 * aborted or slow, the update still runs (once), so the screen always matches the URL.
 */
export function withTransition(direction, update) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduce || !direction || document.hidden) {
    update();
    return;
  }
  let ran = false;
  const run = () => { if (!ran) { ran = true; update(); } };
  const root = document.documentElement;
  root.dataset.nav = direction;
  let t;
  try {
    t = document.startViewTransition(run);
  } catch {
    delete root.dataset.nav;
    run();
    return;
  }
  t.ready.catch(() => {});
  t.updateCallbackDone.catch(() => {}).finally(run);
  t.finished.catch(() => {}).finally(() => { if (root.dataset.nav === direction) delete root.dataset.nav; });
  setTimeout(run, 300); // safety net for a stalled transition
}
