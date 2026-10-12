import { describe, expect, it } from 'vitest';
import { LevelReader } from '../audioLevels';
import { growthFromHeld } from '../../components/styles/StretchStyle';
import { correlation, SustainDetector } from '../sustain';
import { BAR_COUNT } from '../pulse';
import { rng, SAMPLE_RATE, spectra, voice } from './synth';

/** The longest hold the detector reports while `signal` plays, in ms. */
function longestHold(signal: (t: number) => number, seconds: number): number {
  const d = new SustainDetector();
  let longest = 0;
  for (const f of spectra(signal, seconds)) longest = Math.max(longest, d.push(f.bins, SAMPLE_RATE, f.at).heldMs);
  return longest;
}

const drums = (amp: number) => {
  const r = rng(3);
  return (t: number) => (t % 0.5 < 0.08 ? r() * amp * Math.exp(-(t % 0.5) * 40) : 0);
};

describe('correlation', () => {
  it('is 1 for the same shape, -1 for the opposite, and 0 for a flat one', () => {
    expect(correlation([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 6);
    expect(correlation([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 6);
    expect(correlation([1, 2, 3], [5, 5, 5])).toBe(0);
  });
});

describe('SustainDetector (made-up sound: only a test of the idea, not of real music)', () => {
  const note = (from: number, to: number, f0: number, amp = 1) => (t: number) => (t > from && t < to ? amp * voice(f0)(t) : 0);

  it('measures how long a sung vowel is held', () => {
    expect(longestHold(note(0.3, 1.8, 220), 2.5)).toBeGreaterThan(1200);
    expect(longestHold(note(0.3, 1.8, 220), 2.5)).toBeLessThan(1700);
    expect(longestHold(note(0.3, 3.3, 250), 4)).toBeGreaterThan(2700);
    expect(longestHold(note(0.3, 0.9, 330), 2)).toBeGreaterThan(350);
  });

  it('reports nothing for silence, hiss and drum hits', () => {
    expect(longestHold(() => 0, 2)).toBe(0);
    const r = rng(7);
    expect(longestHold(() => r() * 0.3, 2.5)).toBe(0);
    expect(longestHold(drums(0.8), 2.5)).toBe(0);
  });

  it('does not chain the notes of a melody into one long hold', () => {
    const steps = (ms: number) => (t: number) => voice(200 + 40 * (Math.floor(t / (ms / 1000)) % 7))(t);
    expect(longestHold(steps(120), 2.5)).toBeLessThan(350);
    expect(longestHold(steps(250), 2.5)).toBeLessThan(450);
  });

  it('still finds a held note when drums hit over it', () => {
    const mix = (t: number) => note(0.3, 1.8, 260, 0.6)(t) + drums(0.4)(t);
    expect(longestHold(mix, 2.5)).toBeGreaterThan(1000);
  });

  it('stops counting a note that has been steady for the whole song, like a pad', () => {
    // The baseline catches up with it; a real held note stays above that. (The first few seconds can still be fooled.)
    const d = new SustainDetector();
    const pad = (t: number) => voice(165, 0.001)(t) * 0.8;
    let held = 0;
    for (const f of spectra(pad, 16)) held = d.push(f.bins, SAMPLE_RATE, f.at).heldMs;
    expect(held).toBe(0);
  });

  it('forgets everything on reset', () => {
    const d = new SustainDetector();
    let last = 0;
    for (const f of spectra(note(0, 5, 220), 1)) last = d.push(f.bins, SAMPLE_RATE, f.at).heldMs;
    expect(last).toBeGreaterThan(300);
    d.reset();
    const f = spectra(note(0, 5, 220), 0.05)[0];
    expect(d.push(f.bins, SAMPLE_RATE, 5000).heldMs).toBe(0);
  });
});

describe('growthFromHeld (how big the held letter gets)', () => {
  it('starts small, grows steadily and tops out at 1', () => {
    expect(growthFromHeld(0)).toBe(0);
    expect(growthFromHeld(200)).toBe(0);
    expect(growthFromHeld(900)).toBeGreaterThan(0.2);
    expect(growthFromHeld(1200)).toBeGreaterThan(growthFromHeld(900));
    expect(growthFromHeld(1400)).toBeCloseTo(1, 5);
    expect(growthFromHeld(9000)).toBe(1);
  });
});

describe('LevelReader and the held-note reading', () => {
  const frames = spectra((t) => (t > 0.2 ? voice(220)(t) : 0), 2.5);
  /** Plays the made-up sound into a reader, one snapshot per read, and returns what sustain() said at the end. */
  function play(open: boolean, delayMs = 0, upTo = 2400) {
    let i = 0;
    const reader = new LevelReader((into) => into.set(frames[i].bins), SAMPLE_RATE, 1024);
    reader.setWindow(open);
    reader.setDelay(delayMs);
    const out = new Float32Array(BAR_COUNT);
    let last: ReturnType<LevelReader['sustain']> = null;
    for (i = 0; i < frames.length && frames[i].at <= upTo; i++) {
      reader.read(frames[i].at, out);
      last = reader.sustain();
    }
    return last;
  }

  it('reports the held note while the song is playing', () => {
    expect(play(true)?.heldMs ?? 0).toBeGreaterThan(1200);
  });

  it('reports nothing while the song window is closed', () => {
    expect(play(false)).toBeNull();
  });

  it('is late by the Bluetooth delay, like the bars', () => {
    const now = play(true, 0, 1000)?.heldMs ?? 0;
    const later = play(true, 400, 1000)?.heldMs ?? 0;
    expect(later).toBeLessThan(now);
    expect(now - later).toBeGreaterThan(250);
  });
});
