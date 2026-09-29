// Shared shapes used across the app.

export interface TrackInfo {
  /** Spotify track id, or the uri for local files (which have no id). */
  key: string;
  id: string | null;
  uri: string;
  name: string;
  artists: string[];
  album: string;
  /** Largest cover image, used for the big art and the background. */
  artUrl: string | null;
  /** Smallest cover image, handy for lists. */
  artThumbUrl: string | null;
  durationMs: number;
  /** Demo tracks ship their own lyrics so the demo works offline. */
  localLyrics?: Lyrics;
}

export interface LyricWord {
  text: string;
  start: number; // ms
  end: number; // ms
  /** True for words in (parentheses) — backing vocals. */
  backing?: boolean;
}

export interface LyricLine {
  id: number;
  start: number; // ms
  end: number; // ms
  text: string;
  words: LyricWord[];
  /** "••• " pause shown during long instrumental gaps. */
  interlude?: boolean;
  rtl?: boolean;
}

export type LyricsKind = 'synced' | 'plain' | 'instrumental' | 'none';

export interface Lyrics {
  kind: LyricsKind;
  lines: LyricLine[];
  /** True when the word timings are real (not estimated from line timing). */
  wordSynced: boolean;
  source: string;
}

export interface Palette {
  /** Darkish base color for the page background. */
  base: string;
  /** Bright, saturated color for highlights (readable on the base). */
  accent: string;
  /** Second highlight color. */
  accent2: string;
  /** 4-5 colors for the moving background blobs. */
  colors: string[];
  /** 0..1 — how colorful the cover is. */
  saturation: number;
  /** 0..1 — how bright the cover is. */
  brightness: number;
}

export type StyleId = 'apple' | 'karaoke' | 'neon' | 'spotlight' | 'kinetic';
export type StyleChoice = StyleId | 'auto';

export interface Vibe {
  /** 0 (slow, calm) .. 1 (fast, intense). Guessed from lyric pacing + cover colors. */
  energy: number;
  /** Words sung per second while singing. */
  wordsPerSecond: number;
  label: 'calm' | 'smooth' | 'upbeat' | 'intense';
  /** Style picked when the style setting is "Auto". */
  autoStyle: StyleId;
  /** Main scroll animation length (ms) — slower songs glide slower. */
  scrollMs: number;
  /** Delay between lines in the Apple Music "wave" scroll. */
  staggerMs: number;
  /** Background motion speed multiplier. */
  motion: number;
}

/** How one song handed over to the next. */
export type TransitionKind =
  | 'initial' // first song we saw
  | 'skip' // user jumped to another song
  | 'natural' // song ended, next started from the top
  | 'blend'; // songs overlapped: Spotify Automix / Crossfade

export interface TransitionInfo {
  kind: TransitionKind;
  /** How long the old and new song overlapped (ms). Drives the visual crossfade length. */
  overlapMs: number;
  /** Where the new song started (ms). Automix often skips intros. */
  startOffsetMs: number;
}
