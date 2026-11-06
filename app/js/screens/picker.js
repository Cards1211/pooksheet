import * as store from '../store.js';
import { html, icon } from '../util.js';
import { weekday } from '../dates.js';
import { toast, backLink } from '../ui.js';
import { openSlot } from './day.js';

let catalogPromise = null;
const loadCatalog = () => {
  catalogPromise ||= fetch('data/catalog.json').then((r) => {
    if (!r.ok) throw new Error('Could not load the exercise list.');
    return r.json();
  }).catch((err) => { catalogPromise = null; throw err; });
  return catalogPromise;
};

let query = '';
let group = 'All';
let draw = null;
let drawGroups = null;

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s]/g, ' ');
const matches = (name, q) => {
  const n = norm(name);
  return norm(q).split(/\s+/).filter(Boolean).every((t) => n.includes(t));
};

function row({ name, sub, ex, grp, disabled, create }) {
  return html`<button type="button" class="pick-row ${create ? 'create' : ''}" data-action="pick"
    ${ex ? html`data-ex="${ex}"` : html`data-name="${name}" data-group="${grp || ''}"`}
    ${disabled ? 'aria-disabled="true"' : ''}>
    <span class="grow"><span class="nm">${create ? `Create “${name}”` : name}</span>${sub ? html`<span class="ct">${sub}</span>` : ''}</span>
    ${disabled ? html`<span class="ct">On this day</span>` : icon('plus')}
  </button>`;
}

function results(catalog, dayId) {
  const inDay = new Set(store.slots(dayId).map((s) => s.exerciseId));
  const mineAll = store.exercises();
  const mineNames = new Set(mineAll.map((e) => e.name.toLowerCase()));
  const groupOk = (g) => group === 'All' || g === group;
  const q = query.trim();

  const mine = mineAll.filter((e) => (!q || matches(e.name, q)) && groupOk(e.muscleGroup));
  const cat = catalog.exercises.filter((c) => !mineNames.has(c.name.toLowerCase()) && (!q || matches(c.name, q)) && groupOk(c.group));
  const exact = q && (mineNames.has(q.toLowerCase()) || catalog.exercises.some((c) => c.name.toLowerCase() === q.toLowerCase()));

  const parts = [];
  if (q && !exact) {
    parts.push(html`<div class="card pick-list" style="margin-top:4px">${row({ name: q, grp: group === 'All' ? '' : group, create: true, sub: 'Add it as a new exercise' })}</div>`);
  }
  if (mine.length) {
    parts.push(html`<section class="pick-group"><h2>Your exercises</h2><div class="card pick-list" style="padding:4px 0">
      ${mine.map((e) => row({ name: e.name, sub: e.muscleGroup, ex: e.id, disabled: inDay.has(e.id) }))}</div></section>`);
  }
  for (const g of catalog.groups) {
    const items = cat.filter((c) => c.group === g);
    if (!items.length) continue;
    parts.push(html`<section class="pick-group"><h2>${g}</h2><div class="card pick-list" style="padding:4px 0">
      ${items.map((c) => row({ name: c.name, sub: c.category, grp: c.group }))}</div></section>`);
  }
  if (!parts.length) {
    parts.push(html`<section class="card empty" style="margin-top:8px"><h2>Nothing in ${group}</h2><p>Try another group, or type a name to create it.</p></section>`);
  }
  return parts.join('');
}

const screen = {
  tab: 'program',
  depth: 2,
  title: () => 'Add exercise',

  render({ id }, { replace } = {}) {
    const day = store.get('days', id);
    if (!day || day.deleted) return html`<header class="screen-head pushed">${backLink('#/program', 'Program')}<h1>Day not found</h1></header>`;
    const slot = replace ? store.get('slots', replace) : null;
    const replacing = slot ? store.get('exercises', slot.exerciseId) : null;
    return html`
      <header class="screen-head pushed">${backLink(`#/program/day/${day.id}`, weekday(day.weekday).long)}
        <h1>${replacing ? `Replace ${replacing.name}` : 'Add exercise'}</h1>
        ${replacing ? html`<p class="sub">Keeps its sets and reps. Past workouts stay as they were.</p>` : ''}
      </header>
      <div class="search">${icon('search')}
        <input class="input" id="q" type="search" value="${query}" placeholder="Search or type a new name" autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" enterkeyhint="search" aria-label="Search exercises">
      </div>
      <div class="chips-scroll" role="group" aria-label="Muscle group" id="groups"></div>
      <div id="results" aria-live="polite"><p class="muted" style="padding:16px 4px">Loading exercises…</p></div>
    `;
  },

  async mount(root, { params }) {
    const resultsEl = root.querySelector('#results');
    const groupsEl = root.querySelector('#groups');
    if (!resultsEl) return;
    let catalog;
    try {
      catalog = await loadCatalog();
    } catch (err) {
      catalog = { groups: [], exercises: [] };
      toast(err.message);
    }
    drawGroups = () => {
      groupsEl.innerHTML = String(html`${['All', ...catalog.groups].map((g) => html`<button type="button" class="chip" data-action="group" data-group="${g}" aria-pressed="${String(g === group)}">${g}</button>`)}`);
    };
    draw = () => { resultsEl.innerHTML = results(catalog, params.id); };
    drawGroups();
    draw();
  },

  leave(next) {
    if (next.screen !== screen) { query = ''; group = 'All'; }
    draw = null;
    drawGroups = null;
  },

  input(e) {
    if (e.target.id !== 'q') return;
    query = e.target.value;
    draw?.();
  },

  keydown(e) {
    if (e.target.id === 'q' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  },

  actions: {
    group(el) {
      group = el.dataset.group;
      drawGroups?.();
      draw?.();
    },

    async pick(el, e, { params, query: qs, go }) {
      if (el.getAttribute('aria-disabled') === 'true') return;
      const day = store.get('days', params.id);
      const ex = el.dataset.ex
        ? store.get('exercises', el.dataset.ex)
        : await store.ensureExercise({ name: el.dataset.name, group: el.dataset.group });
      if (qs.replace) {
        await store.patch('slots', qs.replace, { exerciseId: ex.id });
        openSlot(day.id, qs.replace);
        toast(`Replaced with ${ex.name}`);
      } else {
        const slot = await store.addSlot(day.id, ex.id);
        openSlot(day.id, slot.id);
        toast(`Added ${ex.name} to ${weekday(day.weekday).long}`);
      }
      go(`#/program/day/${day.id}`);
    },
  },
};

export default screen;
