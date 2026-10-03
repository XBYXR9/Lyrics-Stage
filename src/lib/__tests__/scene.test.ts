import { describe, expect, it } from 'vitest';
import {
  BIG_BEAT,
  isBigBeat,
  mean,
  punchShape,
  resampleLevels,
  RIPPLE_MS,
  rippleShape,
  showsScene,
  withAlpha,
} from '../scene';

describe('which songs get the beat scene', () => {
  it('songs without lyrics and instrumentals, unless it is switched off', () => {
    expect(showsScene('none', 'orb', false)).toBe(true);
    expect(showsScene('instrumental', 'bars', false)).toBe(true);
    expect(showsScene('none', 'message', false)).toBe(false);
    expect(showsScene('instrumental', 'message', false)).toBe(false);
  });

  it('never with lyrics, while lyrics are still loading, or with Reduce motion', () => {
    expect(showsScene('synced', 'orb', false)).toBe(false);
    expect(showsScene('plain', 'orb', false)).toBe(false);
    expect(showsScene(null, 'orb', false)).toBe(false);
    expect(showsScene('none', 'orb', true)).toBe(false);
  });
});

describe('big beats', () => {
  it('start at 0.7', () => {
    expect(isBigBeat(BIG_BEAT)).toBe(true);
    expect(isBigBeat(0.69)).toBe(false);
    expect(isBigBeat(1)).toBe(true);
  });

  it('punch the scene harder and send the shockwave further than small beats', () => {
    expect(punchShape(40, 1)).toBeGreaterThan(punchShape(40, 0.5) * 1.5);
    const big = rippleShape(500, 1)!;
    const small = rippleShape(500, 0.5)!;
    expect(big.radius).toBeGreaterThan(small.radius);
    expect(big.alpha).toBeGreaterThan(small.alpha);
  });

  it('the punch settles back and a ripple fades out', () => {
    expect(punchShape(40, 1)).toBeGreaterThan(punchShape(600, 1));
    expect(punchShape(2000, 1)).toBeLessThan(0.01);
    expect(punchShape(-5, 1)).toBe(0);
    expect(punchShape(40, 0)).toBe(0);
    expect(rippleShape(0, 1)!.alpha).toBeGreaterThan(rippleShape(RIPPLE_MS - 50, 1)!.alpha);
    expect(rippleShape(RIPPLE_MS, 1)).toBeNull();
    expect(rippleShape(-1, 1)).toBeNull();
  });
});

describe('scene helpers', () => {
  it('resamples a list of levels smoothly, keeping the ends', () => {
    const out = resampleLevels([0, 1], 5);
    expect(Array.from(out)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const same = resampleLevels([0.2, 0.4, 0.9], 3);
    expect(Array.from(same).map((v) => +v.toFixed(3))).toEqual([0.2, 0.4, 0.9]);
    expect(Array.from(resampleLevels([0.3], 1))).toEqual([expect.closeTo(0.3, 5)]);
  });

  it('adds opacity to the album colors, and leaves other colors alone', () => {
    expect(withAlpha('hsl(280 70% 60%)', 0.4)).toBe('hsl(280 70% 60% / 0.400)');
    expect(withAlpha('hsl(280 70% 60%)', 2)).toBe('hsl(280 70% 60% / 1.000)');
    expect(withAlpha('hsl(280 70% 60%)', -1)).toBe('hsl(280 70% 60% / 0.000)');
    expect(withAlpha('#ff00aa', 0.4)).toBe('#ff00aa');
  });

  it('averages part of a list', () => {
    expect(mean([1, 2, 3, 4], 0, 2)).toBe(1.5);
    expect(mean([1, 2, 3, 4], 2, 2)).toBe(0);
  });
});
