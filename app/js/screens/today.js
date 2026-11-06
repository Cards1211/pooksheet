// Today: pick a date (today by default, any past day for back-filling) and which workout you
// did on it, then log each exercise's sets beside last time's numbers.
import * as store from '../store.js';
import * as training from '../training.js';
import { html, icon, range, clamp, plural } from '../util.js';
import {
  WEEKDAYS, weekday, todayISO, toISO, parseISO, isoWeekday, dateFor, addDays,
  fmtDay, fmtLong, fmtShortWeekday, cycleEnd, weekNumber, mondayOf,
} from '../dates.js';
import { toast } from '../ui.js';
import * as timer from '../timer.js';
import { dayName } from './common.js';

let sel = null;               // { cycleId, date, dayId, picking, opened }: what's on screen
const drafts = new Map();     // `${cardKey}|${i}` -> { weight, reps } typed but not logged yet
const extraRows = new Map();  // cardKey -> rows added beyond the minimum
const notesOpen = new Set();  // cardKey

const LATE_WORKOUT_MS = 3 * 60 * 60 * 1000;

const cardKey = (dayId, date, exId) => `${dayId}|${date}|${exId}`;
const weekOf = (cycle, date) => clamp(weekNumber(cycle, date), 1, cycle.weeks);
/** Weeks up to the current one can be opened; later weeks can't be logged yet. */
const lastOpenWeek = (cycle) => clamp(store.currentWeek(cycle), 1, cycle.weeks);
/** The latest date that can be opened: today, or the cycle's last day once it has ended. */
function latestDate(cycle) {
  const end = toISO(cycleEnd(cycle));
  return todayISO() > end ? end : todayISO();
}
const newSel = (cycle) => ({ cycleId: cycle.id, date: latestDate(cycle), dayId: null, picking: false, opened: todayISO() });

/**
 * A live workout: logging for today, or one that began on its own date and had a set in the
 * last 3 hours (a late session running past midnight). Back-filling a past day is neither.
 */
function isLive(dateISO, session) {
  if (dateISO >= todayISO()) return true;
  if (!session?.startedAt || toISO(new Date(session.startedAt)) !== session.date) return false;
  const last = Math.max(0, ...store.setsOf(session.id).map((s) => Date.parse(s.updatedAt)));
  return Date.now() - last < LATE_WORKOUT_MS;
}

/** A new calendar day goes back to today, unless a workout is still running past midnight. */
function isStale(cycle) {
  if (sel.cycleId !== cycle.id) return true;
  if (sel.opened === todayISO()) return false;
  return !(sel.dayId && isLive(sel.date, store.findSession(sel.dayId, sel.date)));
}

/** A rerender replaces the screen, so put keyboard and VoiceOver focus back somewhere sensible. */
function refocus(selector) {
  const el = (selector && document.querySelector(selector)) || document.querySelector('#view h1');
  el?.focus({ preventScroll: true });
}

// ---------- pieces ----------

/** "Nov 2 – 8" or "Oct 26 – Nov 1" */
function weekRange(monday) {
  const sunday = addDays(monday, 6);
  return monday.getMonth() === sunday.getMonth()
    ? `${fmtDay(monday)} – ${sunday.getDate()}`
    : `${fmtDay(monday)} – ${fmtDay(sunday)}`;
}

function weekNav(cycle, week) {
  const monday = dateFor(cycle, week, 1);
  return html`<div class="week-nav">
    <button type="button" class="btn-tool icon-only" data-action="week" data-dir="-1" aria-label="Previous week" ${week <= 1 ? 'disabled' : ''}>${icon('back')}</button>
    <p class="wk-title"><strong>Week ${week}</strong> <span>${weekRange(monday)}</span></p>
    <button type="button" class="btn-tool icon-only" data-action="week" data-dir="1" aria-label="Next week" ${week >= lastOpenWeek(cycle) ? 'disabled' : ''}>${icon('next')}</button>
  </div>`;
}

