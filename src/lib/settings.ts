// User preferences, saved in this browser.
import { useSyncExternalStore } from 'react';
import type { StyleChoice } from './types';

export type BackgroundMode = 'art' | 'fluid';
export type WordSweep = 'estimated' | 'real-only' | 'off';
export type BreakVisualChoice = 'bars' | 'dots';
/** How a strong beat shows: nothing, a glow and ring behind the lyrics, a wash over the whole screen, a glowing screen edge, or a little kick of the lyrics. */
export type BeatStyle = 'off' | 'glow' | 'screen' | 'edges' | 'kick';
/** What to show for a song without lyrics: a pulsing orb, a mirrored equalizer, or just the message. */
export type NoLyricsVisual = 'orb' | 'bars' | 'message';
/** Windows desktop app: follow the computer's real sound. "ask" = not chosen yet (the app asks once). */
export type SoundSync = 'ask' | 'on' | 'off';

export interface Settings {
  /** Which lyric style to use ("auto" picks one per song). */
  style: StyleChoice;
  /** Shift lyrics earlier (+) or later (−), in ms. Useful with Bluetooth delay. */
  offsetMs: number;
  /** Lyric text size multiplier. */
  fontScale: number;
  /** Moving blurred album art, or flowing colors taken from it. */
  background: BackgroundMode;
  /** Word-by-word highlight: always (estimate when needed), only with real word timing, or whole lines. */
  wordSweep: WordSweep;
  /** Long, smooth crossfades when Spotify Automix / Crossfade blends songs. */
  automixBlend: boolean;
  /** What to show during instrumental breaks: moving bars, or the three dots. */
  breakVisual: BreakVisualChoice;
  /** Windows desktop app: make the bars, the flash and the no-lyrics scene follow the computer's real sound (only while the song plays). */
  soundSync: SoundSync;
  /** Wait this long before the effects react to the sound (0–500 ms), for Bluetooth headphones. */
  soundDelayMs: number;
  /** How strong beats show in the short pauses between lines, and in a song without lyrics. */
  beatStyle: BeatStyle;
  /** What to show while a song has no lyrics (or is instrumental). */
  noLyricsVisual: NoLyricsVisual;
  /** Tone down movement and blur. */
  reduceMotion: boolean;
  /** Hide the player controls and show only lyrics. */
  lyricsOnly: boolean;
  /** Desktop app: keep the window above other windows. */
  alwaysOnTop: boolean;
}

const KEY = 'ls.settings.v1';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const DEFAULT_SETTINGS: Settings = {
  style: 'apple',
  offsetMs: 0,
  fontScale: 1,
  background: 'art',
  wordSweep: 'estimated',
  automixBlend: true,
  breakVisual: 'bars',
  soundSync: 'ask',
  soundDelayMs: 0,
  beatStyle: 'glow',
  noLyricsVisual: 'orb',
  reduceMotion: prefersReducedMotion(),
  lyricsOnly: false,
  alwaysOnTop: false,
};

/**
 * Saved settings from an older version, brought up to date. Version 0.5.0 had a
 * plain on/off switch for the beat flash (`beatFlash`) and one for following the
 * real sound (`reactToSound`): whoever turned the flash off keeps it off, and
 * whoever turned the sound on keeps it on.
 */
export function migrateSettings(stored: Record<string, unknown>): Record<string, unknown> {
  const next = { ...stored };
  if (next.beatFlash === false && next.beatStyle === undefined) next.beatStyle = 'off';
  if (next.reactToSound === true && next.soundSync === undefined) next.soundSync = 'on';
  delete next.beatFlash;
  delete next.reactToSound;
  return next;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...migrateSettings(JSON.parse(raw)) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function getSettings() {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}
