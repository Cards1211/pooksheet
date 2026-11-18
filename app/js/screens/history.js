import * as store from '../store.js';
import * as training from '../training.js';
import * as stats from '../stats.js';
import { html } from '../util.js';
import { backLink } from '../ui.js';
import { parseISO, fmtShortWeekday } from '../dates.js';
import { lineChart, niceScale } from '../chart.js';
import { dayName } from './common.js';

export default {
  tab: 'progress',
  depth: 1,
  title: (p) => store.get('exercises', p.id)?.name || 'Exercise',

  render({ id }, query = {}) {
    const ex = store.get('exercises', id);
    const cycle = store.get('cycles', query.cycle) || store.activeCycle();
    const back = backLink('#/progress', 'Progress');
    if (!ex || !cycle) return html`<header class="screen-head pushed">${back}<h1>Exercise not found</h1></header>`;

    const reps = ex.loadType === 'bodyweight';
    const u = training.unitFor(ex);
    const tops = stats.weeklyTops(ex.id, cycle);
    const scale = niceScale(tops);
    const what = reps ? 'Most reps each week' : 'Top weight each week';
    const said = tops.map((v, i) => (v == null ? null : `week ${i + 1} ${training.fmtNum(v)}${reps ? ' reps' : ` ${u}`}`)).filter(Boolean).join(', ');
    const last = Math.max(1, cycle.weeks - 1);
    const chart = scale ? lineChart({
      points: tops.map((y, i) => ({ x: i / last, y })),
      scale,
      xLabels: tops.map((_, i) => ({ x: i / last, text: `W${i + 1}` })),
      label: `${what} in ${cycle.name}: ${said}`,
      unit: reps ? '' : u,
    }) : '';

    const sessions = stats.exerciseSessions(ex.id, cycle.id);
    return html`
      <header class="screen-head pushed">${back}
        <h1 tabindex="-1">${ex.name}</h1>
        <p class="sub">${what} · ${cycle.name}</p>
      </header>
      <section class="card pg-chart">
        ${chart || html`<p class="muted">Nothing logged for this exercise in ${cycle.name} yet.</p>`}
        ${chart ? html`<p class="pg-note">Week of the cycle along the bottom${reps ? ', reps up the side' : `, ${u} up the side`}.</p>` : ''}
      </section>
      ${sessions.length ? html`<div class="section-head"><h2>Every session</h2><span class="count">${sessions.length}</span></div>
      <section class="card pg-sessions"><ul>
        ${sessions.map(({ session, sets }) => {
          const note = store.noteOf(session.id, ex.id)?.text?.trim();
          const day = store.get('days', session.dayId);
          return html`<li>
            <span class="when"><strong>Week ${session.week}</strong> · ${fmtShortWeekday(parseISO(session.date))}${day ? html`<small>${dayName(day)}</small>` : ''}</span>
            <span class="sets">${training.summarize(sets, ex)}</span>
            ${note ? html`<span class="note">${note}</span>` : ''}
          </li>`;
        })}
      </ul></section>` : ''}
    `;
  },
};
