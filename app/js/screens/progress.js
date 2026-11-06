import * as store from '../store.js';
import { html, plural } from '../util.js';

export default {
  tab: 'progress',
  depth: 0,
  title: () => 'Progress',

  render() {
    const total = store.cycles().reduce((n, c) => n + store.workoutCount(c.id), 0);
    return html`
      <header class="screen-head"><h1>Progress</h1><p class="sub">${plural(total, 'workout')} saved so far</p></header>
      <section class="card empty">
        <h2>Calendar and history come in stage (d)</h2>
        <p>Your training calendar, streak and each exercise’s history will live here, built from every workout you’ve saved, the imported ones included.</p>
      </section>
    `;
  },
};
