// Shared restore/backup flow used by Settings and the first-run screen.
import * as store from '../store.js';
import { html, plural } from '../util.js';
import { todayISO, fmtDay } from '../dates.js';
import { toast, applyTheme } from '../ui.js';

let pending = null; // { obj, summary, fileName }

export const hasPending = () => !!pending;
export const pickFile = () => document.getElementById('restore-file')?.click();
export const clearPending = () => { pending = null; };

export function restoreControls(hasData) {
  return html`
    <button type="button" class="btn btn-quiet btn-block" data-action="restore-pick">Restore from a backup file</button>
    <input type="file" id="restore-file" class="sr-only" accept=".json,application/json" tabindex="-1">
    <div class="reveal ${pending ? 'is-open' : ''}" id="restore-panel">
      <div class="reveal-inner" ${pending ? '' : 'inert'}>
        ${pending ? html`<div class="panel">
          <h3>${hasData ? 'Replace your data with this backup?' : 'Restore this backup?'}</h3>
          <p class="muted">${pending.fileName}: ${plural(pending.summary.cycles, 'cycle')}, ${plural(pending.summary.exercises, 'exercise')} and ${plural(pending.summary.workouts, 'logged workout')}${pending.summary.exportedAt ? `, saved ${fmtDay(new Date(pending.summary.exportedAt))}` : ''}.</p>
          ${hasData ? html`<p class="note">Everything on this phone is replaced by the file. Save a backup first if you might want today’s data back.</p>` : ''}
          <div class="btn-row">
            <button type="button" class="btn btn-quiet" data-action="restore-cancel">Cancel</button>
            <button type="button" class="btn btn-primary" data-action="restore-confirm">${hasData ? 'Replace' : 'Restore'}</button>
          </div>
        </div>` : ''}
      </div>
    </div>`;
}

/** Handle the file input's change event. */
export async function onRestoreFile(input, rerender) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch {
    toast('That file isn’t a backup this app can read.');
    return;
  }
  const summary = store.inspectBackup(obj); // throws a readable message
  pending = { obj, summary, fileName: file.name };
  rerender();
  requestAnimationFrame(() => document.getElementById('restore-panel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

export async function confirmRestore(go) {
  if (!pending) return;
  const { obj, summary } = pending;
  await store.importBackup(obj);
  pending = null;
  applyTheme(store.profile()?.theme || 'system');
  go('#/program');
  toast(`Restored ${plural(summary.workouts, 'workout')}`);
}

export async function saveBackup() {
  const data = JSON.stringify(store.exportBackup());
  const name = `pooksheet-backup-${todayISO()}.json`;
  const file = new File([data], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'PookSheet backup' });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return; // user closed the share sheet
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Saved ${name}`);
}

