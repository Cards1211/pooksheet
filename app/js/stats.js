// Progress numbers: the weekly calendar, the streak, and each exercise's history.
import * as store from './store.js';
import * as training from './training.js';
import { todayISO, toISO, parseISO, addDays, mondayOf, cycleStartMonday, weekNumber } from './dates.js';

const LB_PER_KG = 2.20462;
const kg = (w, u) => (w == null ? null : u === 'lb' ? w / LB_PER_KG : w);

/** Sessions of a cycle that have at least one logged set. */
function loggedSessions(cycleId) {
  const counts = new Map();
  for (const st of store.allSets()) counts.set(st.sessionId, (counts.get(st.sessionId) || 0) + 1);
  return store.sessions(cycleId).filter((s) => counts.get(s.id));
}

/** Workouts a week asks for: the ones with exercises (an empty one can never be done). */
const plannedWorkouts = (cycleId) => store.days(cycleId).filter((d) => store.slots(d.id).length);

/**
 * One row per week of a cycle: the dates that have a logged workout, and how many
 * different workouts from the list were done that week.
 */
export function cycleWeeks(cycle) {
  const sessions = loggedSessions(cycle.id);
  const planned = plannedWorkouts(cycle.id);
  const start = cycleStartMonday(cycle);
  const today = todayISO();
  const rows = [];
  for (let w = 1; w <= cycle.weeks; w++) {
    const days = Array.from({ length: 7 }, (_, i) => toISO(addDays(start, (w - 1) * 7 + i)));
    const inWeek = sessions.filter((s) => s.week === w);
    const doneIds = new Set(inWeek.map((s) => s.dayId));
    rows.push({
      week: w,
      days: days.map((iso) => ({ iso, logged: inWeek.some((s) => s.date === iso), today: iso === today, future: iso > today })),
      done: planned.filter((d) => doneIds.has(d.id)).length,
      planned: planned.length,
      started: days[0] <= today,
    });
  }
  return rows;
}

/** The cycle that a calendar week belongs to: the latest one that had started by then. */
function cycleOwning(mondayISO, byStart) {
  for (const c of byStart) if (toISO(cycleStartMonday(c)) <= mondayISO) return c;
  return null;
}

/** A week counts when every workout in that cycle's list was done in it. */
function weekComplete(cycle, mondayISO) {
  const w = weekNumber(cycle, mondayISO);
  if (w < 1 || w > cycle.weeks) return false; // a gap between cycles
  const planned = plannedWorkouts(cycle.id);
  if (!planned.length) return false;
  const done = new Set(loggedSessions(cycle.id).filter((s) => s.week === w).map((s) => s.dayId));
  return planned.every((d) => done.has(d.id));
}

/**
 * Weeks in a row with every workout done, across cycles. The week you're in adds to the
 * streak once it's complete, and never breaks it while it's still going.
 */
export function streak() {
  const byStart = [...store.cycles()].sort((a, b) => b.startDate.localeCompare(a.startDate));
  if (!byStart.length) return 0;
  const first = toISO(cycleStartMonday(byStart[byStart.length - 1]));
  let monday = mondayOf(parseISO(todayISO()));
  let n = 0;
  const current = cycleOwning(toISO(monday), byStart);
  if (current && weekComplete(current, toISO(monday))) n++;
  monday = addDays(monday, -7);
  while (toISO(monday) >= first) {
    const c = cycleOwning(toISO(monday), byStart);
    if (!c || !weekComplete(c, toISO(monday))) break;
    n++;
    monday = addDays(monday, -7);
  }
  return n;
}

/** Each logged session of an exercise in a cycle, newest first, with its sets. */
export function exerciseSessions(exerciseId, cycleId) {
  const sessions = new Map(store.sessions(cycleId).map((s) => [s.id, s]));
  const by = new Map();
  for (const st of store.allSets()) {
    const s = st.exerciseId === exerciseId && sessions.get(st.sessionId);
    if (!s) continue;
    if (!by.has(s.id)) by.set(s.id, { session: s, sets: [] });
    by.get(s.id).sets.push(st);
  }
  const list = [...by.values()];
  for (const x of list) x.sets.sort((a, b) => a.index - b.index);
  return list.sort((a, b) => b.session.date.localeCompare(a.session.date)
    || (b.session.startedAt || '').localeCompare(a.session.startedAt || ''));
}

/** The best set: heaviest (then most reps), or most reps for bodyweight exercises. */
export function topSet(sets, ex) {
  let best = null;
  for (const s of sets) {
    if (ex.loadType === 'bodyweight') {
      if (s.reps != null && (!best || s.reps > best.reps)) best = s;
      continue;
    }
    const w = kg(s.weight, s.unit) ?? 0;
    const bw = best ? kg(best.weight, best.unit) ?? 0 : -1;
    if (!best || w > bw + 1e-6 || (Math.abs(w - bw) < 1e-6 && (s.reps ?? 0) > (best.reps ?? 0))) best = s;
  }
  return best;
}

/** The value charted for a set: weight in the exercise's unit, or reps for bodyweight. */
export function chartValue(set, ex) {
  if (!set) return null;
  if (ex.loadType === 'bodyweight') return set.reps;
  return training.convert(set.weight ?? 0, set.unit, training.unitFor(ex));
}

/** Top value per week of the cycle (null where nothing was logged). */
export function weeklyTops(exerciseId, cycle) {
  const ex = store.get('exercises', exerciseId);
  const tops = Array(cycle.weeks).fill(null);
  for (const { session, sets } of exerciseSessions(exerciseId, cycle.id)) {
    const v = chartValue(topSet(sets, ex), ex);
    const i = session.week - 1;
    if (v != null && i >= 0 && i < tops.length && (tops[i] == null || v > tops[i])) tops[i] = v;
  }
  return tops;
}

/**
 * Exercises logged in a cycle, grouped by workout in program order (removed workouts last).
 * Each exercise shows up once, under the first workout it belongs to.
 */
export function loggedExercises(cycle) {
  const sessions = loggedSessions(cycle.id);
  const setsOf = new Map();
  for (const st of store.allSets()) {
    if (!setsOf.has(st.sessionId)) setsOf.set(st.sessionId, new Set());
    setsOf.get(st.sessionId).add(st.exerciseId);
  }
  const live = store.days(cycle.id);
  const dayIds = [...live.map((d) => d.id)];
  for (const s of sessions) if (!dayIds.includes(s.dayId)) dayIds.push(s.dayId);
  const seen = new Set();
  const groups = [];
  for (const dayId of dayIds) {
    const logged = new Set();
    for (const s of sessions) if (s.dayId === dayId) for (const e of setsOf.get(s.id) || []) logged.add(e);
    if (!logged.size) continue;
    const order = store.slots(dayId).map((sl) => sl.exerciseId);
    const ids = [...order.filter((e) => logged.has(e)), ...[...logged].filter((e) => !order.includes(e))]
      .filter((e) => !seen.has(e) && store.get('exercises', e));
    ids.forEach((e) => seen.add(e));
    if (ids.length) groups.push({ day: store.get('days', dayId), exercises: ids.map((e) => store.get('exercises', e)) });
  }
  return groups;
}

/** Body weight entries inside a cycle's dates, oldest first. */
export function bodyweightsIn(cycle) {
  const from = toISO(cycleStartMonday(cycle));
  const to = toISO(addDays(cycleStartMonday(cycle), cycle.weeks * 7 - 1));
  return store.bodyweights().filter((b) => b.date >= from && b.date <= to);
}

