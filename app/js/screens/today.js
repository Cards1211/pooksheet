// Today: pick a week and day (today by default, any past day for back-filling),
// then log each exercise's sets beside last time's numbers.
import * as store from '../store.js';
import * as training from '../training.js';
import { html, icon, range, clamp } from '../util.js';
import {
  WEEKDAYS, weekday, todayISO, toISO, parseISO, isoWeekday, dateFor, addDays,
  fmtDay, fmtLong, fmtShortWeekday, cycleEnd,
} from '../dates.js';
import { toast } from '../ui.js';
import * as timer from '../timer.js';
import { dayName } from './common.js';

let sel = null;               // { cycleId, week, wd }
const drafts = new Map();     // `${cardKey}|${i}` -> { weight, reps } typed but not logged yet
const extraRows = new Map();  // cardKey -> rows added beyond the minimum
const notesOpen = new Set();  // cardKey

const cardKey = (dayId, week, exId) => `${dayId}|${week}|${exId}`;

function todaySel(cycle) {
  return {
    cycleId: cycle.id,
    week: clamp(store.currentWeek(cycle), 1, cycle.weeks),
    wd: isoWeekday(parseISO(todayISO())),
  };
}
/** Weeks up to the current one can be opened; later weeks can't be logged yet. */
const lastOpenWeek = (cycle) => clamp(store.currentWeek(cycle), 1, cycle.weeks);
const selectionDate = (cycle) => dateFor(cycle, sel.week, sel.wd);

// ---------- pieces ----------

/** "Nov 2 – 8" or "Oct 26 – Nov 1" */
function weekRange(monday) {
  const sunday = addDays(monday, 6);
  return monday.getMonth() === sunday.getMonth()
    ? `${fmtDay(monday)} – ${sunday.getDate()}`
    : `${fmtDay(monday)} – ${fmtDay(sunday)}`;
}

function weekNav(cycle) {
  const monday = dateFor(cycle, sel.week, 1);
  return html`<div class="week-nav">
    <button type="button" class="btn-tool icon-only" data-action="week" data-dir="-1" aria-label="Previous week" ${sel.week <= 1 ? 'disabled' : ''}>${icon('back')}</button>
    <p class="wk-title"><strong>Week ${sel.week}</strong> <span>${weekRange(monday)}</span></p>
    <button type="button" class="btn-tool icon-only" data-action="week" data-dir="1" aria-label="Next week" ${sel.week >= lastOpenWeek(cycle) ? 'disabled' : ''}>${icon('next')}</button>
  </div>`;
}

function dayStrip(cycle) {
  const today = todayISO();
  return html`<div class="weekdays day-strip" role="group" aria-label="Days of week ${sel.week}">
    ${WEEKDAYS.map((w) => {
      const d = store.dayForWeekday(cycle.id, w.n);
      const s = d && store.findSession(cycle.id, d.id, sel.week);
      const logged = !!(s && store.setsOf(s.id).length);
      const isToday = toISO(dateFor(cycle, sel.week, w.n)) === today;
      const label = `${w.long}${d ? `, ${dayName(d)}` : ', rest day'}${logged ? ', logged' : ''}${isToday ? ', today' : ''}`;
      return html`<button type="button" class="wd ${logged ? 'logged' : ''} ${isToday ? 'is-today' : ''}" data-action="pick-day" data-wd="${w.n}"
        aria-pressed="${String(w.n === sel.wd)}" aria-label="${label}" ${d ? '' : 'disabled'}>${w.two}</button>`;
    })}
  </div>`;
}

