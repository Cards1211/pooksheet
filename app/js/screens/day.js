import * as store from '../store.js';
import { html, icon, plural, clamp, range } from '../util.js';
import { WEEKDAYS, weekday } from '../dates.js';
import { toast, backLink, segmented, stepper } from '../ui.js';
import { slotMeta } from './common.js';
import * as training from '../training.js';

let openSlotId = null;
let openDayId = null;
let scrollToOpen = false;
let weeksSlot = null;      // card whose week-by-week list is showing
let editWeek = null;       // week whose target is being edited in that card

/** Called by the picker so the new or replaced exercise opens for editing. */
export function openSlot(dayId, slotId) {
  openDayId = dayId;
  openSlotId = slotId;
  scrollToOpen = true;
}

const LIMITS = { setsMin: [1, 10], setsMax: [1, 10], repsMin: [1, 100], repsMax: [1, 100] };
const PRESETS = [60, 90, 120];

function targetGrid(s, t, week = '') {
  const sfx = week ? ` in week ${week}` : '';
  return html`<div class="grid2">
    <div><span class="field-label">Sets from</span>${stepper({ field: 'setsMin', value: t.setsMin, min: 1, max: 10, label: `fewest sets${sfx}`, slot: s.id, week })}</div>
    <div><span class="field-label">Sets up to</span>${stepper({ field: 'setsMax', value: t.setsMax, min: 1, max: 10, label: `most sets${sfx}`, slot: s.id, week })}</div>
    <div><span class="field-label">Reps from</span>${stepper({ field: 'repsMin', value: t.repsMin, min: 1, max: 100, label: `fewest reps${sfx}`, slot: s.id, week })}</div>
    <div><span class="field-label">Reps up to</span>${stepper({ field: 'repsMax', value: t.repsMax, min: 1, max: 100, label: `most reps${sfx}`, slot: s.id, week })}</div>
  </div>`;
}

function weekList(s, cycle) {
  const n = store.weekOverrideCount(s);
  const nowWk = store.currentWeek(cycle);
  const rows = [];
  for (let w = 1; w <= cycle.weeks; w++) {
    const t = store.targetsFor(s, w);
    const differs = !!s.weekTargets?.[w];
    const editing = weeksSlot === s.id && editWeek === w;
    rows.push(html`<li class="wk-row ${differs ? 'differs' : ''} ${editing ? 'is-editing' : ''}">
      <button type="button" class="wk-head" data-action="week-edit" data-week="${w}" aria-expanded="${String(editing)}">
        <span class="wk-n">Week ${w}${w === nowWk ? html` <span class="wk-now">now</span>` : ''}</span>
        <span class="wk-t">${range(t.setsMin, t.setsMax)} × ${range(t.repsMin, t.repsMax)}</span>
        ${differs ? html`<span class="wk-dot" title="Differs from usual"></span>` : html`<span class="wk-same">usual</span>`}
      </button>
      ${editing ? html`<div class="wk-edit">${targetGrid(s, t, w)}
        <button type="button" class="btn-tool" style="margin-top:12px" data-action="week-reset" data-week="${w}" ${differs ? '' : 'disabled'}>Use the usual target</button></div>` : ''}
    </li>`);
  }
  return html`<div class="group">
    <button type="button" class="row-toggle" data-action="weeks-toggle" aria-expanded="${String(weeksSlot === s.id)}">
      <span><span class="label-text">Week by week</span><small>${n ? `${plural(n, 'week')} ${n === 1 ? 'differs' : 'differ'} from the usual target` : 'Every week uses the usual target'}</small></span>
      ${icon('down', 'chev')}
    </button>
    ${weeksSlot === s.id ? html`<ol class="wk-list">${rows}</ol>` : ''}
  </div>`;
}

