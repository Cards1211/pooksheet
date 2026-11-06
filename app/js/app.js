// Boot, hash router, and delegated events.
import * as store from './store.js';
import { requestPersistence } from './db.js';
import { applyTheme, toast, withTransition } from './ui.js';
import { html } from './util.js';
import * as timerUI from './timer-ui.js';
import { unlockAudio } from './timer.js';
import { startOffline } from './offline.js';
import today from './screens/today.js';
import program from './screens/program.js';
import day from './screens/day.js';
import picker from './screens/picker.js';
import cycle from './screens/cycle.js';
import progress from './screens/progress.js';
import settings from './screens/settings.js';
import welcome from './screens/welcome.js';

const ROUTES = [
  [/^\/today$/, today],
  [/^\/program$/, program],
  [/^\/program\/day\/([\w-]+)$/, day, ['id']],
  [/^\/program\/day\/([\w-]+)\/add$/, picker, ['id']],
  [/^\/program\/cycle\/([\w-]+)$/, cycle, ['id']],
  [/^\/progress$/, progress],
  [/^\/settings$/, settings],
  [/^\/welcome$/, welcome],
];

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
let current = null;
let navToken = 0;

function resolve(hash) {
  const [path, qs = ''] = hash.replace(/^#/, '').split('?');
  for (const [re, screen, keys = []] of ROUTES) {
    const m = path.match(re);
    if (m) {
      const params = Object.fromEntries(keys.map((k, i) => [k, m[i + 1]]));
      return { screen, params, query: Object.fromEntries(new URLSearchParams(qs)), hash };
    }
  }
  return null;
}

/** Context handed to every screen handler. */
const ctx = () => ({
  params: current.params,
  query: current.query,
  rerender,
  go: (hash) => { location.hash = hash; },
});

function paint(route, keepScroll) {
  const y = window.scrollY;
  view.innerHTML = String(route.screen.render(route.params, route.query));
  current = route;
  route.screen.mount?.(view, ctx());
  const tab = route.screen.tab;
  tabbar.hidden = !tab;
  for (const a of tabbar.querySelectorAll('.tab')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = route.screen.title ? `${route.screen.title(route.params)} · PookSheet` : 'PookSheet';
  window.scrollTo(0, keepScroll ? y : 0);
}

export function rerender() {
  if (current) paint(current, true);
}

function direction(from, to) {
  if (!from || from.screen.tab !== to.screen.tab) return null; // tab switches never animate
  const a = from.screen.depth || 0;
  const b = to.screen.depth || 0;
  return b > a ? 'push' : b < a ? 'pop' : null;
}

function navigate() {
  const hasUser = !!store.userId();
  const hash = location.hash || '#/today';
  if (!hasUser && !hash.startsWith('#/welcome')) return location.replace('#/welcome');
  if (hasUser && hash.startsWith('#/welcome')) return location.replace('#/today');
  const route = resolve(hash);
  if (!route) return location.replace('#/today');
  const sameScreen = current && current.hash === route.hash;
  const dir = direction(current, route);
  current?.screen.leave?.(route);
  const token = ++navToken;
  // a later navigation wins; a slow earlier one never paints over it
  withTransition(dir, () => { if (token === navToken) paint(route, sameScreen); });
  if (!sameScreen) view.focus({ preventScroll: true });
}

async function run(fn, ...args) {
  try {
    await fn(...args);
  } catch (err) {
    console.error(err);
    toast(err?.message ? err.message : 'That didn’t save. Try again.');
  }
}

// iOS only lets sound start from a tap, so every tap unlocks audio for the timer.
document.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !view.contains(el) || !current) return;
  const fn = current.screen.actions?.[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  run(fn, el, e, ctx());
});

// Tapping the tab you're already on resets that screen (Today jumps back to today).
tabbar.addEventListener('click', (e) => {
  const a = e.target.closest('.tab');
  if (!a || !current || current.screen.tab !== a.dataset.tab || current.hash !== a.getAttribute('href')) return;
  e.preventDefault();
  current.screen.reselect?.();
  rerender();
  window.scrollTo({ top: 0 });
});

for (const type of ['change', 'input', 'keydown']) {
  document.addEventListener(type, (e) => {
    if (!current || !view.contains(e.target)) return;
    const fn = current.screen[type];
    if (fn) run(fn, e, ctx());
  });
}

async function boot() {
  try {
    await store.load();
  } catch (err) {
    console.error(err);
    view.innerHTML = String(html`<section class="card empty" style="margin-top:20vh"><h2>Can’t open your data</h2><p>${String(err.message || err)}</p></section>`);
    return;
  }
  applyTheme(store.profile()?.theme || 'system');
  requestPersistence();
  startOffline();
  timerUI.init();
  window.addEventListener('hashchange', navigate);
  navigate();
}

boot();
