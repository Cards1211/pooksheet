import { appVersion } from '../offline.js';
import * as store from '../store.js';
import { html, icon } from '../util.js';
import { applyTheme, segmented } from '../ui.js';

const THEMES = [
  { id: 'system', name: 'Auto', note: 'Light or Dark, following your phone', swatches: ['#FFB7C5', '#D7E8B2', '#0A3323', '#105666'] },
  { id: 'light', name: 'Light', note: 'Cherry blossom, pistachio and honey', swatches: ['#FFB7C5', '#D7E8B2', '#FFE3EC', '#A9B8FF', '#F6C96B'] },
  { id: 'dark', name: 'Dark', note: 'Dark green, midnight and moss', swatches: ['#0A3323', '#105666', '#839958', '#D3968C', '#F7F4D5'] },
  { id: 'barnacles', name: 'Blue Barnacles', note: 'Bluebell, mint and chive blossom', swatches: ['#9693D6', '#B5D4C8', '#775B89', '#AEC891', '#7872A5'] },
];

function themePicker(current) {
  return html`<div class="theme-list" role="radiogroup" aria-label="Appearance">
    ${THEMES.map((t) => html`<label class="theme-opt">
      <input type="radio" name="theme" value="${t.id}" ${t.id === current ? 'checked' : ''}>
      <span class="swatches" aria-hidden="true">${t.swatches.map((c) => html`<i style="background:${c}"></i>`)}</span>
      <span class="theme-name">${t.name}<small>${t.note}</small></span>
      <span class="radio-dot" aria-hidden="true"></span>
    </label>`)}
  </div>`;
}
import { restoreControls, onRestoreFile, confirmRestore, clearPending, saveBackup, pickFile } from './backup.js';

export default {
  tab: 'settings',
  depth: 0,
  title: () => 'Settings',

  render() {
    const p = store.profile();
    return html`
      <header class="screen-head"><h1>Settings</h1></header>

      <section class="card">
        <label class="field"><span class="field-label">Your name</span>
          <input class="input" data-field="name" value="${p.name}" placeholder="Your first name" maxlength="30" autocapitalize="words" autocomplete="given-name" enterkeyhint="done">
          <span class="field-help">Only used if you share progress later.</span>
        </label>
      </section>

      <div class="section-head"><h2>Units</h2></div>
      <section class="card">
        ${segmented('unit', [{ value: 'kg', label: 'Kilograms' }, { value: 'lb', label: 'Pounds' }], p.unit, { label: 'Weight unit' })}
        <p class="field-help" style="margin-top:10px">This is the default. While logging, any exercise can switch to kg or lb on its own, for example plates in kg.</p>
      </section>

      <div class="section-head"><h2>Rest timer</h2></div>
      <section class="card">
        <label class="switch-row">
          <span><span class="label-text">Beep when the phone is locked</span>
            <small>Plays a silent sound during rest so the beep can reach the lock screen. Music apps pause while it plays.</small></span>
          <input type="checkbox" class="switch" switch data-field="lockBeep" ${p.lockBeep !== false ? 'checked' : ''}>
        </label>
        <p class="field-help" style="margin:10px 0 0">The timer starts after each logged set, using that exercise's rest time. Change rest times in Program, or from the big countdown.</p>
      </section>

      <div class="section-head"><h2>Appearance</h2></div>
      <section class="card theme-card">
        ${themePicker(p.theme)}
      </section>

      <div class="section-head"><h2>Backup</h2></div>
      <section class="card stack">
        <p class="muted">Your data lives only on this phone. Save a backup file now and then and keep it in Files or iCloud Drive.</p>
        <button type="button" class="btn btn-quiet btn-block" data-action="export">${icon('download')}Save a backup file</button>
        ${restoreControls(true)}
      </section>

      <p class="about">PookSheet · version ${appVersion}</p>
    `;
  },

  leave() { clearPending(); },

  actions: {
    export: () => saveBackup(),
    'restore-pick': () => pickFile(),
    'restore-cancel': (el, e, { rerender }) => { clearPending(); rerender(); },
    'restore-confirm': (el, e, { go }) => confirmRestore(go),
  },

  async change(e, { rerender }) {
    const t = e.target;
    if (t.id === 'restore-file') return onRestoreFile(t, rerender);
    const p = store.profile();
    if (t.name === 'unit') return store.patch('profiles', p.id, { unit: t.value });
    if (t.name === 'theme') {
      await store.patch('profiles', p.id, { theme: t.value });
      applyTheme(t.value);
      return;
    }
    if (t.dataset.field === 'lockBeep') return store.patch('profiles', p.id, { lockBeep: t.checked });
    if (t.dataset.field === 'name') {
      const name = t.value.trim();
      t.value = name;
      await store.patch('profiles', p.id, { name });
    }
  },

  keydown(e) {
    if (e.key === 'Enter' && e.target.matches?.('input[data-field]')) { e.preventDefault(); e.target.blur(); }
  },
};