function slotEditor(day, s, ex, i, count) {
  const custom = !PRESETS.includes(ex.restSec);
  const cycle = store.get('cycles', day.cycleId);
  return html`<div class="slot-body">
    <div class="group"><h3 class="subhead">Usual target</h3>${targetGrid(s, store.usualTargets(s))}</div>
    ${weekList(s, cycle)}

    <div class="group">
      <span class="field-label">Load</span>
      ${segmented(`load-${s.id}`, [
        { value: 'weighted', label: 'Weight' },
        { value: 'bodyweight', label: 'Bodyweight' },
        { value: 'bodyweight_plus', label: `BW + ${training.unitFor(ex)}` },
      ], ex.loadType, { label: 'Load type' })}
    </div>

    <div class="group">
      <label class="switch-row">
        <span><span class="label-text">Lengthened partials</span><small>Shows an LP badge while you log.</small></span>
        <input type="checkbox" class="switch" switch data-field="lp" data-ex="${ex.id}" ${ex.lp ? 'checked' : ''}>
      </label>
    </div>

    <div class="group">
      <span class="field-label">Rest after each set</span>
      <div class="chips" role="group" aria-label="Rest time">
        ${PRESETS.map((v) => html`<button type="button" class="chip" data-action="rest" data-ex="${ex.id}" data-sec="${v}" aria-pressed="${String(ex.restSec === v)}">${v} s</button>`)}
        <input class="input chip-input ${custom ? 'is-set' : ''}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3"
          data-field="rest" data-ex="${ex.id}" value="${custom ? ex.restSec : ''}" placeholder="Other" aria-label="Custom rest in seconds" enterkeyhint="done">
      </div>
    </div>

    ${ex.loadType === 'bodyweight' ? '' : weightStepGroup(ex)}

    <div class="group">
      <label class="field"><span class="field-label">Exercise name</span>
        <input class="input" data-field="name" data-ex="${ex.id}" value="${ex.name}" maxlength="60" autocapitalize="words" autocomplete="off" enterkeyhint="done">
      </label>
      <label class="field"><span class="field-label">Cue</span>
        <input class="input" data-field="cue" data-ex="${ex.id}" value="${ex.cue}" maxlength="140" placeholder="A reminder, e.g. elbows to pockets" autocomplete="off" enterkeyhint="done">
      </label>
      <label class="field"><span class="field-label">Video link</span>
        <input class="input" type="url" data-field="link" data-ex="${ex.id}" value="${ex.link}" placeholder="https://" inputmode="url" autocapitalize="none" autocorrect="off" autocomplete="off" enterkeyhint="done">
      </label>
      <span class="field-help">Name, load, LP, rest, cue and link belong to the exercise, so they change on every day it appears.</span>
    </div>

    <div class="tools">
      <button type="button" class="btn-tool" data-action="move" data-dir="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up-arrow', 'icon-sm')}</button>
      <button type="button" class="btn-tool" data-action="move" data-dir="1" aria-label="Move down" ${i === count - 1 ? 'disabled' : ''}>${icon('down-arrow', 'icon-sm')}</button>
      <a class="btn-tool" href="#/program/day/${day.id}/add?replace=${s.id}">${icon('swap', 'icon-sm')}Replace</a>
      <button type="button" class="btn-tool" data-action="remove-slot">${icon('trash', 'icon-sm')}Remove</button>
    </div>
  </div>`;
}

function weightStepGroup(ex) {
  const u = training.unitFor(ex);
  const presets = u === 'lb' ? [2.5, 5, 10] : [1, 2.5, 5];
  const step = training.stepFor(ex);
  const custom = !presets.includes(step);
  return html`<div class="group">
    <span class="field-label">Weight jump for hints</span>
    <div class="chips" role="group" aria-label="Weight jump">
      ${presets.map((v) => html`<button type="button" class="chip" data-action="wstep" data-ex="${ex.id}" data-v="${v}" aria-pressed="${String(step === v)}">${v} ${u}</button>`)}
      <input class="input chip-input ${custom ? 'is-set' : ''}" type="text" inputmode="decimal" maxlength="5"
        data-field="wstep" data-ex="${ex.id}" value="${custom ? training.fmtNum(step) : ''}" placeholder="Other" aria-label="Custom weight jump in ${u}" enterkeyhint="done">
    </div>
    <span class="field-help">When every set reaches the top of the rep range, Today suggests adding this much.</span>
  </div>`;
}

