// Rest timer UI: a bar above the tab bar on every screen, a big countdown sheet,
// and the flash at zero. The engine lives in timer.js.
import * as timer from './timer.js';
import * as store from './store.js';
import { html, icon } from './util.js';

const PRESETS = [60, 90, 120];
const RING = 2 * Math.PI * 100; // circle r=100

const fmt = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const spoken = (ms) => {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m ? `${m} minute${m === 1 ? '' : 's'} ` : ''}${s % 60} seconds left`;
};
const runLabel = (st) => `Rest${st.label ? ` · ${st.label}` : ''}`;
const nextLabel = (st) => (st.next ? `Next set · ${st.next}` : 'Next set');

let bar;
let sheet;
let flashEl;
let live;
let barShape = '';
let sheetShape = '';

function renderBar(st) {
  if (!st) {
    bar.hidden = true;
    document.documentElement.classList.remove('has-timer');
    barShape = 'none';
    return;
  }
  bar.hidden = false;
  document.documentElement.classList.add('has-timer');
  // Rebuild only when the bar changes kind, so +30 never pulls a button out from under focus.
  const s = st.doneAt ? `done:${st.next}` : `run:${st.label}`;
  if (s !== barShape) {
    barShape = s;
    const focused = bar.contains(document.activeElement) ? document.activeElement.dataset.t : null;
    bar.className = `rest-bar${st.doneAt ? ' is-done' : ''}`;
    bar.innerHTML = String(st.doneAt
      ? html`<div class="rest-main"><span class="rest-time">Rest done</span><span class="rest-label">${nextLabel(st)}</span></div>
          <button type="button" class="rest-btn" data-t="add" aria-label="Rest 30 more seconds">+30</button>
          <button type="button" class="rest-btn" data-t="stop">OK</button>`
      : html`<button type="button" class="rest-main" data-t="open" aria-haspopup="dialog">
            <span class="rest-time" aria-hidden="true"></span>
            <span class="rest-label">${runLabel(st)}</span>
          </button>
          <button type="button" class="rest-btn" data-t="add" aria-label="Add 30 seconds">+30</button>
          <button type="button" class="rest-btn" data-t="stop">Skip</button>
          <i class="rest-progress" aria-hidden="true"></i>`);
    if (focused) (bar.querySelector(`[data-t="${focused}"]`) || bar.querySelector('button'))?.focus({ preventScroll: true });
  }
  if (!st.doneAt) {
    const left = timer.remainingMs();
    bar.querySelector('.rest-time').textContent = fmt(left);
    bar.querySelector('.rest-main').setAttribute('aria-label', `Rest timer, ${spoken(left)}. Open the big countdown.`);
    bar.querySelector('.rest-progress').style.transform = `scaleX(${Math.max(0, left / (st.total * 1000))})`;
  }
}

/** Close the sheet. The bar button that opened it may have been redrawn, so put focus somewhere real. */
function closeSheet() {
  if (sheet.open) sheet.close();
  refocus();
}
function refocus() {
  const a = document.activeElement;
  if (a && a !== document.body && !sheet.contains(a)) return;
  (bar.hidden ? document.getElementById('view') : bar.querySelector('button'))?.focus({ preventScroll: true });
}

function renderSheet(st) {
  if (!sheet.open) return;
  if (!st) { closeSheet(); return; }
  // At zero the sheet stays open and turns into "Rest done", so a lifter watching it sees the end.
  const done = !!st.doneAt;
  const left = done ? 0 : timer.remainingMs();
  sheet.querySelector('.rest-big').textContent = fmt(left);
  sheet.querySelector('.ring-prog').style.strokeDashoffset = String(RING * (1 - left / (st.total * 1000)));
  const s = done ? 'done' : `run:${st.label}`;
  if (s !== sheetShape) {
    sheetShape = s;
    sheet.classList.toggle('is-done', done);
    sheet.querySelector('.rest-ex').textContent = done ? 'Rest done' : runLabel(st);
    sheet.querySelector('.sheet-stop').textContent = done ? 'OK' : 'Skip rest';
  }
  // the chips show the exercise's saved rest, not this rest's +30 extensions
  const ex = st.exerciseId ? store.get('exercises', st.exerciseId) : null;
  for (const b of sheet.querySelectorAll('[data-t="len"]')) {
    b.setAttribute('aria-pressed', String(!!ex && Number(b.dataset.sec) === ex.restSec));
  }
}

function openSheet() {
  const st = timer.state();
  if (!st || st.doneAt) return;
  const ex = st.exerciseId ? store.get('exercises', st.exerciseId) : null;
  const saved = ex ? ex.restSec : st.total;
  const custom = !PRESETS.includes(saved);
  sheetShape = '';
  sheet.innerHTML = String(html`
    <div class="sheet-body">
      <p class="rest-ex"></p>
      <div class="rest-ring" role="timer" aria-live="off">
        <svg viewBox="0 0 220 220" aria-hidden="true">
          <circle class="ring-track" cx="110" cy="110" r="100"/>
          <circle class="ring-prog" cx="110" cy="110" r="100" stroke-dasharray="${RING.toFixed(1)}"/>
        </svg>
        <span class="rest-big"></span>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-quiet" data-t="add">+30 s</button>
        <button type="button" class="btn btn-primary sheet-stop" data-t="stop">Skip rest</button>
      </div>
      ${ex ? html`<span class="field-label" style="margin-top:22px">Rest for ${ex.name}</span>
        <div class="chips" role="group" aria-label="Rest length">
          ${PRESETS.map((v) => html`<button type="button" class="chip" data-t="len" data-sec="${v}" aria-pressed="${String(saved === v)}">${v} s</button>`)}
          <input class="input chip-input ${custom ? 'is-set' : ''}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3"
            data-t="custom" value="${custom ? saved : ''}" placeholder="Other" aria-label="Custom rest in seconds" enterkeyhint="done">
        </div>
        <span class="field-help">Saved for this exercise, and used from now on.</span>` : ''}
      <button type="button" class="btn btn-quiet btn-block" style="margin-top:20px" data-t="close">${icon('down')}Hide</button>
      <p class="sr-only" role="status" aria-live="assertive" data-live></p>
    </div>
    <i class="sheet-flash" aria-hidden="true"></i>`);
  sheet.showModal();
  renderSheet(st);
}

async function setLength(sec) {
  const st = timer.state();
  if (!st) return;
  timer.setLength(sec);
  if (st.exerciseId) await store.patch('exercises', st.exerciseId, { restSec: sec });
}

function flash() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const frames = reduce
    ? [{ opacity: 0 }, { opacity: 0.3 }, { opacity: 0 }]
    : [{ opacity: 0 }, { opacity: 0.5 }, { opacity: 0 }, { opacity: 0.5 }, { opacity: 0 }];
  const timing = { duration: reduce ? 900 : 1200, easing: 'ease-out' };
  flashEl.animate(frames, timing);
  if (sheet.open) sheet.querySelector('.sheet-flash')?.animate(frames, timing); // the page flash sits under the open sheet
  else if (!reduce) bar.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 420, iterations: 2, easing: 'ease-out' });
  // while the sheet is open everything outside it is inert, so it announces from inside
  const say = sheet.open ? sheet.querySelector('[data-live]') : live;
  if (!say) return;
  say.textContent = 'Rest done';
  setTimeout(() => { say.textContent = ''; }, 3000);
}

function onClick(e) {
  const el = e.target.closest('[data-t]');
  if (!el) return;
  timer.unlockAudio();
  const t = el.dataset.t;
  if (t === 'open') openSheet();
  else if (t === 'add') timer.addSeconds(30);
  else if (t === 'stop') { timer.stop(); closeSheet(); }
  else if (t === 'close') closeSheet();
  else if (t === 'len') setLength(Number(el.dataset.sec));
}

export function init() {
  bar = document.getElementById('rest-timer');
  sheet = document.getElementById('rest-sheet');
  flashEl = document.getElementById('rest-flash');
  live = document.getElementById('rest-live');
  bar.addEventListener('click', onClick);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) { closeSheet(); return; } // tap on the backdrop
    onClick(e);
  });
  sheet.addEventListener('change', (e) => {
    if (e.target.dataset.t !== 'custom') return;
    const n = parseInt(e.target.value, 10);
    if (Number.isFinite(n) && n >= 10 && n <= 600) setLength(n);
    else e.target.value = '';
  });
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.t === 'custom') { e.preventDefault(); e.target.blur(); }
  });
  sheet.addEventListener('close', refocus); // Escape closes it without going through closeSheet
  timer.setDoneHandler(flash);
  timer.subscribe((st) => { renderBar(st); renderSheet(st); });
  timer.init();
  renderBar(timer.state());
}
