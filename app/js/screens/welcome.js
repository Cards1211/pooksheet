import * as store from '../store.js';
import { html, icon } from '../util.js';
import { toast } from '../ui.js';
import { restoreControls, onRestoreFile, confirmRestore, clearPending, pickFile } from './backup.js';

export default {
  tab: null,
  depth: 0,
  title: () => 'Welcome',

  render() {
    return html`
      <section class="welcome">
        <img class="welcome-icon" src="icons/icon-192.png" width="84" height="84" alt="">
        <h1>PookSheet</h1>
        <p class="lede">Your training, on your phone. Plan your days, log every set and keep each 8-week cycle. It works without internet, and your data stays on this phone.</p>
        <div class="choices stack">
          <button type="button" class="card choice pressable" data-action="fresh">
            <span class="grow"><span class="title">Start a new program</span><span class="meta">Pick your training days, then add exercises.</span></span>${icon('next')}
          </button>
          <section class="card">
            <span class="title" style="display:block;font-weight:800;font-size:var(--fs-lg)">Already have a backup?</span>
            <p class="muted" style="margin:4px 0 14px">Restore a file saved from this app, like your imported training sheet.</p>
            ${restoreControls(false)}
          </section>
        </div>
      </section>
    `;
  },

  leave() { clearPending(); },

  actions: {
    async fresh(el, e, { go }) {
      await store.createUser();
      go('#/program');
      toast('Tap the weekdays you train');
    },
    'restore-pick': () => pickFile(),
    'restore-cancel': (el, e, { rerender }) => { clearPending(); rerender(); },
    'restore-confirm': (el, e, { go }) => confirmRestore(go),
  },

  change(e, { rerender }) {
    if (e.target.id === 'restore-file') return onRestoreFile(e.target, rerender);
  },
};