function slotItem(day, s, i, count, editable) {
  const ex = store.get('exercises', s.exerciseId);
  if (!ex) return '';
  if (!editable) {
    return html`<li class="card slot" data-slot="${s.id}"><div class="slot-head"><span class="grip" aria-hidden="true"></span>
      <div class="slot-toggle"><span class="txt"><span class="slot-name">${ex.name}</span><span class="slot-meta">${slotMeta(s, ex)}</span></span></div></div></li>`;
  }
  const open = openSlotId === s.id;
  return html`<li class="card slot ${open ? 'is-open' : ''}" data-slot="${s.id}">
    <div class="slot-head">
      <button type="button" class="grip" data-grip aria-label="Reorder ${ex.name}. Drag, or use the arrow keys.">${icon('grip')}</button>
      <button type="button" class="slot-toggle" data-action="toggle-slot" aria-expanded="${String(open)}" aria-controls="b-${s.id}">
        <span class="txt"><span class="slot-name">${ex.name}</span><span class="slot-meta">${slotMeta(s, ex)}</span></span>
        ${icon('down', 'chev')}
      </button>
    </div>
    <div class="reveal" id="b-${s.id}"><div class="reveal-inner" ${open ? '' : 'inert'}>${slotEditor(day, s, ex, i, count)}</div></div>
  </li>`;
}

function setOpen(li, open) {
  li.classList.toggle('is-open', open);
  li.querySelector('.slot-toggle')?.setAttribute('aria-expanded', String(open));
  const inner = li.querySelector('.reveal-inner');
  if (inner) inner.inert = !open;
}

// ---------- drag to reorder ----------
function setupReorder(list, onDrop) {
  list.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('[data-grip]');
    if (!grip || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const item = grip.closest('.slot');
    const items = [...list.children];
    if (items.length < 2) return;
    e.preventDefault();
    const from = items.indexOf(item);
    const rects = items.map((el) => el.getBoundingClientRect());
    const gap = rects[1].top - rects[0].bottom;
    const shift = rects[from].height + gap;
    const startY = e.clientY;
    let to = from;
    let moved = false;
    grip.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dy) < 4) return;
      if (!moved) {
        moved = true;
        item.classList.add('is-dragging');
        list.classList.add('is-sorting');
      }
      item.style.transform = `translateY(${dy}px) scale(1.02)`;
      const center = rects[from].top + rects[from].height / 2 + dy;
      to = 0;
      items.forEach((el, i) => { if (i !== from && center > rects[i].top + rects[i].height / 2) to++; });
      items.forEach((el, i) => {
        if (i === from) return;
        let t = 0;
        if (from < to && i > from && i <= to) t = -shift;
        else if (from > to && i >= to && i < from) t = shift;
        el.style.transform = t ? `translateY(${t}px)` : '';
      });
    };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      if (!moved) return;
      if (to === from) {
        item.style.transition = 'transform 200ms var(--ease-out)';
        item.style.transform = '';
        items.forEach((el) => { el.style.transform = ''; });
        setTimeout(() => {
          item.classList.remove('is-dragging');
          list.classList.remove('is-sorting');
          item.style.transition = '';
        }, 200);
        return;
      }
      const ids = items.map((el) => el.dataset.slot);
      const [id] = ids.splice(from, 1);
      ids.splice(to, 0, id);
      onDrop(ids);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  });
}

async function moveBy(slotId, dir, rerender) {
  const li = document.querySelector(`[data-slot="${slotId}"]`);
  const ids = [...li.parentElement.children].map((el) => el.dataset.slot);
  const i = ids.indexOf(slotId);
  const j = i + dir;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await store.reorderSlots(ids);
  rerender();
}

