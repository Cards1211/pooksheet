// Domain layer: in-memory cache of every record, write-through to IndexedDB.
// Every record: { id, ownerId, createdAt, updatedAt, deleted, ...fields }.
// Deletes are soft (deleted: true) so a future sync can pass them along.

import * as db from './db.js';
import { uuid, nowISO, byName } from './util.js';
import { todayISO, toISO, nextMonday, weekNumber, weekday } from './dates.js';

export const APP_ID = 'workout-tracker';
export const FORMAT = 2; // 2: workouts are a list you pick from, not tied to weekdays

const cache = Object.fromEntries(db.STORES.map((s) => [s, new Map()]));
let meta = {};
const listeners = new Set();

export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { for (const fn of listeners) fn(); };

export async function load() {
  const { stores, meta: m } = await db.readAll();
  for (const s of db.STORES) cache[s] = new Map((stores[s] || []).map((r) => [r.id, r]));
  meta = m;
  await upgrade();
}

/** Exercises removed along with a workout. One taken out by hand earlier stays out. */
function slotsRemovedWith(day) {
  const when = Date.parse(day.updatedAt);
  return [...cache.slots.values()].filter((s) => s.deleted && s.dayId === day.id
    && Math.abs(Date.parse(s.updatedAt) - when) < 2000);
}

/**
 * Bring older saved data and old backups forward, when workouts were tied to weekdays.
 * Logged sets and their dates are never touched. Safe to run again if it gets interrupted.
 */
async function upgrade() {
  if ((meta.schema || 1) >= FORMAT) return;
  const changed = [];
  const put = (store, rec) => { cache[store].set(rec.id, rec); changed.push([store, rec]); };
  for (const cycleId of new Set([...cache.days.values()].map((d) => d.cycleId))) {
    const inCycle = () => [...cache.days.values()].filter((d) => d.cycleId === cycleId);

    // A blank day left behind by turning a weekday off and on gets its old exercises back.
    const hasSlots = (id) => [...cache.slots.values()].some((s) => !s.deleted && s.dayId === id);
    const hasLog = (id) => [...cache.sessions.values()].some((s) => !s.deleted && s.dayId === id);
    for (const blank of inCycle().filter((d) => !d.deleted && !hasSlots(d.id) && !hasLog(d.id))) {
      const old = inCycle().filter((d) => d.deleted && d.weekday === blank.weekday && slotsRemovedWith(d).length)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (!old) continue;
      const back = slotsRemovedWith(old);
      put('days', touched(blank, { deleted: true }));
      put('days', touched(old, { deleted: false, name: blank.name?.trim() ? blank.name : old.name }));
      for (const s of back) put('slots', touched(s, { deleted: false }));
    }

    // Every workout gets a name that's unique in its cycle (Upper, Upper becomes Upper A, Upper B)
    // and a place in the list, in the order the weekdays ran.
    const base = (d) => d.name?.trim() || (d.weekday ? weekday(d.weekday).long : 'Workout');
    const live = inCycle().filter((d) => !d.deleted)
      .sort((a, b) => (a.weekday ?? 99) - (b.weekday ?? 99) || a.order - b.order);
    const total = new Map();
    for (const d of live) total.set(base(d).toLowerCase(), (total.get(base(d).toLowerCase()) || 0) + 1);
    const seen = new Map();
    live.forEach((d, order) => {
      const key = base(d).toLowerCase();
      const n = seen.get(key) || 0;
      seen.set(key, n + 1);
      const name = total.get(key) > 1 ? `${base(d)} ${String.fromCharCode(65 + n)}` : base(d);
      if (name !== d.name || order !== d.order) put('days', touched(d, { name, order }));
    });
    // Removed ones keep their timestamp, which is how their exercises are found again.
    for (const d of inCycle().filter((x) => x.deleted && !x.name?.trim())) put('days', { ...d, name: base(d) });
  }
  await db.putMany(changed);
  meta.schema = FORMAT;
  await db.setMeta('schema', FORMAT);
}

export const userId = () => meta.currentUserId || null;
export const profile = () => cache.profiles.get(userId()) || null;

/** Live (not deleted) records owned by the current user. */
function mine(store) {
  const me = userId();
  const out = [];
  for (const r of cache[store].values()) if (!r.deleted && r.ownerId === me) out.push(r);
  return out;
}
export const get = (store, id) => cache[store].get(id) || null;

function make(store, fields) {
  const t = nowISO();
  return { id: uuid(), ownerId: userId(), createdAt: t, updatedAt: t, deleted: false, ...fields };
}
const touched = (rec, changes) => ({ ...rec, ...changes, updatedAt: nowISO() });

