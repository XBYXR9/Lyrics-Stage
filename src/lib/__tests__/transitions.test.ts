import { describe, expect, it } from 'vitest';
import { BlendLearner, classifyTransition, coverMergeBlocker, MAX_BLEND_MS, planCoverMerge, visualTransitionMs } from '../transitions';

const base = { prevDurationMs: 200_000, sinceLastReportMs: 500, wasPlaying: true };

describe('classifyTransition', () => {
  it('detects a normal song ending', () => {
    // Old song ran out; new song is 300ms in.
    const t = classifyTransition({ ...base, prevPositionMs: 200_300, newPositionMs: 300 });
    expect(t.kind).toBe('natural');
  });

  it('detects a manual skip in the middle of a song', () => {
    const t = classifyTransition({ ...base, prevPositionMs: 80_000, newPositionMs: 400 });
    expect(t.kind).toBe('skip');
  });

  it('detects a crossfade: next song started while the old one had ~6s left', () => {
    const t = classifyTransition({ ...base, prevPositionMs: 194_200, newPositionMs: 200 });
    expect(t.kind).toBe('blend');
    expect(t.overlapMs).toBeGreaterThan(5500);
    expect(t.overlapMs).toBeLessThan(6500);
    expect(t.startOffsetMs).toBe(0);
  });

  it('detects Automix skipping the intro of the next song', () => {
    const t = classifyTransition({ ...base, prevPositionMs: 196_000, newPositionMs: 9_000 });
    expect(t.kind).toBe('blend');
    expect(t.startOffsetMs).toBeGreaterThan(8000);
  });

  it('treats an intro-skipping switch as a blend even with lots of time left', () => {
    const t = classifyTransition({ ...base, prevPositionMs: 150_000, newPositionMs: 12_000 });
    expect(t.kind).toBe('blend');
  });

  it('caps very long overlaps', () => {
    const t = classifyTransition({ ...base, prevPositionMs: 186_500, newPositionMs: 300 });
    expect(t.kind).toBe('blend');
    expect(t.overlapMs).toBeLessThanOrEqual(MAX_BLEND_MS);
  });

  it('still sees Automix starting the next song 8 to 21 s in (what a real setup showed)', () => {
    for (const start of [8_700, 15_800, 20_800]) {
      const t = classifyTransition({ ...base, sinceLastReportMs: 1100, prevPositionMs: 192_700, newPositionMs: start });
      expect(t.kind).toBe('blend');
    }
  });

  it('takes a new song that shows up minutes in for somebody seeking, not for an Automix start', () => {
    for (const start of [75_000, 165_500, 331_700]) {
      const t = classifyTransition({ ...base, sinceLastReportMs: 1100, prevPositionMs: 35_800, newPositionMs: start });
      expect(t.kind).toBe('skip');
      expect(t.overlapMs).toBe(0);
    }
  });

  it('is always a plain skip when music was paused', () => {
    const t = classifyTransition({ ...base, prevPositionMs: 198_000, newPositionMs: 0, wasPlaying: false });
    expect(t.kind).toBe('skip');
  });
});

describe('BlendLearner', () => {
  it('learns the typical blend length and widens the watch window', () => {
    const learner = new BlendLearner();
    expect(learner.typicalOverlapMs).toBeNull();
    learner.record({ kind: 'blend', overlapMs: 8000, startOffsetMs: 0 });
    learner.record({ kind: 'skip', overlapMs: 0, startOffsetMs: 0 });
    learner.record({ kind: 'blend', overlapMs: 10000, startOffsetMs: 0 });
    expect(learner.count).toBe(2);
    expect(learner.typicalOverlapMs).toBe(8600);
    expect(learner.watchWindowMs()).toBe(14600);
  });
});

describe('visualTransitionMs', () => {
  it('matches the audio overlap for blends and is short for skips', () => {
    expect(visualTransitionMs({ kind: 'blend', overlapMs: 5000, startOffsetMs: 0 })).toBe(5000);
    expect(visualTransitionMs({ kind: 'skip', overlapMs: 0, startOffsetMs: 0 })).toBeLessThan(600);
    expect(visualTransitionMs({ kind: 'blend', overlapMs: 5000, startOffsetMs: 0 }, true)).toBe(250);
  });
});

describe('cover merge for Automix blends', () => {
  const change = (kind: 'blend' | 'skip' | 'natural', overlapMs = 5000, over: Record<string, unknown> = {}) => ({
    seq: 7,
    track: { key: 'new', artUrl: 'new.jpg' },
    previous: { artUrl: 'old.jpg' },
    transition: { kind, overlapMs, startOffsetMs: 0 },
    ...over,
  });
  const on = { automixBlend: true, reduceMotion: false };

  it('plans a merge as long as the songs overlap', () => {
    expect(planCoverMerge(change('blend', 5000), on)).toEqual({ from: 'old.jpg', ms: 5000, seq: 7, key: 'new' });
    expect(planCoverMerge(change('blend', 20000), on)!.ms).toBe(8000); // very long overlaps are capped
  });

  it('only for blends, with both covers, when blending is on and motion isn’t reduced', () => {
    expect(planCoverMerge(change('skip'), on)).toBeNull();
    expect(planCoverMerge(change('natural'), on)).toBeNull();
    expect(planCoverMerge(change('blend'), { ...on, automixBlend: false })).toBeNull();
    expect(planCoverMerge(change('blend'), { ...on, reduceMotion: true })).toBeNull();
    expect(planCoverMerge(change('blend', 5000, { previous: { artUrl: null } }), on)).toBeNull();
    expect(planCoverMerge(change('blend', 5000, { previous: null }), on)).toBeNull();
    expect(planCoverMerge(change('blend', 5000, { track: { key: 'new', artUrl: null } }), on)).toBeNull();
  });

  it('says what is in the way, so it can be shown instead of the animation just seeming broken', () => {
    expect(coverMergeBlocker(change('blend'), on)).toBeNull();
    expect(coverMergeBlocker(change('skip'), on)).toBe('not-a-blend');
    expect(coverMergeBlocker(change('blend'), { ...on, automixBlend: false })).toBe('blend-off');
    expect(coverMergeBlocker(change('blend'), { ...on, reduceMotion: true })).toBe('reduce-motion');
    expect(coverMergeBlocker(change('blend', 5000, { previous: null }), on)).toBe('no-cover');
    // Reduce motion also makes the song change itself quick (this is what "rushed" looked like).
    expect(visualTransitionMs({ kind: 'blend', overlapMs: 9000, startOffsetMs: 0 }, true)).toBe(250);
    expect(visualTransitionMs({ kind: 'blend', overlapMs: 9000, startOffsetMs: 0 }, false)).toBe(8000);
  });
});
