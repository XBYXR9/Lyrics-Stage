// A short note, shown when an Automix blend happens, saying why the album covers don't merge when that is down to a
// setting (Reduce motion, which also makes song changes quick, or Automix blend being off). Without it the animation
// just seems to have stopped working. Shown a few times at most, then left alone.

import type { CoverMergeBlocker } from './transitions';

const KEY = 'ls.motionHint.v1';
const MAX_SHOWS = 3;
let shownThisRun = false;

/** The note for what blocked the cover merge, or null when there is nothing to tell (it is not down to a setting). */
export function motionHintText(blocker: CoverMergeBlocker | null, systemReducesMotion: boolean): string | null {
  if (blocker === 'reduce-motion') {
    return `Reduce motion is on, so Automix covers don’t merge and song changes are quick.${systemReducesMotion ? ' Windows has animations turned off.' : ''} Turn it off in Settings.`;
  }
  if (blocker === 'blend-off') return 'Automix blend is off, so the covers don’t merge. Turn it on in Settings → Song transitions.';
  return null;
}

/** Should the note be shown now? Once per run, and only the first few times ever. */
export function takeMotionHint(): boolean {
  if (shownThisRun) return false;
  shownThisRun = true;
  try {
    const n = Number(localStorage.getItem(KEY)) || 0;
    if (n >= MAX_SHOWS) return false;
    localStorage.setItem(KEY, String(n + 1));
    return true;
  } catch {
    return true;
  }
}
