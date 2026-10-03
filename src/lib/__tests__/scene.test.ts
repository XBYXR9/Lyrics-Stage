import { describe, expect, it } from 'vitest';
import {
  BIG_BEAT,
  edgeFade,
  isBigBeat,
  mean,
  mixHsl,
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

  it('blends two album colors smoothly, the hue taking the short way round', () => {
    const a = 'hsl(50 60% 60%)';
    const b = 'hsl(110 40% 50%)';
    expect(mixHsl(a, b, 0)).toBe('hsl(50 60% 60%)');
    expect(mixHsl(a, b, 1)).toBe('hsl(110 40% 50%)');
    expect(mixHsl(a, b, 0.5)).toBe('hsl(80 50% 55%)');
    expect(mixHsl(a, b, 0.5, 0.4)).toBe('hsl(80 50% 55% / 0.400)');
    // 350 to 10 goes through 0, not back through 180
    expect(mixHsl('hsl(350 50% 50%)', 'hsl(10 50% 50%)', 0.5)).toBe('hsl(0 50% 50%)');
    // t is kept within 0..1
    expect(mixHsl(a, b, 3)).toBe('hsl(110 40% 50%)');
  });

  it('has no hard seam: nearby spokes get nearly the same color all the way round', () => {
    const a = 'hsl(50 60% 60%)';
    const b = 'hsl(110 40% 50%)';
    const hue = (angle: number) => Number(/hsl\(([\d.]+)/.exec(mixHsl(a, b, (1 + Math.cos(angle)) / 2))![1]);
    for (let k = 0; k < 48; k++) {
      const one = hue((k / 48) * Math.PI * 2);
      const next = hue(((k + 1) / 48) * Math.PI * 2);
      expect(Math.abs(one - next)).toBeLessThan(4); // the whole 60° range is spread over many steps
    }
  });

  it('uses the nearer color as it is when a color cannot be blended', () => {
    expect(mixHsl('#ff0000', 'hsl(110 40% 50%)', 0.2)).toBe('#ff0000');
    expect(mixHsl('#ff0000', '#00ff00', 0.8)).toBe('#00ff00');
  });

  it('fades rings and glows out before the picture\'s edge, so nothing is sliced off in a straight line', () => {
    expect(edgeFade(100, 500)).toBe(1); // well inside
    expect(edgeFade(500, 500)).toBe(0); // at the edge: gone
    expect(edgeFade(900, 500)).toBe(0); // past it
    const near = edgeFade(400, 500);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(1);
    expect(edgeFade(300, 500)).toBeGreaterThan(edgeFade(450, 500)); // the closer to the edge, the fainter
    expect(edgeFade(10, 0)).toBe(0); // no room at all
  });
});
