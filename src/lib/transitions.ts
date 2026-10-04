// Works out *how* one song handed over to the next.
//
// Spotify's API doesn't say "Automix happened". But we can tell from timing:
//  • Automix / Crossfade start the next song *before* the current one ends,
//    so the old song still had time left when the switch happened.
//  • Automix often starts the next song part-way in (skipping the intro).
//  • A manual skip usually happens with lots of the old song left.
// Blends get a long, soft visual crossfade that matches the audio overlap.

import type { TransitionInfo } from './types';

export interface SwitchObservation {
  /** Length of the song that just ended (ms). */
  prevDurationMs: number;
  /** Where our clock thinks the old song is *now* (it kept counting past the switch). */
  prevPositionMs: number;
  /** Position of the new song reported right now. */
  newPositionMs: number;
  /** Time since the previous position report (the switch happened somewhere in this gap). */
  sinceLastReportMs: number;
  /** Was music playing before the switch? */
  wasPlaying: boolean;
}

export const MIN_BLEND_MS = 1200;
export const MAX_BLEND_MS = 12000;
const SKIP_REMAINING_MS = 14000;
const NATURAL_REMAINING_MS = 900;
const OFFSET_START_MS = 1800;
const MAX_BLEND_START_MS = 60_000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function classifyTransition(o: SwitchObservation): TransitionInfo {
  if (!o.wasPlaying) {
    return { kind: 'skip', overlapMs: 0, startOffsetMs: Math.max(0, o.newPositionMs) };
  }

  // Did the new song start part-way in? If it had started at 0 it could be at
  // most `sinceLastReportMs` in by now.
  const startedLate = o.newPositionMs > o.sinceLastReportMs + OFFSET_START_MS;
  // Automix starts the next song a few seconds in (8 to 21 s were seen), not minutes: that is somebody seeking.
  if (startedLate && o.newPositionMs > MAX_BLEND_START_MS) {
    return { kind: 'skip', overlapMs: 0, startOffsetMs: Math.max(0, o.newPositionMs - o.sinceLastReportMs / 2) };
  }
  const sinceSwitch = startedLate ? o.sinceLastReportMs / 2 : Math.min(o.newPositionMs, o.sinceLastReportMs);
  const startOffsetMs = Math.max(0, o.newPositionMs - sinceSwitch);

  // Time left on the old song at the moment it was replaced.
  const remainingAtSwitch = o.prevDurationMs - o.prevPositionMs + sinceSwitch;

  if (remainingAtSwitch > SKIP_REMAINING_MS && !startedLate) {
    return { kind: 'skip', overlapMs: 0, startOffsetMs };
  }
  if (remainingAtSwitch > NATURAL_REMAINING_MS || startedLate) {
    const overlap = remainingAtSwitch > NATURAL_REMAINING_MS ? remainingAtSwitch : 3500;
    return { kind: 'blend', overlapMs: Math.round(clamp(overlap, MIN_BLEND_MS, MAX_BLEND_MS)), startOffsetMs };
  }
  return { kind: 'natural', overlapMs: 0, startOffsetMs };
}

/**
 * Remembers how long your blends usually are (e.g. your Crossfade setting, or
 * how Automix tends to mix) so we can watch the end of each song more closely
 * at the right moment and have the next song's lyrics ready.
 */
export class BlendLearner {
  private avg: number | null = null;
  count = 0;

  record(t: TransitionInfo) {
    if (t.kind !== 'blend') return;
    this.count++;
    this.avg = this.avg === null ? t.overlapMs : this.avg * 0.7 + t.overlapMs * 0.3;
  }

  /** Typical overlap in ms, or null if we haven't seen a blend yet. */
  get typicalOverlapMs(): number | null {
    return this.avg === null ? null : Math.round(this.avg);
  }

  /** How close to the end of a song we should start checking fast. */
  watchWindowMs(): number {
    return Math.max(12000, (this.avg ?? 0) + 6000);
  }
}

/** Visual crossfade length for each kind of change. */
export function visualTransitionMs(t: TransitionInfo, reduceMotion = false): number {
  if (reduceMotion) return 250;
  switch (t.kind) {
    case 'blend':
      return clamp(t.overlapMs, MIN_BLEND_MS, 8000);
    case 'natural':
      return 900;
    case 'skip':
      return 450;
    default:
      return 700;
  }
}

/** The cover animation for an Automix / Crossfade blend: the old cover, how long it lasts, and the new song. */
export interface CoverMergePlan {
  from: string;
  ms: number;
  seq: number;
  /** The new song, whose cover stays in its merged place after the animation. */
  key: string;
}

/**
 * Should the old and new album covers merge for this song change? Only for a
 * real blend, with both covers known, when blending is on and motion isn't
 * reduced. Lasts as long as the songs overlap.
 */
export function planCoverMerge(
  change: {
    seq: number;
    track: { key: string; artUrl: string | null } | null;
    previous: { artUrl: string | null } | null;
    transition: TransitionInfo;
  },
  opts: { automixBlend: boolean; reduceMotion: boolean },
): CoverMergePlan | null {
  const from = change.previous?.artUrl;
  if (change.transition.kind !== 'blend' || !opts.automixBlend || opts.reduceMotion) return null;
  if (!from || !change.track?.artUrl) return null;
  return { from, ms: visualTransitionMs(change.transition), seq: change.seq, key: change.track.key };
}
