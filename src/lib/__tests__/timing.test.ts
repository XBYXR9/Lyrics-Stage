import { beforeEach, describe, expect, it } from 'vitest';
import { describeNudge, MAX_NUDGE_MS, nudgeBy } from '../nudge';
import { clearTimingLog, isWatchingTiming, logTiming, sec, signedSec, timingReport, watchTiming } from '../timingLog';

describe('timing nudge for one song', () => {
  it('moves by the step, in either direction', () => {
    expect(nudgeBy(0, 500)).toBe(500);
    expect(nudgeBy(500, -1500)).toBe(-1000);
    expect(nudgeBy(0, 100)).toBe(100);
  });

  it('never goes past 30 seconds', () => {
    expect(nudgeBy(MAX_NUDGE_MS, 500)).toBe(MAX_NUDGE_MS);
    expect(nudgeBy(-MAX_NUDGE_MS, -500)).toBe(-MAX_NUDGE_MS);
  });

  it('says it in words', () => {
    expect(describeNudge(-2500)).toBe('This song: lyrics 2.5s later');
    expect(describeNudge(500)).toBe('This song: lyrics 0.5s earlier');
    expect(describeNudge(0)).toMatch(/back to normal/);
  });
});

describe('timing log', () => {
  beforeEach(() => clearTimingLog());

  it('writes numbers the way a person reads them', () => {
    expect(sec(12345)).toBe('12.3');
    expect(sec(null)).toBe('?');
    expect(signedSec(400)).toBe('+0.4');
    expect(signedSec(-5900)).toBe('-5.9');
  });

  it('keeps lines and puts them under a header in the report', () => {
    logTiming('first');
    logTiming('second');
    const report = timingReport(['version: 1.2.3']);
    expect(report.startsWith('Lyrics Stage timing report\nversion: 1.2.3')).toBe(true);
    expect(report).toMatch(/\] first\n\[.*\] second$/);
  });

  it('says so when nothing was logged yet', () => {
    expect(timingReport([])).toMatch(/nothing logged yet/);
  });

  it('keeps only the latest lines', () => {
    for (let i = 0; i < 500; i++) logTiming(`line ${i}`);
    const report = timingReport([]);
    expect(report).toContain('line 499');
    expect(report).not.toContain('line 99\n');
    expect(report.split('\n').length).toBeLessThan(410);
  });

  it('watches for a while after being asked to', () => {
    expect(isWatchingTiming()).toBe(false);
    watchTiming(60_000);
    expect(isWatchingTiming()).toBe(true);
    clearTimingLog();
    expect(isWatchingTiming()).toBe(false);
  });
});