function setRow({ key, i, set, ghost, ex, target, pr }) {
  const u = training.unitFor(ex);
  const isBW = ex.loadType === 'bodyweight';
  const plus = ex.loadType === 'bodyweight_plus';
  const unitLabel = plus ? `+${u}` : u;
  const n = i + 1;

  if (set) {
    // a logged set keeps the unit it was logged in
    const w = training.fmtNum(set.weight);
    const setUnit = set.unit || u;
    return html`<div class="set-row is-done" data-key="${key}" data-i="${i}">
      <span class="set-n">${n}${pr ? html`<span class="pr-mark" title="Personal record">${icon('star')}</span>` : ''}</span>
      ${isBW ? html`<span class="bw">Bodyweight</span>` : html`<span class="num num-done"><span>${w || '0'}</span><span class="unit">${plus ? `+${setUnit}` : setUnit}</span></span>`}
      <span class="num num-done"><span>${set.reps}</span><span class="unit">reps</span></span>
      <button type="button" class="check" data-action="log" aria-pressed="true" aria-label="Set ${n} logged${pr ? ', personal record' : ''}. Tap to change it.">${icon('check')}</button>
    </div>`;
  }

  const draft = drafts.get(`${key}|${i}`) || {};
  const wGhost = ghost && !isBW ? training.fmtNum(training.convert(ghost.weight ?? (plus ? 0 : null), ghost.unit, u)) : '';
  const rGhost = ghost?.reps != null ? String(ghost.reps) : target ? range(target.repsMin, target.repsMax) : '';
  return html`<div class="set-row" data-key="${key}" data-i="${i}">
    <span class="set-n">${n}</span>
    ${isBW ? html`<span class="bw">Bodyweight</span>` : html`<label class="num">
      <input class="num-input" data-kind="weight" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="next"
        value="${draft.weight ?? ''}" placeholder="${wGhost}" aria-label="Set ${n} ${plus ? 'added weight' : 'weight'} in ${u}">
      <span class="unit">${unitLabel}</span></label>`}
    <label class="num">
      <input class="num-input" data-kind="reps" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" enterkeyhint="done"
        value="${draft.reps ?? ''}" placeholder="${rGhost}" aria-label="Set ${n} reps">
      <span class="unit">reps</span></label>
    <button type="button" class="check" data-action="log" aria-pressed="false" aria-label="Log set ${n}">${icon('check')}</button>
  </div>`;
}

function exerciseCard({ day, week, dateISO, session, slot, ex }) {
  const key = cardKey(day.id, week, ex.id);
  const u = training.unitFor(ex);
  const target = slot ? store.targetsFor(slot, week) : null;
  const logged = session ? store.setsOf(session.id, ex.id) : [];
  const byIndex = new Map(logged.map((s) => [s.index, s]));
  const last = training.lastPerformance(ex.id, dateISO, session?.id);
  const prs = session ? training.sessionPRs(session.id, ex.id) : new Map();
  const hint = logged.length === 0 ? training.overloadHint(ex, target, last) : null;
  const base = target ? target.setsMin : Math.max(1, last?.sets.length || 1);
  const maxLogged = logged.length ? Math.max(...logged.map((s) => s.index)) : -1;
  const added = extraRows.get(key) || 0;
  const rows = Math.max(base + added, maxLogged + 1);
  const canRemove = added > 0 && rows - 1 > maxLogged && rows > base;
  const note = session ? store.noteOf(session.id, ex.id)?.text || '' : '';
  const showNote = notesOpen.has(key) || !!note;

  const rowHtml = [];
  for (let i = 0; i < rows; i++) {
    const ghost = last ? last.sets[i] || last.sets[last.sets.length - 1] : null;
    const set = byIndex.get(i);
    rowHtml.push(setRow({ key, i, set, ghost, ex, target, pr: !!set && prs.has(set.id) }));
  }

  return html`<li class="card log-card" data-key="${key}" data-ex="${ex.id}" data-slot="${slot?.id || ''}">
    <div class="log-head">
      <h3 class="log-name">${ex.name}${ex.lp ? html` <span class="badge" title="Lengthened partials">LP</span>` : ''}</h3>
      <span class="log-target">${target ? `${range(target.setsMin, target.setsMax)} × ${range(target.repsMin, target.repsMax)}` : 'Not in the plan'}</span>
    </div>
    ${ex.cue ? html`<p class="cue">${ex.cue}</p>` : ''}
    <p class="last">${last ? html`<strong>${last.label}</strong> · ${training.summarize(last.sets, ex)}` : 'First time logging this exercise.'}</p>
    ${last?.note ? html`<p class="last-note">“${last.note}”</p>` : ''}
    ${hint ? html`<div class="overload"><span class="overload-icon">${icon('up-arrow', 'icon-sm')}</span><span class="overload-text">Every set hit ${hint.reps}+ reps last time. Try ${training.fmtNum(hint.to)} ${u}.</span>
      <button type="button" class="btn-tool" data-action="use-hint" data-w="${hint.to}">Use</button></div>` : ''}
    <div class="sets">${rowHtml}</div>
    <div class="log-tools">
      <button type="button" class="btn-tool" data-action="add-row">${icon('plus', 'icon-sm')}Add set</button>
      ${canRemove ? html`<button type="button" class="btn-tool" data-action="remove-row">${icon('minus', 'icon-sm')}Remove set</button>` : ''}
      ${ex.loadType === 'bodyweight' ? '' : html`<div class="unit-toggle" role="group" aria-label="Weight unit for ${ex.name}">
        ${['kg', 'lb'].map((x) => html`<button type="button" class="unit-btn" data-action="unit" data-u="${x}" aria-pressed="${String(u === x)}">${x}</button>`)}
      </div>`}
      <span class="spacer"></span>
      ${ex.link ? html`<a class="btn-tool" href="${ex.link}" target="_blank" rel="noopener noreferrer">${icon('link', 'icon-sm')}Video</a>` : ''}
      ${showNote ? '' : html`<button type="button" class="btn-tool" data-action="note-open">Note</button>`}
    </div>
    ${showNote ? html`<label class="field note-field"><span class="sr-only">Note for ${ex.name}</span>
      <textarea class="input note-input" data-kind="note" rows="2" maxlength="500" placeholder="How did it feel? Anything for next week?">${note}</textarea></label>` : ''}
  </li>`;
}

