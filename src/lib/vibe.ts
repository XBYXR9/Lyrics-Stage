// Guesses a song's "vibe" so the lyrics can move like the music.
//
// Spotify no longer gives new apps tempo/energy data, so we estimate it:
//  • How fast the words come (words per second while singing). Rap ≈ 3+,
//    ballads ≈ 1.
//  • How colorful and bright the cover is (a small nudge).
// The result tunes scroll speed, stagger, background motion and — in "Auto"
// mode — which lyric style is used.

import type { Lyrics, Palette, StyleId, Vibe } from './types';

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function wordsPerSecond(lyrics: Lyrics | null): number | null {
  if (!lyrics || lyrics.kind !== 'synced') return null;
  const sung = lyrics.lines.filter((l) => !l.interlude && l.words.length);
  let words = 0;
  let ms = 0;
  sung.forEach((line, i) => {
    words += line.words.length;
    // Time from this line to the next one (capped, so instrumental breaks
    // don't count). This works the same whether word timings are real or
    // estimated — estimated ones would make every song look equally fast.
    // The last line has no next line, so it gets the average spacing.
    const next = sung[i + 1]?.start;
    ms += next !== undefined ? Math.min(6000, Math.max(300, next - line.start)) : i > 0 ? ms / i : line.end - line.start;
  });
  return ms > 0 ? words / (ms / 1000) : null;
}

export function analyzeVibe(lyrics: Lyrics | null, palette: Palette | null): Vibe {
  const wps = wordsPerSecond(lyrics);
  const lyricEnergy = wps === null ? 0.45 : clamp((wps - 1.0) / 2.4);
  const colorEnergy = palette ? clamp(palette.saturation * 0.65 + palette.brightness * 0.35) : 0.5;
  const energy = clamp(lyricEnergy * 0.75 + colorEnergy * 0.25);

  const label: Vibe['label'] = energy < 0.25 ? 'calm' : energy < 0.5 ? 'smooth' : energy < 0.75 ? 'upbeat' : 'intense';

  let autoStyle: StyleId = 'apple';
  if (lyrics?.kind === 'synced') {
    if ((wps ?? 0) >= 3.0) autoStyle = 'kinetic';
    else if (energy < 0.22) autoStyle = 'spotlight';
    else if (palette && palette.saturation > 0.45 && palette.brightness < 0.4 && energy >= 0.4) autoStyle = 'neon';
    else if (energy >= 0.55 && palette && palette.brightness >= 0.45) autoStyle = 'karaoke';
  }

  return {
    energy,
    wordsPerSecond: wps ?? 0,
    label,
    autoStyle,
    scrollMs: Math.round(lerp(950, 480, energy)),
    staggerMs: Math.round(lerp(75, 30, energy)),
    motion: lerp(0.45, 1.6, energy),
  };
}

export const DEFAULT_VIBE: Vibe = analyzeVibe(null, null);
