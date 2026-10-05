// The "beat flash": a soft glow, wash, edge light or kick that pulses on strong
// beats, but only during the short pauses between sung lines (long instrumental
// breaks have their own bars) and, for songs without lyrics, on every strong
// beat. The pieces here are plain functions so they can be tested.

import { findLineIndex, INTERLUDE_MIN_MS } from './lrc';
import type { BeatStyle } from './settings';
import type { LyricLine, LyricsKind } from './types';

/** A gap between two sung lines must be at least this long to count as a pause. */
export const MIN_PAUSE_MS = 250;

/**
 * Flashes are at least this far apart: never more than three a second, the
 * limit that web accessibility guidelines set for flashing content.
 */
export const MIN_FLASH_GAP_MS = 340;

/**
 * With "Flash on every fast beat" switched on (off by default, and not for anyone sensitive to flashing light) flashes may
 * be this far apart: up to about seven a second, so a fast drum pattern is followed beat by beat.
 */
export const FAST_FLASH_GAP_MS = 140;

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

/**
 * Is the song actually playing, and are we inside its length? Everything that
 * reacts to the computer's sound is switched on only inside this window, so
 * other sounds on the computer (a video, a message ping) can't set off the
 * effects while Spotify is paused, between songs or during an ad.
 */
export function inSongWindow(o: { playing: boolean; positionMs: number; durationMs: number }): boolean {
  if (!o.playing || !Number.isFinite(o.positionMs) || o.positionMs < 0) return false;
  return !(o.durationMs > 0 && o.positionMs >= o.durationMs);
}

/** May a flash happen now, given when the last one did? (`fast`: the opt-in for fast drum patterns, see FAST_FLASH_GAP_MS.) */
export const canFlash = (nowMs: number, lastFlashAtMs: number, fast = false) =>
  nowMs - lastFlashAtMs >= (fast ? FAST_FLASH_GAP_MS : MIN_FLASH_GAP_MS);

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

/** A beat at least this strong is a "big beat" (the same cut-off the no-lyrics scene uses for its shockwave). */
export const BIG_BEAT = 0.7;
export const isBigBeat = (strength: number) => strength >= BIG_BEAT;

/** What the beat code should do right now. */
export interface BeatPlan {
  /** Listen for beats at all (costs a little work every frame). */
  detect: boolean;
  /** Where the chosen flash style may show: only in short pauses between lines, anywhere (a song without lyrics), or never. */
  flashIn: 'pauses' | 'always' | 'never';
  /** Every bass beat heard in the real sound also flashes anywhere in the song, even while someone is singing. */
  anywhere: boolean;
}

/**
 * Works out what to do from the settings and what's on screen. Reduce motion
 * switches everything off. With synced lyrics the flash shows in the short
 * pauses, and bass beats (if allowed) show anywhere. With the no-lyrics scene on
 * screen, beats are always listened for (the scene pulses with them) and the
 * flash shows on every strong beat.
 */
export function beatPlan(o: {
  style: BeatStyle;
  reduceMotion: boolean;
  lyricsKind: LyricsKind | null;
  sceneShown: boolean;
  whileSinging: boolean;
  /** The background moves with the beat: beats are listened for even when no flash is shown. */
  background?: boolean;
}): BeatPlan {
  const off: BeatPlan = { detect: false, flashIn: 'never', anywhere: false };
  if (o.reduceMotion) return off;
  // Only listening: the background wants the beats, but nothing flashes.
  const listenOnly: BeatPlan = o.background ? { detect: true, flashIn: 'never', anywhere: false } : off;
  if (o.sceneShown) return { detect: true, flashIn: o.style === 'off' ? 'never' : 'always', anywhere: false };
  if (o.style === 'off') return listenOnly;
  const synced = o.lyricsKind === 'synced';
  if (!synced && !o.whileSinging) return listenOnly;
  return { detect: true, flashIn: synced ? 'pauses' : 'never', anywhere: o.whileSinging };
}

// Strong beats are announced here, so the flash, the background and the no-lyrics scene react to the same ones.
// `real` is false for the estimated rhythm (no sound to listen to): it is only a steady guess at the tempo.
type BeatListener = (strength: number, real: boolean) => void;
const listeners = new Set<BeatListener>();

/** Calls `listener` with the strength (0..1) of every strong beat. Returns a function that stops listening. */
export function onBeat(listener: BeatListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitBeat(strength: number, real = true) {
  listeners.forEach((l) => l(strength, real));
}

/**
 * How hard the background is pushed by a beat, fading away on its own. A beat sets it to its own strength (never
 * adds to it), so a fast run of beats keeps the background pushed without making it move further: the zoom is
 * bounded however many beats there are. The estimated rhythm only pushes gently, since it is a guess.
 */
export class BeatPunch {
  private value = 0;
  private at = 0;

  hit(strength: number, real: boolean, nowMs: number) {
    const s = (PUNCH_FLOOR + (1 - PUNCH_FLOOR) * Math.min(1, Math.max(0, strength))) * (real ? 1 : ESTIMATED_PUNCH);
    this.value = Math.max(this.read(nowMs), s);
    this.at = nowMs;
  }

  /** 0..1 now. */
  read(nowMs: number): number {
    const age = nowMs - this.at;
    if (age < 0) return this.value;
    return this.value * Math.exp(-age / PUNCH_DECAY_MS);
  }
}

/** Even the softest beat pushes this much (of the full push). */
const PUNCH_FLOOR = 0.4;
/** The estimated rhythm pushes this much of what a real beat does. */
export const ESTIMATED_PUNCH = 0.45;
/** How fast the push dies away. */
export const PUNCH_DECAY_MS = 170;
/** The background grows by this much (a fraction) at a full push: a few percent, soft and blurred, no change in brightness. */
export const BG_ZOOM = 0.05;

/** Settings asks for a sample flash of the chosen style (when you change it). */
export const BEAT_PREVIEW_EVENT = 'ls:beat-preview';