function dayStrip(cycle, week) {
  const today = todayISO();
  return html`<div class="weekdays day-strip" role="group" aria-label="Days of week ${week}">
    ${WEEKDAYS.map((w) => {
      const date = dateFor(cycle, week, w.n);
      const iso = toISO(date);
      const names = store.sessionsOn(cycle.id, iso).map((s) => store.get('days', s.dayId)).filter(Boolean).map(dayName);
      const isToday = iso === today;
      const label = `${w.long}, ${fmtDay(date)}${names.length ? `, logged ${names.join(' and ')}` : ''}${isToday ? ', today' : ''}`;
      return html`<button type="button" class="wd ${names.length ? 'logged' : ''} ${isToday ? 'is-today' : ''}" data-action="pick-date" data-date="${iso}"
        aria-pressed="${String(iso === sel.date)}" aria-label="${label}" ${iso > today ? 'disabled' : ''}>${w.two}</button>`;
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
  const key = cardKey(day.id, dateISO, ex.id);
  const u = training.unitFor(ex);
  const target = slot ? store.targetsFor(slot, week) : null;
  const logged = session ? store.setsOf(session.id, ex.id) : [];
  const byIndex = new Map(logged.map((s) => [s.index, s]));
  const last = training.lastPerformance(ex.id, dateISO, session?.id, day);
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

function workout(cycle, day, dateISO) {
  const week = weekOf(cycle, dateISO);
  const session = store.findSession(day.id, dateISO);
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
    return { done: 0, planned: 0, html: html`<section class="card empty" style="margin-top:16px"><h2>No exercises in ${dayName(day)} yet</h2>
      <p>Add them in Program, then come back to log.</p>
      <a class="btn btn-secondary btn-block" href="#/program/day/${day.id}">Add exercises</a></section>` };
  }
  return {
    done: loggedSets.length,
    planned,
    html: html`<ol class="log-list">${cards.map(({ slot, ex }) => exerciseCard({ day, week, dateISO, session, slot, ex }))}</ol>`,
  };
}

/** A week's workouts: still to do (starting after the last one done, so the next is first) and done. */
function weekPlan(cycle, week) {
  const list = store.days(cycle.id);
  const sessions = store.sessions(cycle.id).filter((s) => s.week === week && store.setsOf(s.id).length);
  const doneOn = new Map(sessions.map((s) => [s.dayId, s.date]));
  const lastDone = sessions.length ? list.findIndex((d) => d.id === sessions[sessions.length - 1].dayId) : -1;
  const rotated = lastDone < 0 ? list : [...list.slice(lastDone + 1), ...list.slice(0, lastDone + 1)];
  return { list, doneOn, todo: rotated.filter((d) => !doneOn.has(d.id)), done: list.filter((d) => doneOn.has(d.id)) };
}

function workoutCard(d, next) {
  const n = store.slots(d.id).length;
  return html`<button type="button" class="card wo-card pressable" data-action="pick-workout" data-day="${d.id}">
    <span class="grow"><span class="title">${dayName(d)}</span>
      <span class="meta">${n ? plural(n, 'exercise') : 'No exercises yet'}${next ? ' · next up' : ''}</span></span>
    ${next ? html`<span class="wo-start">Start</span>` : icon('next')}
  </button>`;
}

function doneRow(d, doneOn, dateISO, isToday, week) {
  const on = doneOn.get(d.id);
  const day = on === todayISO() ? 'Today' : weekday(isoWeekday(parseISO(on))).short;
  const logged = store.setsOf(store.findSession(d.id, on).id).length;
  const planned = store.slots(d.id).reduce((n, s) => n + store.targetsFor(s, week).setsMin, 0);
  const when = logged < planned ? `${day} · ${logged} of ${planned} sets` : day;
  const again = isToday ? 'today' : `on ${fmtShortWeekday(parseISO(dateISO))}`;
  return html`<div class="wo-done">
    <button type="button" class="wo-done-open pressable" data-action="open-logged" data-day="${d.id}" data-date="${on}" aria-label="Open ${dayName(d)}, logged ${when}">
      <span class="grow">${dayName(d)}</span><span class="when">${when}</span>
    </button>
    ${on === dateISO ? '' : html`<button type="button" class="btn-tool wo-again" data-action="pick-workout" data-day="${d.id}" aria-label="Do ${dayName(d)} again ${again}">Again</button>`}
  </div>`;
}

function pickerView(plan, dateISO, isToday, week, weekWord) {
  if (!plan.list.length) {
    return html`<section class="card empty" style="margin-top:16px"><h2>No workouts yet</h2>
      <p>Add your workouts in Program, then pick one here whenever you train.</p>
      <a class="btn btn-primary btn-block" href="#/program">Add workouts</a></section>`;
  }
  const question = isToday ? 'What are you doing today?' : `What did you do on ${fmtShortWeekday(parseISO(dateISO))}?`;
  // "Next up" only goes to a workout that has exercises to start, and it comes first.
  const next = isToday ? plan.todo.find((d) => store.slots(d.id).length) : null;
  const todo = next ? [next, ...plan.todo.filter((d) => d !== next)] : plan.todo;
  return html`
    ${todo.length
      ? html`<h2 class="wo-head">${question}</h2>
        <div class="wo-list">${todo.map((d) => workoutCard(d, d === next))}</div>`
      : html`<h2 class="wo-head">Every workout is done ${weekWord}</h2>`}
    ${plan.done.length ? html`${todo.length ? html`<h2 class="wo-head wo-head-sub">Done ${weekWord}</h2>` : ''}
      <div class="wo-list wo-done-list">${plan.done.map((d) => doneRow(d, plan.doneOn, dateISO, isToday, week))}</div>` : ''}`;
}

// ---------- logging ----------

/**
 * After logging set `index` of `exId`: whether that completes every planned set of the workout,
 * and the exercise that is probably next (more of this one, else the next card with sets left).
 */
function afterSet(day, week, dateISO, exId, index) {
  const session = store.findSession(day.id, dateISO);
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
    day: store.get('days', sel.dayId),
    ex: store.get('exercises', card.dataset.ex),
    slot: card.dataset.slot ? store.get('slots', card.dataset.slot) : null,
    dateISO: sel.date,
    week: weekOf(cycle, sel.date),
    key: card.dataset.key,
  };
}

async function logSet(el, rerender) {
  const row = el.closest('.set-row');
  const card = el.closest('.log-card');
  const i = Number(row.dataset.i);
  const { cycle, day, ex, slot, dateISO, week, key } = cardContext(card);
  const u = training.unitFor(ex);
  const session0 = store.findSession(day.id, dateISO);
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
  // Start the rest now, inside the tap, so iOS allows its sound. Back-filling a past day has no timer.
  // The workout's last planned set ends it instead: no rest, and no beep later.
  if (isLive(dateISO, session0)) {
    const { dayDone, next } = afterSet(day, week, dateISO, ex.id, i);
    if (dayDone) timer.stop();
    else {
      timer.unlockAudio();
      timer.start({ seconds: ex.restSec || 90, exerciseId: ex.id, label: ex.name, next });
    }
  }
  const session = await store.ensureSession(cycle, day.id, dateISO);
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

  /** Coming back to the app on a new calendar day. */
  resume({ rerender }) {
    const cycle = store.activeCycle();
    if (cycle && sel && isStale(cycle)) rerender();
  },

  render() {
    const cycle = store.activeCycle();
    const today = todayISO();
    if (!cycle) {
      return html`<header class="screen-head"><h1>Today</h1><p class="sub">${fmtLong(parseISO(today))}</p></header>
        <section class="card empty"><h2>No active cycle</h2><p>Start one from Program.</p>
        <a class="btn btn-primary btn-block" href="#/program">Open Program</a></section>`;
    }
    const wkNow = store.currentWeek(cycle);
    if (wkNow < 1) {
      const monday = mondayOf(parseISO(today));
      const earlyEnd = cycleEnd({ ...cycle, startDate: today });
      return html`<header class="screen-head"><h1>Today</h1><p class="sub">${fmtShortWeekday(parseISO(today))}</p></header>
        <section class="card empty"><h2>${cycle.name} starts ${fmtShortWeekday(parseISO(cycle.startDate))}</h2>
          <p>Starting early? Today would make ${weekRange(monday)} your Week 1, and the cycle would end ${fmtDay(earlyEnd)} instead of ${fmtDay(cycleEnd(cycle))}.</p>
          <button type="button" class="btn btn-primary btn-block" data-action="start-today">Start today</button></section>`;
    }
    if (sel && isStale(cycle)) sel = null;
    if (!sel) sel = newSel(cycle);
    const dateISO = sel.date;
    const date = parseISO(dateISO);
    const isToday = dateISO === today;
    const week = weekOf(cycle, dateISO);

    // The workout on screen: the one picked, or the one already logged on this date.
    let day = null;
    if (!sel.picking) {
      if (sel.dayId) day = store.get('days', sel.dayId);
      if (day?.deleted && !store.findSession(day.id, dateISO)) day = null;
      if (!day) {
        const on = store.sessionsOn(cycle.id, dateISO)[0];
        day = on ? store.get('days', on.dayId) : null;
      }
      sel.dayId = day?.id || null;
    }

    let body;
    let count = '';
    if (day) {
      const w = workout(cycle, day, dateISO);
      body = w.html;
      if (w.planned) count = html`<span class="head-count" aria-label="${w.done} of ${w.planned} sets logged">${w.done} / ${w.planned} sets</span>`;
    } else {
      const plan = weekPlan(cycle, week);
      const weekWord = week === wkNow ? 'this week' : 'that week';
      body = pickerView(plan, dateISO, isToday, week, weekWord);
      if (plan.list.length) count = html`<span class="head-count">${plan.done.length} of ${plan.list.length} ${weekWord}</span>`;
    }
    const session = day && store.findSession(day.id, dateISO);
    const hasLog = !!session && store.setsOf(session.id).length > 0;
    const heading = isToday ? (day ? dayName(day) : 'Today') : fmtShortWeekday(date);
    let sub = day ? dayName(day) : '';
    if (isToday) sub = day ? `Today · ${fmtShortWeekday(date)}` : fmtShortWeekday(date);

    return html`
      <header class="screen-head today-head">
        <div class="title-row"><h1 tabindex="-1">${heading}</h1>${count}</div>
        <div class="sub-row">
          <p class="sub">${sub}</p>
          <span class="sub-tools">
            ${day ? html`<button type="button" class="btn-tool" data-action="change-workout">${hasLog ? 'Other workouts' : 'Change workout'}</button>` : ''}
            ${isToday ? '' : html`<button type="button" class="btn-tool" data-action="go-today">Back to today</button>`}
          </span>
        </div>
      </header>
      ${wkNow > cycle.weeks ? html`<section class="card empty" style="margin-bottom:16px"><h2>${cycle.name} ended ${fmtDay(cycleEnd(cycle))}</h2>
        <p>You can still fill in missed days. Start the next cycle in Program.</p></section>` : ''}
      ${weekNav(cycle, week)}
      ${dayStrip(cycle, week)}
      ${body}
    `;
  },

  actions: {
    week(el, e, { rerender }) {
      const cycle = store.activeCycle();
      const next = toISO(addDays(parseISO(sel.date), 7 * Number(el.dataset.dir)));
      sel = { ...sel, date: next > latestDate(cycle) ? latestDate(cycle) : next, dayId: null, picking: false };
      rerender();
      refocus(`[data-action="week"][data-dir="${el.dataset.dir}"]:not(:disabled)`);
    },
    'pick-date'(el, e, { rerender }) {
      sel = { ...sel, date: el.dataset.date, dayId: null, picking: false };
      rerender();
      refocus(`[data-action="pick-date"][data-date="${el.dataset.date}"]`);
    },
    'pick-workout'(el, e, { rerender }) {
      sel = { ...sel, dayId: el.dataset.day, picking: false };
      rerender();
      window.scrollTo({ top: 0 });
      refocus();
    },
    'open-logged'(el, e, { rerender }) {
      sel = { ...sel, date: el.dataset.date, dayId: el.dataset.day, picking: false };
      rerender();
      window.scrollTo({ top: 0 });
      refocus();
    },
    'change-workout'(el, e, { rerender }) {
      sel = { ...sel, dayId: null, picking: true };
      rerender();
      window.scrollTo({ top: 0 });
      refocus();
    },
    'go-today'(el, e, { rerender }) {
      sel = null;
      rerender();
      window.scrollTo({ top: 0 });
      refocus();
    },
    async 'start-today'(el, e, { rerender }) {
      const cycle = store.activeCycle();
      const before = cycle.startDate;
      await store.patch('cycles', cycle.id, { startDate: todayISO() });
      sel = null;
      rerender();
      toast(`${cycle.name} starts today`, {
        action: { label: 'Undo', run: async () => { await store.patch('cycles', cycle.id, { startDate: before }); sel = null; rerender(); } },
      });
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
    const { cycle, day, ex, dateISO, key } = cardContext(t.closest('.log-card'));
    const text = t.value.trim();
    const existing = store.findSession(day.id, dateISO);
    if (!existing && !text) return;
    const session = existing || await store.ensureSession(cycle, day.id, dateISO);
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
