import * as store from '../store.js';
import { html, plural } from '../util.js';
import { backLink } from '../ui.js';
import { dayCard, cycleDates } from './common.js';

export default {
  tab: 'program',
  depth: 1,
  title: (p) => store.get('cycles', p.id)?.name || 'Cycle',

  render({ id }) {
    const cycle = store.get('cycles', id);
    if (!cycle || cycle.deleted) {
      return html`<header class="screen-head pushed">${backLink('#/program', 'Program')}<h1>Cycle not found</h1></header>`;
    }
    const days = store.days(cycle.id);
    return html`
      <header class="screen-head pushed">${backLink('#/program', 'Program')}
        <h1>${cycle.name}</h1>
        <p class="sub">${cycle.title ? `${cycle.title} · ` : ''}${cycleDates(cycle)} · ${plural(store.workoutCount(cycle.id), 'workout')}</p>
      </header>
      <div class="section-head"><h2>Workouts</h2><span class="count">${days.length || ''}</span></div>
      <div class="stack">${days.length ? days.map(dayCard) : html`<section class="card empty"><p>This cycle had no workouts.</p></section>`}</div>
      <p class="hint" style="margin-top:16px">Past cycles are read only. Logged workouts show up under Progress.</p>
    `;
  },
};
