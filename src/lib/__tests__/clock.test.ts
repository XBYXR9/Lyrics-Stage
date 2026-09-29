import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybackClock } from '../clock';

describe('PlaybackClock', () => {
  let now = 0;
  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  it('counts forward while playing and stops when paused', () => {
    const c = new PlaybackClock();
    c.set(5000, true, now, 60_000);
    now += 1500;
    expect(c.now()).toBe(6500);
    c.set(c.now(), false);
    now += 5000;
    expect(c.now()).toBe(6500);
  });

  it('accounts for time since the position was measured', () => {
    const c = new PlaybackClock();
    const measuredAt = now;
    now += 200; // response arrived 200ms later
    c.set(10_000, true, measuredAt, 60_000);
    expect(c.now()).toBe(10_200);
  });

  it('smooths small drifts instead of jumping', () => {
    const c = new PlaybackClock();
    c.set(0, true, now, 60_000);
    now += 1000;
    c.sync(1300, true, now); // report says we're 300ms behind
    expect(c.now()).toBe(1000); // no jump right away
    now += 500;
    const mid = c.now();
    expect(mid).toBeGreaterThan(1500);
    expect(mid).toBeLessThan(1800);
    now += 1000;
    expect(c.now()).toBe(2800); // fully caught up
  });

  it('jumps on big differences (seeks)', () => {
    const c = new PlaybackClock();
    c.set(0, true, now, 60_000);
    now += 1000;
    c.sync(30_000, true, now);
    expect(c.now()).toBe(30_000);
  });

  it('never goes past the end of the song, but raw() does', () => {
    const c = new PlaybackClock();
    c.set(59_000, true, now, 60_000);
    now += 3000;
    expect(c.now()).toBe(60_000);
    expect(c.raw()).toBe(62_000);
  });

  it('forks a ghost clock that keeps running for blends', () => {
    const c = new PlaybackClock();
    c.set(50_000, true, now, 60_000);
    const ghost = c.fork(true);
    const frozen = c.fork(false);
    c.set(0, true, now, 90_000); // new song
    now += 2000;
    expect(ghost.now()).toBe(52_000);
    expect(frozen.now()).toBe(50_000);
    expect(c.now()).toBe(2000);
  });
});
