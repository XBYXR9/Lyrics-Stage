// User preferences, saved in this browser.
import { useSyncExternalStore } from 'react';
import type { StyleChoice } from './types';

export type BackgroundMode = 'art' | 'fluid';
export type WordSweep = 'estimated' | 'real-only' | 'off';
export type BreakVisualChoice = 'bars' | 'dots';

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
  /** Windows desktop app: make the bars follow the real sound instead of an estimated rhythm. */
  reactToSound: boolean;
  /** A soft flash on strong beats in the short pauses between lines. */
  beatFlash: boolean;
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
  reactToSound: false,
  beatFlash: true,
  reduceMotion: prefersReducedMotion(),
  lyricsOnly: false,
  alwaysOnTop: false,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
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
