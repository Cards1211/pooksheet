import * as store from '../store.js';
import * as training from '../training.js';
import * as stats from '../stats.js';
import { html, icon, plural } from '../util.js';
import { toast } from '../ui.js';
import { WEEKDAYS, todayISO, parseISO, fmtDay, fmtShortWeekday, daysBetween, cycleStartMonday, cycleEnd, weekNumber } from '../dates.js';
import { lineChart, niceScale } from '../chart.js';
import { dayName, cycleDates } from './common.js';

let cycleId = null; // the cycle being looked at; the active one by default

function chosenCycle() {
  const list = store.cycles();
  return list.find((c) => c.id === cycleId) || store.activeCycle() || list[0] || null;
}

function cycleSub(cycle) {
  if (cycle.status !== 'active') return `${cycle.name} · ${cycleDates(cycle)}`;
  const w = weekNumber(cycle);
  if (w < 1) return `${cycle.name} · starts ${fmtDay(parseISO(cycle.startDate))}`;
  return w > cycle.weeks ? `${cycle.name} · ended ${fmtDay(cycleEnd(cycle))}` : `${cycle.name} · week ${w} of ${cycle.weeks}`;
}

function streakLine() {
  const n = stats.streak();
  return n
    ? html`<p class="pg-streak"><strong>${n}-week streak</strong><span>Weeks in a row with every workout done</span></p>`
    : html`<p class="pg-streak"><strong>No streak right now</strong><span>Finish every workout in a week to start one</span></p>`;
}

function cycleNav(cycle) {
  const list = [...store.cycles()].reverse(); // oldest first
  if (list.length < 2) return html`<p class="pg-cycle-name">${cycle.name}</p>`;
  const i = list.findIndex((c) => c.id === cycle.id);
  return html`<div class="week-nav pg-cycle-nav">
    <button type="button" class="btn-tool icon-only" data-action="cycle" data-dir="-1" aria-label="Earlier cycle" ${i <= 0 ? 'disabled' : ''}>${icon('back')}</button>
    <p class="wk-title"><strong>${cycle.name}</strong></p>
    <button type="button" class="btn-tool icon-only" data-action="cycle" data-dir="1" aria-label="Later cycle" ${i >= list.length - 1 ? 'disabled' : ''}>${icon('next')}</button>
  </div>`;
}

function weekRow(r) {
  const days = r.days.filter((d) => d.logged).map((d) => WEEKDAYS[r.days.indexOf(d)].long);
  const count = r.started && r.planned ? `${r.done}/${r.planned}` : '–';
  const said = r.started
    ? `Week ${r.week}: ${r.done} of ${r.planned} workouts${days.length ? `, trained ${days.join(', ')}` : ''}`
    : `Week ${r.week}: not started`;
  return html`<li class="pg-week${r.started && r.planned && r.done >= r.planned ? ' full' : ''}">
    <span class="sr-only">${said}</span>
    <span class="wk" aria-hidden="true">W${r.week}</span>
    ${r.days.map((d) => html`<i class="sq${d.logged ? ' on' : ''}${d.today ? ' today' : ''}${d.future ? ' future' : ''}" aria-hidden="true"></i>`)}
    <span class="ct" aria-hidden="true">${count}</span>
  </li>`;
}

function calendar(cycle) {
  return html`<section class="card pg-cal">
    ${streakLine()}
    ${cycleNav(cycle)}
    <div class="pg-week pg-head" aria-hidden="true"><span></span>${WEEKDAYS.map((w) => html`<span>${w.short[0]}</span>`)}<span></span></div>
    <ol class="pg-weeks">${stats.cycleWeeks(cycle).map(weekRow)}</ol>
  </section>`;
}

// ---------- body weight ----------

const bwValue = (b) => training.convert(b.weight, b.unit, training.unit());
const fmtBw = (b) => `${training.fmtNum(bwValue(b))} ${training.unit()}`;
const bwDay = (iso) => (iso === todayISO() ? 'Today' : fmtShortWeekday(parseISO(iso)));
const bwDayMid = (iso) => (iso === todayISO() ? 'today' : bwDay(iso));

