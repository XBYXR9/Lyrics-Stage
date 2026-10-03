import { describe, expect, it } from 'vitest';
import { barsFromSpectrum } from '../audioLevels';
import { BAR_COUNT, estimatedBars, estimatedBpm } from '../pulse';

const bars = (t: number, energy: number) => {
  const out = new Float32Array(BAR_COUNT);
  estimatedBars(out, t, energy);
  return out;
};
const avg = (a: Float32Array, from: number, to: number) => a.slice(from, to).reduce((x, y) => x + y, 0) / (to - from);

describe('estimated rhythm', () => {
  it('is faster for energetic songs', () => {
    expect(estimatedBpm(0)).toBeLessThan(estimatedBpm(0.5));
    expect(estimatedBpm(0.5)).toBeLessThan(estimatedBpm(1));
    expect(estimatedBpm(-3)).toBe(estimatedBpm(0));
    expect(estimatedBpm(9)).toBe(estimatedBpm(1));
  });

  it('keeps every bar between 0 and 1, and is the same for the same song position', () => {
    for (const t of [0, 1234, 50_000, 187_654]) {
      const a = bars(t, 0.6);
      for (const v of a) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(Array.from(bars(t, 0.6))).toEqual(Array.from(a));
    }
  });

  it('thumps in the low bars on the beat and settles between beats', () => {
    const beatMs = 60000 / estimatedBpm(0.6);
    const onBeat = avg(bars(beatMs * 8, 0.6), 0, 6);
    const between = avg(bars(beatMs * 8.55, 0.6), 0, 6);
    expect(onBeat).toBeGreaterThan(between + 0.15);
  });

  it('moves over time', () => {
    expect(Array.from(bars(1000, 0.5))).not.toEqual(Array.from(bars(1300, 0.5)));
  });
});

describe('real sound bars', () => {
  const sampleRate = 48000;
  const spectrum = (fill: (hz: number) => number) =>
    Uint8Array.from({ length: 1024 }, (_, i) => fill((i * sampleRate) / 2 / 1024)); // like fftSize 2048
  const fresh = () => ({ smooth: new Float32Array(BAR_COUNT), peak: 0 });

  it('puts a bass sound in the low bars and a treble sound in the high bars', () => {
    const out = new Float32Array(BAR_COUNT);
    const peak = (a: Float32Array, from: number, to: number) => Math.max(...a.slice(from, to));
    expect(barsFromSpectrum(spectrum((hz) => (hz > 60 && hz < 140 ? 200 : 0)), sampleRate, out, fresh())).toBe(true);
    expect(peak(out, 0, 6)).toBeGreaterThan(0.4);
    expect(peak(out, 14, 24)).toBeLessThan(0.05);
    const high = new Float32Array(BAR_COUNT);
    barsFromSpectrum(spectrum((hz) => (hz > 6000 && hz < 9000 ? 200 : 0)), sampleRate, high, fresh());
    expect(peak(high, 14, 24)).toBeGreaterThan(0.4);
    expect(peak(high, 0, 6)).toBeLessThan(0.05);
  });

  it('fills the bars for quiet and loud songs alike', () => {
    const quiet = new Float32Array(BAR_COUNT);
    const loud = new Float32Array(BAR_COUNT);
    barsFromSpectrum(spectrum((hz) => (hz < 3000 ? 60 : 0)), sampleRate, quiet, fresh());
    barsFromSpectrum(spectrum((hz) => (hz < 3000 ? 220 : 0)), sampleRate, loud, fresh());
    expect(Math.max(...quiet)).toBeGreaterThan(0.5);
    expect(Math.max(...loud)).toBeGreaterThan(0.5);
  });

  it('reports silence, and lets the bars fall gradually instead of dropping', () => {
    const out = new Float32Array(BAR_COUNT);
    const state = fresh();
    barsFromSpectrum(spectrum(() => 200), sampleRate, out, state);
    const loud = Math.max(...out);
    expect(barsFromSpectrum(spectrum(() => 0), sampleRate, out, state)).toBe(false);
    expect(Math.max(...out)).toBeLessThan(loud);
    expect(Math.max(...out)).toBeGreaterThan(loud * 0.5);
  });
});