function workout(cycle, day, week, dateISO) {
  const session = store.findSession(cycle.id, day.id, week);
  const slotList = store.slots(day.id);
  const planIds = new Set(slotList.map((s) => s.exerciseId));
  const loggedSets = session ? store.setsOf(session.id) : [];
  // exercises logged that day but no longer in the plan (e.g. swapped out later) still show
  const extras = [...new Set(loggedSets.map((s) => s.exerciseId))].filter((id) => !planIds.has(id));
  const planned = slotList.reduce((n, s) => n + store.targetsFor(s, week).setsMin, 0);
  const cards = [
    ...slotList.map((slot) => ({ slot, ex: store.get('exercises', slot.exerciseId) })),
    ...extras.map((id) => ({ slot: null, ex: store.get('exercises', id) })),
  ].filter((c) => c.ex);

  if (!cards.length) {
    return { done: 0, planned: 0, html: html`<section class="card empty" style="margin-top:16px"><h2>No exercises on ${weekday(day.weekday).long} yet</h2>
      <p>Add them in Program, then come back to log.</p>
      <a class="btn btn-secondary btn-block" href="#/program/day/${day.id}">Add exercises</a></section>` };
  }
  return {
    done: loggedSets.length,
    planned,
    html: html`<ol class="log-list">${cards.map(({ slot, ex }) => exerciseCard({ day, week, dateISO, session, slot, ex }))}</ol>`,
  };
}

function nextTrainingDay(cycleId, fromWd) {
  const days = store.days(cycleId);
  for (let k = 1; k <= 7; k++) {
    const wd = ((fromWd - 1 + k) % 7) + 1;
    const d = days.find((x) => x.weekday === wd);
    if (d) return d;
  }
  return null;
}

// ---------- logging ----------

/**
 * After logging set `index` of `exId`: whether that completes every planned set of the day,
 * and the exercise that is probably next (more of this one, else the next card with sets left).
 */
function afterSet(cycle, day, week, exId, index) {
  const session = store.findSession(cycle.id, day.id, week);
  const logged = session ? store.setsOf(session.id) : [];
  const slots = store.slots(day.id);
  const open = slots.filter((slot) => {
    const have = new Set(logged.filter((s) => s.exerciseId === slot.exerciseId).map((s) => s.index));
    if (slot.exerciseId === exId) have.add(index);
    return have.size < store.targetsFor(slot, week).setsMin;
  });
  const at = slots.findIndex((s) => s.exerciseId === exId);
  const next = open.find((s) => s.exerciseId === exId) || open.find((s) => slots.indexOf(s) > at) || open[0];
  return { dayDone: open.length === 0, next: next ? store.get('exercises', next.exerciseId)?.name || '' : '' };
}

function cardContext(card) {
  const cycle = store.activeCycle();
  return {
    cycle,
    day: store.dayForWeekday(cycle.id, sel.wd),
    ex: store.get('exercises', card.dataset.ex),
    slot: card.dataset.slot ? store.get('slots', card.dataset.slot) : null,
    dateISO: toISO(selectionDate(cycle)),
    week: sel.week,
    key: card.dataset.key,
  };
}