async function commit(items) {
  for (const [s, r] of items) cache[s].set(r.id, r);
  try {
    await db.putMany(items);
  } catch (err) {
    await load(); // put the cache back to what is really saved
    emit();
    throw err;
  }
  emit();
}

export async function patch(store, id, changes) {
  const rec = touched(get(store, id), changes);
  await commit([[store, rec]]);
  return rec;
}

/** Set deleted on several records at once; returns them for undo. */
async function setDeleted(items, deleted) {
  const out = items.map(([s, r]) => [s, touched(r, { deleted })]);
  await commit(out);
  return out;
}
export const restore = (items) => setDeleted(items, false);

// ---------- queries ----------

export const cycles = () => mine('cycles').sort((a, b) => b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt));
export const activeCycle = () => cycles().find((c) => c.status === 'active') || null;
export const pastCycles = () => cycles().filter((c) => c.status !== 'active');

export const days = (cycleId) =>
  mine('days').filter((d) => d.cycleId === cycleId).sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

export const slots = (dayId) =>
  mine('slots').filter((s) => s.dayId === dayId).sort((a, b) => a.order - b.order);

export const exercises = () => mine('exercises').sort(byName);

export const sessions = (cycleId) =>
  mine('sessions').filter((s) => s.cycleId === cycleId).sort((a, b) => a.date.localeCompare(b.date));

const setsBySession = () => {
  const m = new Map();
  for (const s of mine('sets')) m.set(s.sessionId, (m.get(s.sessionId) || 0) + 1);
  return m;
};
/** Workouts with at least one logged set. */
export function workoutCount(cycleId) {
  const counts = setsBySession();
  return sessions(cycleId).filter((s) => counts.get(s.id)).length;
}

export function slotCount(cycleId) {
  return days(cycleId).reduce((n, d) => n + slots(d.id).length, 0);
}

const TARGET_KEYS = ['setsMin', 'setsMax', 'repsMin', 'repsMax'];
const sameTargets = (a, b) => TARGET_KEYS.every((k) => a[k] === b[k]);
export const usualTargets = (slot) => Object.fromEntries(TARGET_KEYS.map((k) => [k, slot[k]]));

/** The sets/reps target for a given week: a week override if there is one, else the usual target. */
export function targetsFor(slot, week) {
  return slot.weekTargets?.[week] || usualTargets(slot);
}
export const weekOverrideCount = (slot) => Object.keys(slot.weekTargets || {}).length;

/** Change the usual target; week overrides that now match it are dropped. */
export function setUsualTargets(slotId, t) {
  const slot = get('slots', slotId);
  const weekTargets = Object.fromEntries(Object.entries(slot.weekTargets || {}).filter(([, wt]) => !sameTargets(wt, t)));
  return patch('slots', slotId, { ...t, weekTargets });
}

/** Set one week's target; matching the usual target removes the override. */
export function setWeekTarget(slotId, week, t) {
  const slot = get('slots', slotId);
  const weekTargets = { ...(slot.weekTargets || {}) };
  if (!t || sameTargets(t, usualTargets(slot))) delete weekTargets[week];
  else weekTargets[week] = Object.fromEntries(TARGET_KEYS.map((k) => [k, t[k]]));
  return patch('slots', slotId, { weekTargets });
}

export function currentWeek(cycle) {
  return weekNumber(cycle, todayISO());
}

// ---------- setup ----------

export async function createUser() {
  const id = uuid();
  const t = nowISO();
  const prof = { id, ownerId: id, createdAt: t, updatedAt: t, deleted: false, name: '', unit: 'kg', theme: 'system' };
  meta.currentUserId = id;
  await db.setMeta('currentUserId', id);
  const cycle = { ...make('cycles', {}), name: 'Cycle 1', title: '', startDate: toISO(nextMonday()), weeks: 8, status: 'active', copiedFrom: null };
  await commit([['profiles', prof], ['cycles', cycle]]);
  return prof;
}

// ---------- cycles ----------

