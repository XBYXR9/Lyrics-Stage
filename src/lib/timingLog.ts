// A short memory of how Spotify's song position behaved around song changes, so a
// lyrics-timing problem can be looked at afterwards (Settings → Timing report).
// It only keeps text lines in memory: nothing is sent anywhere.

const MAX_LINES = 400;
const lines: string[] = [];
const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
let watchUntil = 0;

/** Starts (or extends) a watching period: positions are logged while it lasts. */
export function watchTiming(ms: number) {
  watchUntil = Math.max(watchUntil, performance.now() + ms);
}

export const isWatchingTiming = () => performance.now() < watchUntil;

/** Seconds with one decimal, for the log ("12.3"). */
export const sec = (ms: number | null | undefined) => (typeof ms === 'number' && Number.isFinite(ms) ? (ms / 1000).toFixed(1) : '?');

/** Seconds with a sign ("+0.4", "-5.9"). */
export const signedSec = (ms: number) => `${ms >= 0 ? '+' : '-'}${(Math.abs(ms) / 1000).toFixed(1)}`;

export function logTiming(line: string) {
  lines.push(`[${((performance.now() - startedAt) / 1000).toFixed(1)}s] ${line}`);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

export function clearTimingLog() {
  lines.length = 0;
  watchUntil = 0;
}

/** The text to paste when reporting a timing problem: a header, then the log. */
export function timingReport(header: string[]): string {
  return ['Lyrics Stage timing report', ...header, '', ...(lines.length ? lines : ['(nothing logged yet: let a song change first)'])].join('\n');
}

/** The app's version, set at build time. */
export const appVersion = () => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev');