async function logSet(el, rerender) {
  const row = el.closest('.set-row');
  const card = el.closest('.log-card');
  const i = Number(row.dataset.i);
  const { cycle, day, ex, slot, dateISO, week, key } = cardContext(card);
  const u = training.unitFor(ex);
  const session0 = store.findSession(cycle.id, day.id, week);
  const existing = session0 && store.setsOf(session0.id, ex.id).find((s) => s.index === i);

  if (existing) {
    // Reopen a logged set: its numbers go back into the boxes so they can be corrected.
    drafts.set(`${key}|${i}`, {
      weight: ex.loadType === 'bodyweight' ? '' : training.fmtNum(training.convert(existing.weight, existing.unit, u)),
      reps: training.fmtNum(existing.reps),
    });
    const items = await store.removeSet(existing.id);
    rerender();
    toast(`Set ${i + 1} reopened to edit`, {
      action: {
        label: 'Undo',
        run: async () => {
          if (await store.restoreSet(items)) { drafts.delete(`${key}|${i}`); rerender(); }
          else toast(`Set ${i + 1} was logged again, so the new numbers were kept.`);
        },
      },
    });
    return;
  }

  const wInput = row.querySelector('[data-kind="weight"]');
  const rInput = row.querySelector('[data-kind="reps"]');
  let weight = null;
  if (ex.loadType !== 'bodyweight') {
    weight = training.parseWeight(wInput.value || wInput.placeholder);
    if (Number.isNaN(weight)) { wInput.focus(); return toast('Weight should be a number, like 22.5.'); }
    if (weight == null) {
      if (ex.loadType === 'bodyweight_plus') weight = 0;
      else { wInput.focus(); return toast('Type the weight first.'); }
    }
  }
  const repsSrc = rInput.value || (/^\d+$/.test(rInput.placeholder) ? rInput.placeholder : '');
  const reps = training.parseReps(repsSrc);
  if (reps == null) { rInput.focus(); return toast('Type the reps first.'); }
  if (Number.isNaN(reps)) { rInput.focus(); return toast('Reps should be a whole number.'); }

  document.activeElement?.blur?.();
  // Start the rest now, inside the tap, so iOS allows its sound. Past days are back-filling, so no
  // timer; today or a later day (a cycle started early) is a live workout. ISO dates sort as text.
  // The day's last planned set ends the workout instead: no rest, and no beep later.
  if (dateISO >= todayISO()) {
    const { dayDone, next } = afterSet(cycle, day, week, ex.id, i);
    if (dayDone) timer.stop();
    else {
      timer.unlockAudio();
      timer.start({ seconds: ex.restSec || 90, exerciseId: ex.id, label: ex.name, next });
    }
  }
  const session = await store.ensureSession(cycle.id, day.id, week, dateISO);
  const saved = await store.saveSet({ sessionId: session.id, exerciseId: ex.id, slotId: slot?.id, index: i, weight, unit: u, reps });
  drafts.delete(`${key}|${i}`);
  rerender();
  if (training.sessionPRs(session.id, ex.id).has(saved.id)) {
    const w = ex.loadType === 'bodyweight' ? 'Bodyweight' : `${training.fmtNum(weight)} ${u}`;
    toast(`New PR on ${ex.name}: ${w} × ${reps}`);
  }
}

// ---------- screen ----------