export async function startNewCycle({ startDate, copy }) {
  const prev = activeCycle();
  const n = cycles().length + 1;
  const cycle = make('cycles', {
    name: `Cycle ${n}`,
    title: prev?.title || '',
    startDate,
    weeks: 8,
    status: 'active',
    copiedFrom: copy && prev ? prev.id : null,
  });
  const items = [['cycles', cycle]];
  if (prev) items.push(['cycles', touched(prev, { status: 'done' })]);
  if (copy && prev) {
    for (const d of days(prev.id)) {
      const nd = make('days', { cycleId: cycle.id, name: d.name, order: d.order });
      items.push(['days', nd]);
      for (const s of slots(d.id)) {
        items.push(['slots', make('slots', {
          cycleId: cycle.id, dayId: nd.id, exerciseId: s.exerciseId, order: s.order,
          setsMin: s.setsMin, setsMax: s.setsMax, repsMin: s.repsMin, repsMax: s.repsMax,
          weekTargets: structuredClone(s.weekTargets || {}),
        })]);
      }
    }
  }
  await commit(items);
  return cycle;
}

// ---------- days ----------

// A "day" in the data is a workout: it isn't tied to a weekday, and you pick one whenever you train.

export async function addDay(cycleId) {
  const list = days(cycleId);
  const used = new Set(list.map((d) => d.name.toLowerCase()));
  let n = list.length + 1;
  while (used.has(`workout ${n}`)) n += 1;
  const day = make('days', { cycleId, name: `Workout ${n}`, order: list.length ? list[list.length - 1].order + 1 : 0 });
  await commit([['days', day]]);
  return day;
}

/** Move a workout up or down the list, which sets what's suggested next. */
export async function moveDay(dayId, dir) {
  const list = days(get('days', dayId).cycleId);
  const i = list.findIndex((d) => d.id === dayId);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await commit(list.map((d, order) => ['days', touched(d, { order })]));
}

/** Removed workouts that still have exercises to bring back, newest first. */
export function removedDays(cycleId) {
  const me = userId();
  return [...cache.days.values()]
    .filter((d) => d.deleted && d.ownerId === me && d.cycleId === cycleId)
    .map((day) => ({ day, count: slotsRemovedWith(day).length }))
    .filter((x) => x.count)
    .sort((a, b) => b.day.updatedAt.localeCompare(a.day.updatedAt));
}

/** Bring a removed workout back with its exercises. Its logged workouts reconnect too. */
export async function restoreDay(dayId) {
  const day = get('days', dayId);
  const back = slotsRemovedWith(day);
  const list = days(day.cycleId);
  await commit([
    ['days', touched(day, { deleted: false, order: list.length ? list[list.length - 1].order + 1 : 0 })],
    ...back.map((s) => ['slots', touched(s, { deleted: false })]),
  ]);
  return back.length;
}

/** Soft-delete a day and its exercises. Returns the records for undo. */
export function removeDay(dayId) {
  const day = get('days', dayId);
  return setDeleted([['days', day], ...slots(dayId).map((s) => ['slots', s])], true);
}

// ---------- exercises & slots ----------

export function findExercise(name) {
  const key = name.trim().toLowerCase();
  return exercises().find((e) => e.name.toLowerCase() === key) || null;
}

export async function ensureExercise({ name, group = '' }) {
  const found = findExercise(name);
  if (found) return found;
  const ex = make('exercises', {
    name: name.trim(), muscleGroup: group, loadType: 'weighted', lp: false, restSec: 90, cue: '', link: '',
  });
  await commit([['exercises', ex]]);
  return ex;
}

