import { describe, expect, it } from 'vitest';
import { RECORD_ASPECT, recordFrame } from '../record';

describe('recordFrame', () => {
  it('fits a tall frame inside a wide screen, using the full height', () => {
    expect(recordFrame(1920, 1080)).toEqual({ width: 608, height: 1080 });
    expect(recordFrame(2560, 1440)).toEqual({ width: 810, height: 1440 });
  });

  it('is the whole screen when the screen is already 9:16', () => {
    expect(recordFrame(1080, 1920)).toEqual({ width: 1080, height: 1920 });
    expect(recordFrame(360, 640)).toEqual({ width: 360, height: 640 });
  });

  it('fits inside a phone that is taller than 9:16, using the full width', () => {
    // a 20:9 phone: black bars above and below the frame
    expect(recordFrame(360, 800)).toEqual({ width: 360, height: 640 });
    expect(recordFrame(412, 915)).toEqual({ width: 412, height: 732 });
  });

  it('is always about 9:16 and never bigger than the window', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1366, 768],
      [800, 600],
      [600, 800],
      [390, 844],
      [1000, 1000],
      [3840, 2160],
    ]) {
      const f = recordFrame(w, h);
      expect(f.width).toBeLessThanOrEqual(w);
      expect(f.height).toBeLessThanOrEqual(h);
      expect(Math.abs(f.width / f.height - RECORD_ASPECT)).toBeLessThan(0.002);
    }
  });

  it('never returns a frame of zero size', () => {
    expect(recordFrame(0, 0)).toEqual({ width: 1, height: 1 });
    const f = recordFrame(5, 3);
    expect(f.width).toBeGreaterThan(0);
    expect(f.height).toBeGreaterThan(0);
  });
});