const screen = {
  tab: 'today',
  depth: 0,
  title: () => 'Today',

  /** Tapping the Today tab again jumps back to today. */
  reselect() { sel = null; },

  render() {
    const cycle = store.activeCycle();
    if (!cycle) {
      return html`<header class="screen-head"><h1>Today</h1><p class="sub">${fmtLong(parseISO(todayISO()))}</p></header>
        <section class="card empty"><h2>No active cycle</h2><p>Start one from Program.</p>
        <a class="btn btn-primary btn-block" href="#/program">Open Program</a></section>`;
    }
    if (!sel || sel.cycleId !== cycle.id) sel = todaySel(cycle);
    sel.week = clamp(sel.week, 1, lastOpenWeek(cycle));
    const date = selectionDate(cycle);
    const dateISO = toISO(date);
    const isToday = dateISO === todayISO();
    const day = store.dayForWeekday(cycle.id, sel.wd);
    const wkNow = store.currentWeek(cycle);

    let banner = '';
    if (wkNow > cycle.weeks) {
      banner = html`<section class="card empty" style="margin-bottom:16px"><h2>${cycle.name} ended ${fmtDay(cycleEnd(cycle))}</h2>
        <p>You can still fill in missed days. Start the next cycle in Program.</p></section>`;
    } else if (wkNow < 1) {
      banner = html`<section class="card empty" style="margin-bottom:16px"><h2>${cycle.name} starts ${fmtShortWeekday(parseISO(cycle.startDate))}</h2>
        <p>Week 1 is open in case you start early.</p></section>`;
    }

    let body;
    let count = '';
    if (day) {
      const w = workout(cycle, day, sel.week, dateISO);
      body = w.html;
      if (w.planned) count = html`<span class="head-count" aria-label="${w.done} of ${w.planned} sets logged">${w.done} / ${w.planned} sets</span>`;
    } else {
      const next = nextTrainingDay(cycle.id, sel.wd);
      body = html`<section class="card empty" style="margin-top:16px"><h2>Rest day</h2>
        <p>${next ? `Next: ${weekday(next.weekday).long}, ${dayName(next)}. Pick a day above to log a different one.` : 'No training days are set yet.'}</p>
        ${next ? '' : html`<a class="btn btn-primary btn-block" href="#/program">Set up your days</a>`}</section>`;
    }

    return html`
      <header class="screen-head today-head">
        <div class="title-row"><h1>${isToday ? (day ? dayName(day) : 'Rest day') : fmtShortWeekday(date)}</h1>${count}</div>
        <div class="sub-row">
          <p class="sub">${isToday ? `Today · ${fmtShortWeekday(date)}` : (day ? dayName(day) : 'Rest day')}</p>
          ${isToday ? '' : html`<button type="button" class="btn-tool" data-action="go-today">Back to today</button>`}
        </div>
      </header>
      ${banner}
      ${weekNav(cycle)}
      ${dayStrip(cycle)}
      ${body}
    `;
  },

  actions: {
    week(el, e, { rerender }) {
      sel.week = clamp(sel.week + Number(el.dataset.dir), 1, lastOpenWeek(store.activeCycle()));
      rerender();
    },
    'pick-day'(el, e, { rerender }) {
      sel.wd = Number(el.dataset.wd);
      rerender();
    },
    'go-today'(el, e, { rerender }) {
      sel = null;
      rerender();
      window.scrollTo({ top: 0 });
    },
    log: (el, e, { rerender }) => logSet(el, rerender),
    'add-row'(el, e, { rerender }) {
      const key = el.closest('.log-card').dataset.key;
      extraRows.set(key, (extraRows.get(key) || 0) + 1);
      rerender();
    },
    'remove-row'(el, e, { rerender }) {
      const key = el.closest('.log-card').dataset.key;
      extraRows.set(key, Math.max(0, (extraRows.get(key) || 0) - 1));
      rerender();
    },
    async unit(el, e, { rerender }) {
      const ex = store.get('exercises', el.closest('.log-card').dataset.ex);
      const u = el.dataset.u;
      if (training.unitFor(ex) === u) return;
      // follow the app setting when it matches it; remember the exception otherwise
      await store.patch('exercises', ex.id, { unit: u === training.unit() ? null : u });
      rerender();
    },
    'use-hint'(el, e, { rerender }) {
      const card = el.closest('.log-card');
      for (const row of card.querySelectorAll('.set-row:not(.is-done)')) {
        const k = `${card.dataset.key}|${row.dataset.i}`;
        drafts.set(k, { ...(drafts.get(k) || {}), weight: training.fmtNum(Number(el.dataset.w)) });
      }
      rerender();
    },
    'note-open'(el, e, { rerender }) {
      const key = el.closest('.log-card').dataset.key;
      notesOpen.add(key);
      rerender();
      document.querySelector(`.log-card[data-key="${key}"] .note-input`)?.focus();
    },
  },

  input(e) {
    const t = e.target;
    if (!t.classList?.contains('num-input')) return;
    const k = `${t.closest('.log-card').dataset.key}|${t.closest('.set-row').dataset.i}`;
    drafts.set(k, { ...(drafts.get(k) || {}), [t.dataset.kind]: t.value });
  },

  async change(e) {
    const t = e.target;
    if (t.dataset?.kind !== 'note') return;
    const { cycle, day, ex, dateISO, week, key } = cardContext(t.closest('.log-card'));
    const text = t.value.trim();
    const existing = store.findSession(cycle.id, day.id, week);
    if (!existing && !text) return;
    const session = existing || await store.ensureSession(cycle.id, day.id, week, dateISO);
    await store.saveNote(session.id, ex.id, text);
    if (!text) notesOpen.delete(key);
  },

  keydown(e) {
    const t = e.target;
    if (e.key !== 'Enter') return;
    if (t.dataset?.kind === 'weight') {
      e.preventDefault();
      t.closest('.set-row').querySelector('[data-kind="reps"]')?.focus();
    } else if (t.dataset?.kind === 'reps') {
      e.preventDefault();
      t.blur();
    }
  },
};

export default screen;