/** Targets to suggest for a new slot: the last ones used for this exercise, else 3 × 8–12. */
function suggestedTargets(exerciseId) {
  const used = mine('slots').filter((s) => s.exerciseId === exerciseId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return used
    ? { setsMin: used.setsMin, setsMax: used.setsMax, repsMin: used.repsMin, repsMax: used.repsMax, weekTargets: structuredClone(used.weekTargets || {}) }
    : { setsMin: 3, setsMax: 3, repsMin: 8, repsMax: 12, weekTargets: {} };
}

export async function addSlot(dayId, exerciseId) {
  const day = get('days', dayId);
  const list = slots(dayId);
  const slot = make('slots', {
    cycleId: day.cycleId, dayId, exerciseId, order: list.length ? list[list.length - 1].order + 1 : 0,
    ...suggestedTargets(exerciseId),
  });
  await commit([['slots', slot]]);
  return slot;
}

export const removeSlot = (slotId) => setDeleted([['slots', get('slots', slotId)]], true);

/** Persist a new order for a day's exercises. */
export async function reorderSlots(orderedIds) {
  const items = orderedIds.map((id, i) => ['slots', touched(get('slots', id), { order: i })]);
  await commit(items);
}

// ---------- logging ----------

export const allSessions = () => mine('sessions');
export const allSets = () => mine('sets');

export function findSession(dayId, date) {
  return mine('sessions').find((s) => s.dayId === dayId && s.date === date) || null;
}

/** Workouts with something logged on a date (sets or a note), most recently started first. */
export function sessionsOn(cycleId, date) {
  const counts = setsBySession();
  const noted = new Set(mine('notes').map((n) => n.sessionId));
  return mine('sessions').filter((s) => s.cycleId === cycleId && s.date === date && (counts.get(s.id) || noted.has(s.id)))
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}

/** A workout on a real date, created when its first set or note is saved. */
export async function ensureSession(cycle, dayId, date) {
  const found = findSession(dayId, date);
  if (found) return found;
  const week = Math.min(Math.max(weekNumber(cycle, date), 1), cycle.weeks);
  const s = make('sessions', { cycleId: cycle.id, dayId, week, date, note: '', startedAt: nowISO(), finishedAt: null });
  await commit([['sessions', s]]);
  return s;
}

export const setsOf = (sessionId, exerciseId) =>
  mine('sets').filter((s) => s.sessionId === sessionId && (!exerciseId || s.exerciseId === exerciseId))
    .sort((a, b) => a.index - b.index);

/** Log (or overwrite) set number `index` of an exercise in a session. */
export async function saveSet({ sessionId, exerciseId, slotId, index, weight, unit, reps }) {
  const existing = mine('sets').find((s) => s.sessionId === sessionId && s.exerciseId === exerciseId && s.index === index);
  const rec = existing
    ? touched(existing, { weight, unit, reps, done: true, slotId: slotId ?? existing.slotId })
    : make('sets', { sessionId, exerciseId, slotId: slotId ?? null, index, weight, unit, reps, done: true });
  await commit([['sets', rec]]);
  return rec;
}

export const removeSet = (id) => setDeleted([['sets', get('sets', id)]], true);

/** Undo a removed set, unless that set number has been logged again since. */
export async function restoreSet(items) {
  const [, rec] = items[0];
  const clash = mine('sets').find((s) => s.sessionId === rec.sessionId && s.exerciseId === rec.exerciseId && s.index === rec.index);
  if (clash) return false;
  await restore(items);
  return true;
}

export const noteOf = (sessionId, exerciseId) =>
  mine('notes').find((n) => n.sessionId === sessionId && n.exerciseId === exerciseId) || null;

export async function saveNote(sessionId, exerciseId, text) {
  const n = noteOf(sessionId, exerciseId);
  if (n) {
    if (n.text === text) return;
    if (!text) { await setDeleted([['notes', n]], true); return; }
    await patch('notes', n.id, { text });
    return;
  }
  if (text) await commit([['notes', make('notes', { sessionId, exerciseId, text })]]);
}

// ---------- backup ----------

export function exportBackup() {
  const me = userId();
  const data = {};
  for (const s of db.STORES) data[s] = [...cache[s].values()].filter((r) => r.ownerId === me);
  return { app: APP_ID, format: FORMAT, exportedAt: nowISO(), ownerId: me, data };
}

/** Check a parsed backup file. Returns a summary or throws a readable error. */
export function inspectBackup(obj) {
  if (!obj || obj.app !== APP_ID || typeof obj.data !== 'object') {
    throw new Error("This file isn't a backup from this app.");
  }
  if (obj.format > FORMAT) throw new Error('This backup comes from a newer version of the app. Update the app first.');
  if (!obj.ownerId) throw new Error('This backup is missing its owner, so it can’t be restored.');
  for (const s of db.STORES) {
    const rows = obj.data[s] || [];
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.id !== 'string')) {
      throw new Error(`The “${s}” part of this backup is damaged.`);
    }
  }
  const live = (s) => (obj.data[s] || []).filter((r) => !r.deleted && r.ownerId === obj.ownerId);
  const setCounts = new Map();
  for (const st of live('sets')) setCounts.set(st.sessionId, (setCounts.get(st.sessionId) || 0) + 1);
  return {
    cycles: live('cycles').length,
    exercises: live('exercises').length,
    workouts: live('sessions').filter((s) => setCounts.get(s.id)).length,
    exportedAt: obj.exportedAt,
  };
}

export async function importBackup(obj) {
  inspectBackup(obj);
  const data = {};
  for (const s of db.STORES) data[s] = obj.data[s] || [];
  await db.replaceAll(data, { currentUserId: obj.ownerId, schema: obj.format || 1 });
  await load();
  if (!profile()) {
    // a backup without its profile still restores; give it default settings
    const t = nowISO();
    await commit([['profiles', { id: obj.ownerId, ownerId: obj.ownerId, createdAt: t, updatedAt: t, deleted: false, name: '', unit: 'kg', theme: 'system' }]]);
  }
  emit();
}
