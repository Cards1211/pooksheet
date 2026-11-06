import * as store from '../store.js';
import { html, icon, plural } from '../util.js';
import { WEEKDAYS, weekday, toISO, nextMonday, parseISO, fmtShortWeekday } from '../dates.js';
import { toast } from '../ui.js';
import { dayCard, cycleDates } from './common.js';

let newCycleOpen = false;

function weekPill(cycle, wk) {
  if (wk < 1) return html`<span class="pill-stat">Starts ${fmtShortWeekday(parseISO(cycle.startDate))}</span>`;
  if (wk > cycle.weeks) return html`<span class="pill-stat">Finished</span>`;
  return html`<span class="pill-stat">Week ${wk} of ${cycle.weeks}</span>`;
}

function weekBar(cycle, wk) {
  const segs = [];
  for (let i = 1; i <= cycle.weeks; i++) {
    const cls = i < wk || wk > cycle.weeks ? 'done' : i === wk ? 'now' : '';
    segs.push(html`<i class="${cls}"></i>`);
  }
  const label = wk < 1 ? 'Not started yet' : wk > cycle.weeks ? 'All 8 weeks done' : `Week ${wk} of ${cycle.weeks}`;
  return html`<div class="weekbar" role="img" aria-label="${label}">${segs}</div>`;
}

function cycleCard(cycle) {
  const wk = store.currentWeek(cycle);
  const finished = wk > cycle.weeks;
  const next = store.cycles().length + 1;
  const dayCount = store.days(cycle.id).length;
  const slotCount = store.slotCount(cycle.id);
  return html`<section class="card cycle-card ${newCycleOpen ? 'is-open' : ''}" id="cycle-card">
    <div class="top"><h2>${cycle.name}</h2>${weekPill(cycle, wk)}</div>
    <p class="dates">${cycle.title ? `${cycle.title} · ` : ''}${cycleDates(cycle)}</p>
    ${weekBar(cycle, wk)}
    ${finished ? html`<p class="muted" style="margin:-4px 2px 14px">This cycle is done. Start the next one when you’re ready.</p>` : ''}
    <button type="button" class="btn ${finished ? 'btn-primary' : 'btn-secondary'} btn-block" data-action="new-cycle-toggle" aria-expanded="${String(newCycleOpen)}" aria-controls="new-cycle">Start new cycle</button>
    <div class="reveal" id="new-cycle">
      <div class="reveal-inner" ${newCycleOpen ? '' : 'inert'}>
        <div class="panel">
          <h3>Start Cycle ${next}</h3>
          <label class="field"><span class="field-label">First day</span>
            <input class="input" type="date" name="startDate" value="${toISO(nextMonday())}" required></label>
          <label class="switch-row" style="margin-top:8px">
            <span><span class="label-text">Copy this program</span>
              <small>${plural(dayCount, 'day')} and ${plural(slotCount, 'exercise')}. Your last numbers show as the reference.</small></span>
            <input type="checkbox" class="switch" switch name="copy" ${slotCount ? 'checked' : ''}>
          </label>
          <p class="note">${cycle.name} is kept, and you can open it any time under Past cycles.</p>
          <div class="btn-row">
            <button type="button" class="btn btn-quiet" data-action="new-cycle-toggle">Cancel</button>
            <button type="button" class="btn btn-primary" data-action="new-cycle-start">Start</button>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

function weekdayPicker(cycle) {
  const taken = new Set(store.days(cycle.id).map((d) => d.weekday));
  return html`<div class="weekdays" role="group" aria-label="Training days">
    ${WEEKDAYS.map((w) => html`<button type="button" class="wd" data-action="toggle-weekday" data-wd="${w.n}"
      aria-pressed="${String(taken.has(w.n))}" aria-label="${w.long}">${w.two}</button>`)}
  </div>`;
}

export default {
  tab: 'program',
  depth: 0,
  title: () => 'Program',

  render() {
    const cycle = store.activeCycle();
    const past = store.pastCycles();
    if (!cycle) {
      return html`<header class="screen-head"><h1>Program</h1></header>
        <section class="card empty"><h2>No active cycle</h2><p>Start a cycle to plan your training days.</p>
        <button type="button" class="btn btn-primary btn-block" data-action="first-cycle">Start Cycle ${past.length + 1}</button></section>`;
    }
    const days = store.days(cycle.id);
    return html`
      <header class="screen-head"><h1>Program</h1></header>
      ${cycleCard(cycle)}
      <div class="section-head"><h2>Training days</h2><span class="count">${plural(days.length, 'day')} a week</span></div>
      <p class="hint">Tap a weekday to add or remove it.</p>
      ${weekdayPicker(cycle)}
      <div class="stack" style="margin-top:16px">
        ${days.length ? days.map(dayCard) : html`<section class="card empty"><h2>No training days yet</h2><p>Turn on the weekdays you train, then add exercises to each day.</p></section>`}
      </div>
      ${past.length ? html`
        <div class="section-head"><h2>Past cycles</h2></div>
        <div class="stack">${past.map((c) => html`<a class="card row-card pressable" href="#/program/cycle/${c.id}">
          <span class="grow"><span class="title">${c.name}</span><span class="meta" style="display:block">${cycleDates(c)} · ${plural(store.workoutCount(c.id), 'workout')}</span></span>${icon('next')}</a>`)}</div>` : ''}
    `;
  },

  leave() { newCycleOpen = false; },

  actions: {
    'new-cycle-toggle'(el) {
      newCycleOpen = !newCycleOpen;
      const card = document.getElementById('cycle-card');
      card.classList.toggle('is-open', newCycleOpen);
      card.querySelector('.reveal-inner').inert = !newCycleOpen;
      card.querySelector('[aria-controls="new-cycle"]').setAttribute('aria-expanded', String(newCycleOpen));
      if (newCycleOpen) setTimeout(() => card.querySelector('.panel').scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 120);
    },

    async 'new-cycle-start'(el, e, { rerender }) {
      const card = document.getElementById('cycle-card');
      const startDate = card.querySelector('[name="startDate"]').value;
      const copy = card.querySelector('[name="copy"]').checked;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        toast('Pick the first day of the new cycle.');
        return;
      }
      const c = await store.startNewCycle({ startDate, copy });
      newCycleOpen = false;
      rerender();
      window.scrollTo({ top: 0 });
      toast(`${c.name} starts ${fmtShortWeekday(parseISO(startDate))}`);
    },

    async 'first-cycle'(el, e, { rerender }) {
      await store.startNewCycle({ startDate: toISO(nextMonday()), copy: false });
      rerender();
    },

    async 'toggle-weekday'(el, e, { rerender }) {
      const cycle = store.activeCycle();
      const wd = Number(el.dataset.wd);
      const existing = store.dayForWeekday(cycle.id, wd);
      if (existing) {
        const n = store.slots(existing.id).length;
        const items = await store.removeDay(existing.id);
        rerender();
        toast(`Removed ${weekday(wd).long}${n ? ` and its ${plural(n, 'exercise')}` : ''}`, {
          action: { label: 'Undo', run: async () => { await store.restore(items); rerender(); } },
        });
      } else {
        await store.addDay(cycle.id, wd);
        rerender();
        toast(`Added ${weekday(wd).long}`);
      }
    },
  },
};
