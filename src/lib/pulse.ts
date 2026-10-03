// The moving bars shown during instrumental breaks.
//
// Spotify doesn't share beat or tempo data with new apps, so by default the
// bars move to an *estimated* rhythm: its speed comes from how energetic the
// song feels (rap and dance songs are fast, ballads slow), and it's worked out
// from the playback position, so it never drifts and seeking can't break it.
// It looks like a beat but isn't locked to the real one. On Windows the app can
// instead listen to the real sound (see audioLevels.ts), which does hit the beat.

/** Number of bars. */
export const BAR_COUNT = 24;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Beats per minute guessed from the song's energy (0 = calm ballad, 1 = intense). */
export function estimatedBpm(energy: number): number {
  return Math.round(lerp(72, 148, clamp01(energy)));
}

/** A small, stable pseudo-random number in [0, 1) for a bar. */
const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Fills `out` (BAR_COUNT values, 0..1) with bar heights for song position
 * `songMs`. Low bars thump on every beat, middle bars snap on beats 2 and 4,
 * high bars flick on the off-beats, and everything shimmers a little.
 */
export function estimatedBars(out: Float32Array, songMs: number, energy: number): void {
  const e = clamp01(energy);
  const beatMs = 60000 / estimatedBpm(e);
  const beat = songMs / beatMs;
  const phase = beat - Math.floor(beat);
  const inBar = ((Math.floor(beat) % 4) + 4) % 4;
  const kick = Math.exp(-phase * 5);
  const snare = inBar % 2 === 1 ? Math.exp(-phase * 7) : 0;
  const off = (phase + 0.5) % 1;
  const hat = Math.exp(-off * 9) * 0.7;
  const punch = lerp(0.62, 1, e);
  for (let i = 0; i < out.length; i++) {
    const f = out.length > 1 ? i / (out.length - 1) : 0; // 0 = lowest bar, 1 = highest
    const wLow = Math.pow(1 - f, 1.6);
    const wMid = 1 - Math.abs(f - 0.45) * 2.2;
    const wHigh = Math.pow(f, 1.5);
    const shimmer = 0.5 + 0.5 * Math.sin(songMs / (210 + hash(i) * 260) + hash(i + 9) * 6.28);
    const hit = kick * wLow + snare * Math.max(0, wMid) + hat * wHigh;
    const body = 0.16 + (1 - f) * 0.14 + shimmer * 0.2 * lerp(0.6, 1, e);
    out[i] = clamp01((body + hit * 0.75) * punch);
  }
}
