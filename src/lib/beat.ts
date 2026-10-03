// The "beat flash": a soft glow and ring that pulse on strong beats, but only
// during the short pauses between sung lines (long instrumental breaks have
// their own bars). The pieces here are plain functions so they can be tested.

import { findLineIndex, INTERLUDE_MIN_MS } from './lrc';
import type { LyricLine } from './types';

/** A gap between two sung lines must be at least this long to count as a pause. */
export const MIN_PAUSE_MS = 250;

/**
 * Flashes are at least this far apart: never more than three a second, the
 * limit that web accessibility guidelines set for flashing content.
 */
export const MIN_FLASH_GAP_MS = 340;

/** How long one flash takes to fade out. */
export const FLASH_MS = 450;

/**
 * Is song position `t` inside a short pause between two sung lines? That is,
 * after the current line has been sung, before the next one starts, with a gap
 * of at least MIN_PAUSE_MS and less than a long break (which shows the bars).
 */
export function shortPauseAt(lines: LyricLine[], t: number): boolean {
  const i = findLineIndex(lines, t);
  if (i < 0) return false;
  const cur = lines[i];
  const next = lines[i + 1];
  if (!next || cur.interlude || next.interlude) return false;
  const gap = next.start - cur.end;
  return t >= cur.end && t < next.start && gap >= MIN_PAUSE_MS && gap < INTERLUDE_MIN_MS;
}

/** May a flash happen now, given when the last one did? */
export const canFlash = (nowMs: number, lastFlashAtMs: number) => nowMs - lastFlashAtMs >= MIN_FLASH_GAP_MS;

/**
 * What the flash looks like `ageMs` after it started, for a beat of this
 * strength (0..1): a glow that peaks at once and fades, and a ring that grows
 * outward while it fades. Kept soft on purpose: a tinted glow, never white.
 */
export function flashShape(ageMs: number, strength: number): { glow: number; ring: number; ringScale: number } {
  if (ageMs < 0 || ageMs >= FLASH_MS || strength <= 0) return { glow: 0, ring: 0, ringScale: 0.35 };
  const s = Math.min(1, strength);
  const attack = Math.min(1, ageMs / 25);
  const p = ageMs / FLASH_MS;
  return {
    glow: s * 0.4 * attack * Math.exp(-ageMs / 120),
    ring: s * 0.5 * (1 - p) * (1 - p),
    ringScale: 0.35 + p * 1.1,
  };
}
