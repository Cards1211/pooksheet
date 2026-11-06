// Training logic: units, "last week" lookup, personal records, overload hints.
import * as store from './store.js';
import { parseISO, addDays, toISO, fmtDay } from './dates.js';

const LB_PER_KG = 2.20462;

export const unit = () => store.profile()?.unit || 'kg';

/** The unit an exercise is logged in: its own choice (e.g. plates in kg), else the app setting. */
export const unitFor = (ex) => ex?.unit || unit();

const roundTo = (x, step) => Math.round(x / step) * step;

/** Convert a weight between units; same unit returns it untouched. */
export function convert(w, from, to) {
  if (w == null || !from || from === to) return w;
  return to === 'lb' ? roundTo(w * LB_PER_KG, 0.5) : roundTo(w / LB_PER_KG, 0.25);
}
const kg = (w, u) => (w == null ? null : u === 'lb' ? w / LB_PER_KG : w);

/** "22.5", "10" */
export const fmtNum = (n) => (n == null || Number.isNaN(n) ? '' : String(Math.round(n * 100) / 100));

/** Parse a typed weight; accepts "22,5". Returns null for empty, NaN for junk. */
export function parseWeight(s) {
  const t = String(s ?? '').trim().replace(',', '.');
  if (!t) return null;
  return /^\d{0,4}(\.\d{0,2})?$/.test(t) && t !== '.' ? Number(t) : NaN;
}
export function parseReps(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  return /^\d{1,3}$/.test(t) ? Number(t) : NaN;
}

/** Weight jump used by overload hints, in the current unit. */
export function stepFor(ex) {
  const u = unitFor(ex);
  if (ex.weightStep) return convert(ex.weightStep, ex.weightStepUnit || 'kg', u);
  return u === 'lb' ? 5 : 2.5;
}

/** Every logged set of one exercise, each with its session. */
function history(exerciseId, excludeSessionId) {
  const sessions = new Map(store.allSessions().map((s) => [s.id, s]));
  const out = [];
  for (const st of store.allSets()) {
    if (st.exerciseId !== exerciseId || st.sessionId === excludeSessionId) continue;
    const session = sessions.get(st.sessionId);
    if (session) out.push({ set: st, session });
  }
  return out;
}

/**
 * The previous performance of an exercise before `date`:
 * exactly one week earlier if logged ("Last week"); otherwise the most recent time on the
 * same weekday (so Thursday compares with Thursday); otherwise the most recent time at all.
 */
export function lastPerformance(exerciseId, date, excludeSessionId) {
  const bySession = new Map();
  for (const { set, session } of history(exerciseId, excludeSessionId)) {
    if (session.date >= date) continue;
    if (!bySession.has(session.id)) bySession.set(session.id, { session, sets: [] });
    bySession.get(session.id).sets.push(set);
  }
  if (!bySession.size) return null;
  const weekAgo = toISO(addDays(parseISO(date), -7));
  const list = [...bySession.values()].sort((a, b) => b.session.date.localeCompare(a.session.date));
  const wd = parseISO(date).getDay();
  const pick = list.find((x) => x.session.date === weekAgo)
    || list.find((x) => parseISO(x.session.date).getDay() === wd)
    || list[0];
  pick.sets.sort((a, b) => a.index - b.index);
  const note = store.noteOf(pick.session.id, exerciseId)?.text || '';
  return {
    session: pick.session,
    sets: pick.sets,
    note,
    label: pick.session.date === weekAgo ? 'Last week' : `Last time · ${fmtDay(parseISO(pick.session.date))}`,
  };
}

/** "10 kg × 8, 8, 8" or "5 kg × 6, 6 · 2.5 kg × 10" (bodyweight: "BW × 12, 10") */
export function summarize(sets, ex) {
  const u = unitFor(ex);
  const groups = [];
  for (const s of sets) {
    const w = ex.loadType === 'bodyweight' ? null : convert(s.weight, s.unit, u);
    let label = 'BW';
    if (w != null) label = ex.loadType === 'bodyweight_plus' ? (w ? `BW + ${fmtNum(w)} ${u}` : 'BW') : `${fmtNum(w)} ${u}`;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.reps.push(s.reps ?? '–');
    else groups.push({ label, reps: [s.reps ?? '–'] });
  }
  return groups.map((g) => `${g.label} × ${g.reps.join(', ')}`).join(' · ');
}

/**
 * Personal records within a session for one exercise.
 * A set is a PR when it is heavier than anything before it, or has more reps than ever
 * at that weight or heavier. Only counts when there is earlier history.
 * Returns Map(setId -> 'weight' | 'reps').
 */
export function sessionPRs(sessionId, exerciseId) {
  const session = store.get('sessions', sessionId);
  const out = new Map();
  if (!session) return out;
  const prior = history(exerciseId, sessionId)
    .filter(({ session: s }) => s.date < session.date)
    .map(({ set }) => ({ w: kg(set.weight, set.unit), reps: set.reps }));
  if (!prior.length) return out;
  const pool = [...prior];
  let maxW = Math.max(-1, ...pool.filter((p) => p.w != null).map((p) => p.w));
  for (const s of store.setsOf(sessionId, exerciseId)) {
    const w = kg(s.weight, s.unit);
    if (w != null && maxW >= 0 && w > maxW + 1e-6) {
      out.set(s.id, 'weight');
    } else if (s.reps != null) {
      const comparable = pool.filter((p) => p.reps != null && (w == null ? p.w == null : p.w != null && p.w >= w - 1e-6));
      if (comparable.length && s.reps > Math.max(...comparable.map((p) => p.reps))) out.set(s.id, 'reps');
    }
    pool.push({ w, reps: s.reps });
    if (w != null) maxW = Math.max(maxW, w);
  }
  return out;
}

/** Suggest a heavier weight when every set last time reached the top of the rep range. */
export function overloadHint(ex, target, last) {
  if (!last || !target || ex.loadType === 'bodyweight') return null;
  const sets = last.sets.filter((s) => s.reps != null);
  if (sets.length < target.setsMin) return null;
  if (!sets.every((s) => s.reps >= target.repsMax)) return null;
  const u = unitFor(ex);
  const top = Math.max(0, ...sets.map((s) => convert(s.weight ?? 0, s.unit, u)));
  return { to: roundTo(top + stepFor(ex), u === 'lb' ? 0.5 : 0.25), reps: target.repsMax, count: sets.length };
}
