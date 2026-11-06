// Offline copy of the app: registers sw.js and looks for updates.
import * as timer from './timer.js';

const stamped = document.querySelector('meta[name="app-version"]')?.content || '';

/** The published version, or 'dev' for a copy run straight from the project folder. */
export const appVersion = !stamped || stamped.startsWith('__') ? 'dev' : stamped;

const UPDATE_RETRIES = 2;
const UPDATE_RETRY_MS = 5000;

export function startOffline() {
  if (appVersion === 'dev' || !('serviceWorker' in navigator)) return;
  const hadCopy = !!navigator.serviceWorker.controller;
  let touched = false;
  document.addEventListener('pointerdown', () => { touched = true; }, { capture: true, once: true, passive: true });
  // An update that lands before the first tap switches over straight away. After that it
  // waits for the next launch, so the app never reloads in the middle of a workout.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadCopy && !touched && !timer.state()) location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // A failed download leaves the current version running, so try again shortly.
    let retries = UPDATE_RETRIES;
    const watch = (worker) => worker?.addEventListener('statechange', () => {
      if (worker.state !== 'redundant' || retries < 1) return;
      retries -= 1;
      setTimeout(() => reg.update().catch(() => { /* no signal: the next launch tries again */ }), UPDATE_RETRY_MS);
    });
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update().catch(() => { /* no signal: try again next time */ });
    });
  }).catch((err) => console.warn('Offline copy unavailable:', err));
}
