// The no-lyrics beat scene: small pure helpers for drawing it (see BeatScene.tsx).
import type { NoLyricsVisual } from './settings';
import type { LyricsKind } from './types';

/**
 * Does a song with this kind of lyrics get the beat scene? Songs without any
 * lyrics, and instrumentals, do (unless the user picked just a message, or
 * turned on Reduce motion). Synced and plain lyrics never do.
 */
export function showsScene(kind: LyricsKind | null, visual: NoLyricsVisual, reduceMotion: boolean): boolean {
  return (kind === 'none' || kind === 'instrumental') && visual !== 'message' && !reduceMotion;
}

export { BIG_BEAT, isBigBeat } from './beat';
import { isBigBeat } from './beat';

/** How much the orb (or the equalizer) swells `ageMs` after a beat: a quick punch that settles back, bigger for big beats. */
export function punchShape(ageMs: number, strength: number): number {
  if (ageMs < 0 || strength <= 0) return 0;
  const s = Math.min(1, strength);
  return s * (isBigBeat(s) ? 0.3 : 0.14) * Math.min(1, ageMs / 20) * Math.exp(-ageMs / 150);
}

/** Stretches or shrinks a list of bar levels to `n` values, blending neighbours smoothly. */
export function resampleLevels(src: ArrayLike<number>, n: number, out: Float32Array = new Float32Array(n)): Float32Array {
  const last = src.length - 1;
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? (i / (n - 1)) * last : 0;
    const a = Math.floor(f);
    const b = Math.min(last, a + 1);
    out[i] = src[a] + (src[b] - src[a]) * (f - a);
  }
  return out;
}

/** The same color with this opacity (0..1). The album colors are `hsl(H S% L%)`; anything else is returned as is. */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha)).toFixed(3);
  return /^hsl\([^/)]*\)$/.test(color) ? color.replace(/\)$/, ` / ${a})`) : color;
}

/** How long a ripple takes to spread and fade. */
export const RIPPLE_MS = 950;

/** A ripple `ageMs` after its beat: how far out it has spread (in orb radii) and how visible it still is (0..1). */
export function rippleShape(ageMs: number, strength: number): { radius: number; alpha: number; width: number } | null {
  if (ageMs < 0 || ageMs >= RIPPLE_MS) return null;
  const p = ageMs / RIPPLE_MS;
  const s = Math.min(1, strength);
  // A big beat sends its shockwave much further, across most of the screen.
  const reach = isBigBeat(s) ? 3.6 : 1.5;
  return {
    radius: 1.15 + p * reach,
    alpha: (1 - p) * (1 - p) * (isBigBeat(s) ? 0.7 : 0.45) * s,
    width: (isBigBeat(s) ? 3 : 2) + (1 - p) * (isBigBeat(s) ? 6 : 3),
  };
}

/** Mean of `a[from..to)`. */
export function mean(a: ArrayLike<number>, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += a[i];
  return to > from ? sum / (to - from) : 0;
}