export default {
  tab: 'program',
  depth: 1,
  title: (p) => {
    const d = store.get('days', p.id);
    return d ? weekday(d.weekday).long : 'Day';
  },

  render({ id }) {
    const day = store.get('days', id);
    if (!day || day.deleted) {
      return html`<header class="screen-head pushed">${backLink('#/program', 'Program')}<h1>Day not found</h1></header>
        <section class="card empty"><p>This day was removed from the program.</p></section>`;
    }
    if (openDayId !== id) { openDayId = id; openSlotId = null; weeksSlot = null; editWeek = null; }
    const cycle = store.get('cycles', day.cycleId);
    const editable = cycle.status === 'active';
    const list = store.slots(day.id);
    const taken = new Set(store.days(cycle.id).filter((d) => d.id !== day.id).map((d) => d.weekday));
    const back = editable ? backLink('#/program', 'Program') : backLink(`#/program/cycle/${cycle.id}`, cycle.name);

    return html`
      <header class="screen-head pushed">${back}
        <h1 id="day-title">${weekday(day.weekday).long}${day.name ? html` · ${day.name}` : ''}</h1>
        ${editable ? '' : html`<p class="sub">${cycle.name} · read only</p>`}
      </header>

      ${editable ? html`<section class="card">
        <label class="field"><span class="field-label">Day name</span>
          <input class="input" data-field="day-name" value="${day.name}" placeholder="e.g. Upper, Push, Legs" maxlength="40" autocapitalize="words" autocomplete="off" enterkeyhint="done">
        </label>
        <div class="field"><span class="field-label">Trains on</span>
          <div class="weekdays" role="radiogroup" aria-label="Weekday">
            ${WEEKDAYS.map((w) => html`<button type="button" class="wd" role="radio" data-action="move-day" data-wd="${w.n}"
              aria-checked="${String(w.n === day.weekday)}" aria-label="${w.long}${taken.has(w.n) ? ', already a training day' : ''}"
              ${taken.has(w.n) ? 'disabled' : ''}>${w.two}</button>`)}
          </div>
        </div>
      </section>` : ''}

      <div class="section-head"><h2>Exercises</h2><span class="count">${list.length || ''}</span></div>
      ${list.length
        ? html`<ol class="slot-list" id="slots">${list.map((s, i) => slotItem(day, s, i, list.length, editable))}</ol>`
        : html`<section class="card empty"><h2>No exercises yet</h2><p>Add the first exercise for ${weekday(day.weekday).long}.</p></section>`}

      ${editable ? html`
        <a class="btn btn-primary btn-block" style="margin-top:16px" href="#/program/day/${day.id}/add">${icon('plus')}Add exercise</a>
        <button type="button" class="btn btn-quiet btn-block" style="margin-top:28px" data-action="remove-day">Stop training on ${weekday(day.weekday).long}s</button>` : ''}
    `;
  },

  mount(root, { rerender }) {
    const list = root.querySelector('#slots');
    if (list) {
      setupReorder(list, async (ids) => { await store.reorderSlots(ids); rerender(); });
    }
    if (scrollToOpen && openSlotId) {
      scrollToOpen = false;
      const li = root.querySelector(`[data-slot="${openSlotId}"]`);
      if (li) requestAnimationFrame(() => li.scrollIntoView({ block: 'center' }));
    }
  },

  actions: {
    'toggle-slot'(el) {
      const li = el.closest('.slot');
      const open = !li.classList.contains('is-open');
      for (const other of li.parentElement.querySelectorAll('.slot.is-open')) if (other !== li) setOpen(other, false);
      setOpen(li, open);
      openSlotId = open ? li.dataset.slot : null;
    },

    'weeks-toggle'(el, e, { rerender }) {
      const id = el.closest('.slot').dataset.slot;
      weeksSlot = weeksSlot === id ? null : id;
      editWeek = null;
      rerender();
    },

    'week-edit'(el, e, { rerender }) {
      const w = Number(el.dataset.week);
      editWeek = editWeek === w ? null : w;
      rerender();
    },

    async 'week-reset'(el, e, { rerender }) {
      await store.setWeekTarget(el.closest('.slot').dataset.slot, Number(el.dataset.week), null);
      rerender();
    },

    async step(el, e, { rerender }) {
      const s = store.get('slots', el.dataset.slot);
      const field = el.dataset.field;
      const week = el.dataset.week ? Number(el.dataset.week) : null;
      const t = { ...(week ? store.targetsFor(s, week) : store.usualTargets(s)) };
      const [lo, hi] = LIMITS[field];
      t[field] = clamp(t[field] + Number(el.dataset.delta), lo, hi);
      // keep each range valid: "from" never above "up to"
      if (field === 'setsMin' && t.setsMin > t.setsMax) t.setsMax = t.setsMin;
      if (field === 'setsMax' && t.setsMax < t.setsMin) t.setsMin = t.setsMax;
      if (field === 'repsMin' && t.repsMin > t.repsMax) t.repsMax = t.repsMin;
      if (field === 'repsMax' && t.repsMax < t.repsMin) t.repsMin = t.repsMax;
      if (week) await store.setWeekTarget(s.id, week, t);
      else await store.setUsualTargets(s.id, t);
      rerender();
    },

    async wstep(el, e, { rerender }) {
      await store.patch('exercises', el.dataset.ex, { weightStep: Number(el.dataset.v), weightStepUnit: training.unitFor(store.get('exercises', el.dataset.ex)) });
      rerender();
    },

    async rest(el, e, { rerender }) {
      await store.patch('exercises', el.dataset.ex, { restSec: Number(el.dataset.sec) });
      rerender();
    },

    async move(el, e, { rerender }) {
      await moveBy(el.closest('.slot').dataset.slot, Number(el.dataset.dir), rerender);
    },

    async 'remove-slot'(el, e, { rerender }) {
      const id = el.closest('.slot').dataset.slot;
      const ex = store.get('exercises', store.get('slots', id).exerciseId);
      const items = await store.removeSlot(id);
      openSlotId = null;
      rerender();
      toast(`Removed ${ex.name}`, { action: { label: 'Undo', run: async () => { await store.restore(items); rerender(); } } });
    },

    async 'move-day'(el, e, { params, rerender }) {
      const wd = Number(el.dataset.wd);
      const day = store.get('days', params.id);
      if (wd === day.weekday) return;
      await store.patch('days', day.id, { weekday: wd });
      rerender();
      toast(`Moved to ${weekday(wd).long}`);
    },

    async 'remove-day'(el, e, { params, go }) {
      const day = store.get('days', params.id);
      const n = store.slots(day.id).length;
      const items = await store.removeDay(day.id);
      go('#/program');
      toast(`Removed ${weekday(day.weekday).long}${n ? ` and its ${plural(n, 'exercise')}` : ''}`, {
        action: { label: 'Undo', run: async () => { await store.restore(items); location.hash = `#/program/day/${day.id}`; } },
      });
    },
  },

  async change(e, { params, rerender }) {
    const t = e.target;
    const field = t.dataset.field;
    if (t.type === 'radio' && t.name.startsWith('load-')) {
      const slot = store.get('slots', t.name.slice(5));
      await store.patch('exercises', slot.exerciseId, { loadType: t.value });
      return rerender();
    }
    if (!field) return;

    if (field === 'day-name') {
      const name = t.value.trim();
      const day = await store.patch('days', params.id, { name });
      document.getElementById('day-title').textContent = `${weekday(day.weekday).long}${name ? ` · ${name}` : ''}`;
      return;
    }

    const ex = store.get('exercises', t.dataset.ex);
    if (field === 'lp') {
      await store.patch('exercises', ex.id, { lp: t.checked });
      return rerender();
    }
    if (field === 'rest') {
      const n = parseInt(t.value, 10);
      if (!t.value.trim()) return;
      if (!Number.isFinite(n)) { t.value = ''; return toast('Rest is in seconds, like 150.'); }
      await store.patch('exercises', ex.id, { restSec: clamp(n, 10, 600) });
      return rerender();
    }
    if (field === 'wstep') {
      if (!t.value.trim()) return;
      const v = training.parseWeight(t.value);
      if (v == null || Number.isNaN(v) || v <= 0) { t.value = ''; return toast('Weight jump is a number, like 1.25.'); }
      await store.patch('exercises', ex.id, { weightStep: clamp(v, 0.25, 50), weightStepUnit: training.unitFor(ex) });
      return rerender();
    }
    if (field === 'name') {
      const name = t.value.trim().replace(/\s+/g, ' ');
      if (!name) { t.value = ex.name; return toast('An exercise needs a name.'); }
      const clash = store.findExercise(name);
      if (clash && clash.id !== ex.id) { t.value = ex.name; return toast(`You already have “${clash.name}”.`); }
      await store.patch('exercises', ex.id, { name });
      t.value = name;
      const li = t.closest('.slot');
      if (li) li.querySelector('.slot-name').textContent = name;
      return;
    }
    if (field === 'cue') {
      await store.patch('exercises', ex.id, { cue: t.value.trim() });
      return;
    }
    if (field === 'link') {
      let link = t.value.trim();
      if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
      t.value = link;
      await store.patch('exercises', ex.id, { link });
    }
  },

  keydown(e, { rerender }) {
    if (e.key === 'Enter' && e.target.matches?.('input[data-field]')) {
      e.preventDefault();
      e.target.blur();
      return;
    }
    const grip = e.target.closest?.('[data-grip]');
    if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const id = grip.closest('.slot').dataset.slot;
    return moveBy(id, e.key === 'ArrowUp' ? -1 : 1, rerender).then(() => {
      document.querySelector(`[data-slot="${id}"] [data-grip]`)?.focus();
    });
  },
};
