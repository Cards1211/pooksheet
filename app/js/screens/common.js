import * as store from '../store.js';
import { html, icon, range, plural } from '../util.js';
import { fmtDay, cycleEnd, parseISO } from '../dates.js';
import { unitFor } from '../training.js';

export const LOAD_LABEL = { weighted: 'Weight', bodyweight: 'Bodyweight', bodyweight_plus: 'Bodyweight + weight' };

export const dayName = (d) => d.name?.trim() || 'Workout';

export const cycleDates = (cycle) => `${fmtDay(parseISO(cycle.startDate))} – ${fmtDay(cycleEnd(cycle))}`;

/** "3–4 sets · 5–10 reps · 90 s rest" plus the LP badge */
export function slotMeta(slot, ex) {
  const bits = [`${range(slot.setsMin, slot.setsMax)} sets`, `${range(slot.repsMin, slot.repsMax)} reps`];
  if (store.weekOverrideCount(slot)) bits.push('varies by week');
  if (ex.loadType === 'bodyweight') bits.push('Bodyweight');
  if (ex.loadType === 'bodyweight_plus') bits.push(`BW + ${unitFor(ex)}`);
  else if (ex.loadType === 'weighted' && ex.unit) bits.push(`in ${ex.unit}`);
  bits.push(`${ex.restSec} s rest`);
  return html`${bits.join(' · ')}${ex.lp ? html` <span class="badge" title="Lengthened partials">LP</span>` : ''}`;
}

/** Card linking to a workout's editor. */
export function dayCard(d) {
  const list = store.slots(d.id);
  const names = list.map((s) => store.get('exercises', s.exerciseId)?.name).filter(Boolean);
  const shown = names.slice(0, 3).join(' · ') + (names.length > 3 ? ` · +${names.length - 3} more` : '');
  return html`<a class="card day-card pressable" href="#/program/day/${d.id}">
    <span class="head"><span class="name">${dayName(d)}</span></span>
    ${names.length
      ? html`<span class="list">${plural(names.length, 'exercise')}: ${shown}</span>`
      : html`<span class="empty-line">No exercises yet</span>`}
    <span class="go">${icon('next')}</span>
  </a>`;
}
