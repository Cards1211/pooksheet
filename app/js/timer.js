// Rest timer engine. Time is kept as an end timestamp, so the countdown stays right
// when the phone locks or the app is in the background. State survives reloads.
import * as store from './store.js';

const KEY = 'training-timer';
const DONE_SHOW_MS = 5 * 60 * 1000; // "Rest done" stays until OK, the next logged set, or 5 minutes
const LATE_SILENT_MS = 5000;        // coming back later than this: no beep, just "done"

let st = load();              // { startedAt, endAt, total, exerciseId, label, next, doneAt }
let loop = null;
let dismissT = null;
const subs = new Set();

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
function save() {
  try { st ? localStorage.setItem(KEY, JSON.stringify(st)) : localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
function emit() { for (const fn of subs) fn(st); }

export const state = () => st;
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const remainingMs = () => (st && !st.doneAt ? Math.max(0, st.endAt - Date.now()) : 0);

// ---------- sound ----------
let ctx = null;          // Web Audio, for the beep while the app is on screen
let track = null;        // <audio> playing silence + beep, so the beep can sound when locked
let trackUrl = null;
let trackLead = 0;       // seconds of silence before the beep in the current track

/** Call inside every tap: iOS only lets audio start from a user gesture. */
export function unlockAudio() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* no Web Audio */ }
}

export const lockBeepOn = () => store.profile()?.lockBeep !== false; // user chose "on" by default

function setSession(type) {
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch { /* unsupported */ }
}

const TONES = [[880, 0, 0.14], [880, 0.24, 0.14], [1320, 0.48, 0.34]]; // [Hz, start s, length s]

function webBeep() {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02;
  for (const [f, at, d] of TONES) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.6, t0 + at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + d);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + at);
    o.stop(t0 + at + d + 0.03);
  }
}

/** A small WAV: `seconds` of silence, then the three-tone beep. 8 kHz, 8-bit mono. */
function makeTrack(seconds) {
  const rate = 8000;
  const lead = Math.max(0, Math.round(seconds * rate));
  const tail = Math.round(0.9 * rate);
  const n = lead + tail;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true);
  const data = new Uint8Array(buf, 44);
  data.fill(128);
  for (const [f, at, d] of TONES) {
    const s0 = lead + Math.round(at * rate);
    const len = Math.round(d * rate);
    const fade = Math.round(0.008 * rate);
    for (let i = 0; i < len && s0 + i < n; i++) {
      const env = Math.min(1, i / fade, (len - i) / fade);
      data[s0 + i] = 128 + Math.round(100 * env * Math.sin((2 * Math.PI * f * i) / rate));
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function armTrack(seconds, label) {
  disarmTrack();
  if (!lockBeepOn()) { setSession('transient'); return; }
  setSession('playback');
  trackLead = Math.max(0, seconds);
  trackUrl = URL.createObjectURL(makeTrack(trackLead));
  track ||= new Audio();
  track.src = trackUrl;
  track.play().catch(() => { /* blocked: the on-screen beep still works */ });
  try {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Rest timer', artist: label || 'PookSheet' });
    }
  } catch { /* unsupported */ }
}

function disarmTrack() {
  if (track) { track.pause(); track.removeAttribute('src'); track.load(); }
  if (trackUrl) { URL.revokeObjectURL(trackUrl); trackUrl = null; }
}

/** Exposed for testing the generated sound. */
export const buildTrack = makeTrack;

/** True when the <audio> track has played its beep, or is playing it in step with the clock. */
function trackSounded() {
  if (!track || !trackUrl) return false;
  if (track.ended) return true;
  if (track.paused) return false;                // blocked, or another app took the sound
  return track.currentTime >= trackLead - 0.5;   // false when an interruption left it behind
}

// ---------- timer ----------
let onDone = () => {};
/** The UI registers what happens at zero (flash, announcement). */
export const setDoneHandler = (fn) => { onDone = fn; };

function tick() {
  if (!st || st.doneAt) return stopLoop();
  if (Date.now() >= st.endAt) return finish('alert');
  emit();
}
function startLoop() { clearTimeout(dismissT); if (!loop) loop = setInterval(tick, 250); }
function stopLoop() { clearInterval(loop); loop = null; }
function dismissLater() {
  clearTimeout(dismissT);
  dismissT = setTimeout(() => { if (st?.doneAt) stop(); }, Math.max(0, st.doneAt + DONE_SHOW_MS - Date.now()));
}

/**
 * The rest reached zero. 'alert': beep and flash. 'quiet': flash only (a shorter preset put
 * the end in the past). 'silent': nothing (the app came back long after the end).
 */
function finish(mode) {
  st.doneAt = Date.now();
  save();
  stopLoop();
  dismissLater();
  // the track carries its own beep; beep here only if it didn't (or won't on time)
  if (mode === 'alert' && !trackSounded()) { disarmTrack(); webBeep(); }
  emit(); // draw "Rest done" first, so the flash and the announcement land on it
  if (mode === 'silent') return;
  if (mode === 'alert') { try { navigator.vibrate?.([220, 120, 220]); } catch { /* unsupported */ } }
  onDone(st);
}

/** Start (or restart) a rest. Call synchronously inside the tap that logged the set. */
export function start({ seconds, exerciseId = null, label = '', next = '' }) {
  const now = Date.now();
  st = { startedAt: now, endAt: now + seconds * 1000, total: seconds, exerciseId, label, next, doneAt: null };
  save();
  armTrack(seconds, label);
  startLoop();
  emit();
}

export function addSeconds(n) {
  if (!st) return;
  const now = Date.now();
  if (st.doneAt) {
    st = { ...st, startedAt: now, endAt: now + n * 1000, total: n, doneAt: null };
  } else {
    st.endAt += n * 1000;
    st.total += n;
  }
  save();
  armTrack((st.endAt - now) / 1000, st.label);
  startLoop();
  emit();
}

/** Change this rest's length (e.g. from the preset chips), counting from when it started. */
export function setLength(seconds) {
  if (!st) return;
  const wasDone = !!st.doneAt;
  st.total = seconds;
  st.endAt = st.startedAt + seconds * 1000;
  st.doneAt = null;
  save();
  const left = (st.endAt - Date.now()) / 1000;
  if (left <= 0) { disarmTrack(); finish(wasDone ? 'silent' : 'quiet'); return; }
  armTrack(left, st.label);
  startLoop();
  emit();
}

export function stop() {
  st = null;
  save();
  disarmTrack();
  stopLoop();
  clearTimeout(dismissT);
  emit();
}

/** After a reload or coming back to the app, catch up with the clock. */
function resync() {
  if (!st) return;
  if (st.doneAt) {
    if (Date.now() - st.doneAt > DONE_SHOW_MS) stop(); else { dismissLater(); emit(); }
    return;
  }
  const late = Date.now() - st.endAt;
  if (late >= 0) finish(late > LATE_SILENT_MS ? 'silent' : 'alert');
  else { startLoop(); emit(); }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) resync(); });
export const init = () => resync();