function bodyweightCard(cycle) {
  const u = training.unit();
  const all = store.bodyweights();
  const todays = all.find((b) => b.date === todayISO());
  const inCycle = stats.bodyweightsIn(cycle);
  let trend = '';
  if (inCycle.length > 1) {
    const start = cycleStartMonday(cycle);
    const span = cycle.weeks * 7 - 1;
    const points = inCycle.map((b) => ({ x: daysBetween(start, parseISO(b.date)) / span, y: bwValue(b) }));
    const first = inCycle[0];
    const last = inCycle[inCycle.length - 1];
    const diff = Math.round((bwValue(last) - bwValue(first)) * 10) / 10;
    const change = diff === 0 ? `same as ${fmtDay(parseISO(first.date))}`
      : `${diff < 0 ? 'down' : 'up'} ${training.fmtNum(Math.abs(diff))} ${u} since ${fmtDay(parseISO(first.date))}`;
    trend = html`${lineChart({
      points,
      scale: niceScale(points.map((p) => p.y)),
      xLabels: [{ x: 0, text: 'W1' }, { x: 1, text: `W${cycle.weeks}` }],
      label: `Body weight in ${cycle.name}: ${change}, latest ${fmtBw(last)}`,
      unit: u,
    })}<p class="pg-note">${cycle.name}: ${change}</p>`;
  }
  const recent = [...all].reverse().slice(0, 5);
  return html`<section class="card pg-bw">
    <form class="pg-bw-form" data-form="bodyweight">
      <label class="field grow"><span class="field-label">${todays ? `Today · ${fmtBw(todays)}` : 'Today’s weight'}<span class="sr-only">, in ${u}</span></span>
        <span class="input-unit"><input class="input" id="bw-input" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done"
          placeholder="${todays ? 'Change it' : ''}"><span class="unit" aria-hidden="true">${u}</span></span>
      </label>
      <button type="submit" class="btn btn-primary">${todays ? 'Update' : 'Save'}</button>
    </form>
    ${trend}
    ${recent.length ? html`<ul class="pg-bw-list" aria-label="Recent weights">
      ${recent.map((b) => html`<li><span class="grow">${bwDay(b.date)}</span><span class="v">${fmtBw(b)}</span>
        <button type="button" class="btn-tool icon-only" data-action="bw-delete" data-id="${b.id}" aria-label="Delete ${fmtBw(b)} from ${bwDayMid(b.date)}">${icon('trash')}</button></li>`)}
    </ul>` : html`<p class="pg-note">Weigh in now and then, same time of day, and the trend shows up here.</p>`}
  </section>`;
}

// ---------- exercises ----------

function exerciseRow(ex, cycle) {
  const latest = stats.exerciseSessions(ex.id, cycle.id)[0];
  const top = latest && stats.topSet(latest.sets, ex);
  return html`<a class="pg-ex pressable" href="#/progress/exercise/${ex.id}?cycle=${cycle.id}">
    <span class="grow">${ex.name}</span>
    <span class="meta">${top ? training.summarize([top], ex) : ''}</span>${icon('next')}
  </a>`;
}

function exerciseList(cycle) {
  const groups = stats.loggedExercises(cycle);
  if (!groups.length) {
    return html`<section class="card empty"><p>Log a workout in ${cycle.name} and each exercise’s history shows up here.</p></section>`;
  }
  return html`<div class="stack">${groups.map((g) => html`<section class="card pg-group">
    <h3>${dayName(g.day)}${g.day.deleted ? ' (removed)' : ''}</h3>
    ${g.exercises.map((ex) => exerciseRow(ex, cycle))}
  </section>`)}</div>`;
}

export default {
  tab: 'progress',
  depth: 0,
  title: () => 'Progress',

  render() {
    const cycle = chosenCycle();
    if (!cycle) return html`<header class="screen-head"><h1>Progress</h1></header>`;
    const n = store.workoutCount(cycle.id);
    return html`
      <header class="screen-head"><h1 tabindex="-1">Progress</h1><p class="sub">${cycleSub(cycle)} · ${plural(n, 'workout')}</p></header>
      ${calendar(cycle)}
      <div class="section-head"><h2>Body weight</h2></div>
      ${bodyweightCard(cycle)}
      <div class="section-head"><h2>Exercises</h2></div>
      ${exerciseList(cycle)}
    `;
  },

  reselect() { cycleId = null; },
  resume({ rerender }) { rerender(); },

  actions: {
    cycle(el, e, { rerender }) {
      const list = [...store.cycles()].reverse();
      const i = list.findIndex((c) => c.id === chosenCycle().id) + Number(el.dataset.dir);
      if (!list[i]) return;
      cycleId = list[i].id;
      rerender();
      document.querySelector(`.pg-cycle-nav [data-dir="${el.dataset.dir}"]:not(:disabled)`)?.focus()
        || document.querySelector('.pg-cycle-nav button:not(:disabled)')?.focus();
    },
    async 'bw-delete'(el, e, { rerender }) {
      const rec = store.get('bodyweights', el.dataset.id);
      if (!rec) return;
      const buttons = [...document.querySelectorAll('[data-action="bw-delete"]')];
      const at = buttons.indexOf(el);
      const items = await store.removeBodyweight(rec.id);
      rerender();
      // focus the row that moved into its place (or the one above), never the text box: that would raise the keyboard
      const left = [...document.querySelectorAll('[data-action="bw-delete"]')];
      (left[at] || left[at - 1] || document.querySelector('[data-form="bodyweight"] button[type="submit"]'))?.focus({ preventScroll: true });
      toast(`Deleted ${fmtBw(rec)} from ${bwDayMid(rec.date)}`, {
        action: {
          label: 'Undo',
          run: async () => {
            if (await store.restoreBodyweight(items)) rerender();
            else toast('That day has a newer weight now, so it was kept.');
          },
        },
      });
    },
  },

  mount(view, { rerender }) {
    view.querySelector('[data-form="bodyweight"]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = view.querySelector('#bw-input');
      const w = training.parseWeight(input.value);
      const u = training.unit();
      const [lo, hi] = u === 'lb' ? [40, 900] : [20, 400];
      if (w == null) return input.focus();
      if (Number.isNaN(w) || w < lo || w > hi) {
        toast(`Enter your weight in ${u}, like ${u === 'lb' ? '160.5' : '72.5'}`);
        return input.focus();
      }
      try {
        await store.saveBodyweight(todayISO(), w, u);
      } catch (err) {
        console.error(err);
        return toast('That didn’t save. Try again.');
      }
      input.blur();
      rerender();
      toast(`Saved ${training.fmtNum(w)} ${u} for today`);
    });
  },
};
