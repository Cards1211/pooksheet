// Domain layer: in-memory cache of every record, write-through to IndexedDB.
// Every record: { id, ownerId, createdAt, updatedAt, deleted, ...fields }.
// Deletes are soft (deleted: true) so a future sync can pass them along.

import * as db from './db.js';
import { uuid, nowISO, byName } from './util.js';
import { todayISO, toISO, nextMonday, weekNumber } from './dates.js';

export const APP_ID = 'workout-tracker';
export const FORMAT = 1;

const cache = Object.fromEntries(db.STORES.map((s) => [s, new Map()]));
let meta = {};
const listeners = new Set();

export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { for (const fn of listeners) fn(); };

export async function load() {
  const { stores, meta: m } = await db.readAll();
  for (const s of db.STORES) cache[s] = new Map((stores[s] || []).map((r) => [r.id, r]));
  meta = m;
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
  mine('days').filter((d) => d.cycleId === cycleId).sort((a, b) => a.weekday - b.weekday || a.order - b.order);

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

export function dayForWeekday(cycleId, wd) {
  return days(cycleId).find((d) => d.weekday === wd) || null;
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
      const nd = make('days', { cycleId: cycle.id, weekday: d.weekday, name: d.name, order: d.order });
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

export async function addDay(cycleId, wd) {
  const day = make('days', { cycleId, weekday: wd, name: '', order: 0 });
  await commit([['days', day]]);
  return day;
}

/**
 * Turn a weekday back on with the exercises it had when it was turned off. Its logged
 * workouts reconnect too, because they point at the same day. Returns how many exercises
 * came back, or 0 if this weekday has nothing to bring back (then add a new day instead).
 */
export async function restoreDay(cycleId, wd) {
  const me = userId();
  const removed = [...cache.days.values()]
    .filter((d) => d.deleted && d.ownerId === me && d.cycleId === cycleId && d.weekday === wd)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const day of removed) {
    const when = Date.parse(day.updatedAt);
    // Only the exercises removed along with the day: one taken out by hand earlier stays out.
    const withDay = [...cache.slots.values()].filter((s) => s.deleted && s.dayId === day.id
      && Math.abs(Date.parse(s.updatedAt) - when) < 2000);
    if (withDay.length) {
      await restore([['days', day], ...withDay.map((s) => ['slots', s])]);
      return withDay.length;
    }
  }
  return 0;
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

export function findSession(cycleId, dayId, week) {
  return mine('sessions').find((s) => s.cycleId === cycleId && s.dayId === dayId && s.week === week) || null;
}

/** The session for a day of a week, created on first use. `date` is that day's calendar date. */
export async function ensureSession(cycleId, dayId, week, date) {
  const found = findSession(cycleId, dayId, week);
  if (found) return found;
  const s = make('sessions', { cycleId, dayId, week, date, note: '', startedAt: nowISO(), finishedAt: null });
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
  await db.replaceAll(data, { currentUserId: obj.ownerId });
  await load();
  if (!profile()) {
    // a backup without its profile still restores; give it default settings
    const t = nowISO();
    await commit([['profiles', { id: obj.ownerId, ownerId: obj.ownerId, createdAt: t, updatedAt: t, deleted: false, name: '', unit: 'kg', theme: 'system' }]]);
  }
  emit();
}
