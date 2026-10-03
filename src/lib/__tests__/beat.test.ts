import { describe, expect, it } from 'vitest';
import { detectBeat, newBeatState } from '../audioLevels';
import { BIG_BEAT, beatPlan, canFlash, emitBeat, FLASH_MS, flashShape, inSongWindow, isBigBeat, MIN_FLASH_GAP_MS, MIN_PAUSE_MS, onBeat, shortPauseAt } from '../beat';
import { buildSynced } from '../lrc';
import { estimatedBeat, estimatedBpm } from '../pulse';

// Line A is sung 10.0–12.0 s, line B starts at 12.6 s (a 0.6 s pause), line C at 13.1 s (0.5 s after B ends),
// then a 9 s gap (a long break, which gets its own bars), and line D.
const word = (text: string, start: number, end: number) => ({ text, start, end });
const lyrics = buildSynced(
  [
    { start: 10_000, text: 'a a', words: [word('a ', 10_000, 11_000), word('a', 11_000, 12_000)] },
    { start: 12_600, text: 'b b', words: [word('b ', 12_600, 12_900), word('b', 12_900, 12_600 + 500)] },
    { start: 13_100, text: 'c c', words: [word('c ', 13_100, 13_500), word('c', 13_500, 13_700)] },
    { start: 23_000, text: 'd d', words: [word('d ', 23_000, 23_400), word('d', 23_400, 24_000)] },
  ],
  'test',
);

describe('short pauses between lines', () => {
  it('is true only in a gap of at least 250 ms between two sung lines', () => {
    expect(shortPauseAt(lyrics.lines, 12_300)).toBe(true); // between A and B
    expect(shortPauseAt(lyrics.lines, 12_000)).toBe(true); // right as A ends
    expect(shortPauseAt(lyrics.lines, 11_000)).toBe(false); // singing
    expect(shortPauseAt(lyrics.lines, 12_700)).toBe(false); // singing B
    expect(shortPauseAt(lyrics.lines, 5_000)).toBe(false); // before the first line
  });

  it('is false in a long break (the bars are shown there) and after the last line', () => {
    expect(shortPauseAt(lyrics.lines, 18_000)).toBe(false);
    expect(shortPauseAt(lyrics.lines, 30_000)).toBe(false);
  });

  it('ignores gaps shorter than a split second', () => {
    expect(MIN_PAUSE_MS).toBe(250);
    const tight = buildSynced(
      [
        { start: 1000, text: 'x', words: [word('x', 1000, 2000)] },
        { start: 2100, text: 'y', words: [word('y', 2100, 3000)] },
      ],
      'test',
    );
    expect(shortPauseAt(tight.lines, 2050)).toBe(false);
  });
});

describe('strong beats', () => {
  it('estimated beats are the first and third beat of each bar, scaled by strength', () => {
    const beatMs = 60000 / estimatedBpm(0.5);
    const strengths = Array.from({ length: 8 }, (_, k) => estimatedBeat(beatMs * (k + 4) - 8, beatMs * (k + 4) + 8, 0.5));
    // beats 4..11: indexes 4 and 8 are downbeats (bar starts), 6 and 10 are the third beat
    expect(strengths).toEqual([1, 0, 0.65, 0, 1, 0, 0.65, 0]);
  });

  it('a jump in position (a seek) is not a beat, and neither is no time passing', () => {
    expect(estimatedBeat(1000, 9000, 0.5)).toBe(0);
    expect(estimatedBeat(5000, 5000, 0.5)).toBe(0);
    expect(estimatedBeat(5000, 4000, 0.5)).toBe(0);
  });

  it('hears kick drums in the music but not steady loud bass', () => {
    const state = newBeatState();
    let hits = 0;
    // 4 seconds at 60 frames a second: quiet bass with a kick every 500 ms
    for (let f = 0; f < 240; f++) {
      const t = f * 16.7;
      const kick = f % 30 < 3;
      if (detectBeat(kick ? 0.95 : 0.25, state, t) > 0) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(6); // the very first kick is used to learn the level
    expect(hits).toBeLessThanOrEqual(8);

    const steady = newBeatState();
    let steadyHits = 0;
    for (let f = 0; f < 300; f++) if (detectBeat(0.9, steady, f * 16.7) > 0) steadyHits++;
    expect(steadyHits).toBe(0);
  });

  it('never counts two beats within 250 ms, and a harder hit is stronger', () => {
    const state = { avg: 0.2, lastAt: -Infinity, peak: 0 };
    expect(detectBeat(0.9, state, 1000)).toBe(1); // the hardest kick so far
    expect(detectBeat(0.1, state, 1050)).toBe(0);
    expect(detectBeat(0.95, state, 1100)).toBe(0); // too soon after the last beat
    const soft = detectBeat(0.5, state, 2000);
    expect(soft).toBeGreaterThan(0);
    expect(soft).toBeLessThan(0.7); // a soft hit is not a big beat
    expect(detectBeat(0.92, state, 3000)).toBeGreaterThanOrEqual(0.7); // back to a hard kick
  });

  it('rates kicks against the loudest recent ones, so a steady groove still has big beats', () => {
    const state = newBeatState();
    const strengths: number[] = [];
    // 6 seconds at 60 frames a second: bass at 0.15 with a hard kick every 500 ms
    for (let f = 0; f < 360; f++) {
      const kick = f % 30 < 3;
      const s = detectBeat(kick ? 0.9 : 0.15, state, f * 16.7);
      if (s > 0) strengths.push(s);
    }
    expect(strengths.length).toBeGreaterThanOrEqual(10);
    expect(strengths.filter((s) => s >= 0.7).length).toBeGreaterThanOrEqual(strengths.length - 1);
  });
});

describe('flash', () => {
  it('flashes at most three times a second', () => {
    expect(MIN_FLASH_GAP_MS).toBeGreaterThanOrEqual(1000 / 3);
    expect(canFlash(1000, 800)).toBe(false);
    expect(canFlash(1000, 600)).toBe(true);
    expect(canFlash(0, -Infinity)).toBe(true);
  });

  it('peaks at once, fades out, and a harder beat is brighter', () => {
    const start = flashShape(25, 1);
    const later = flashShape(250, 1);
    expect(start.glow).toBeGreaterThan(later.glow);
    expect(start.glow).toBeLessThanOrEqual(0.4); // a soft tinted glow, never a full-screen white flash
    expect(flashShape(250, 1).ringScale).toBeGreaterThan(flashShape(50, 1).ringScale);
    expect(flashShape(80, 0.5).glow).toBeLessThan(flashShape(80, 1).glow);
    const gone = flashShape(FLASH_MS, 1);
    expect(gone.glow).toBe(0);
    expect(gone.ring).toBe(0);
    expect(flashShape(-5, 1).glow).toBe(0);
  });
});

describe('the song window', () => {
  it('is open only while the song is playing and the position is inside it', () => {
    expect(inSongWindow({ playing: true, positionMs: 30_000, durationMs: 200_000 })).toBe(true);
    expect(inSongWindow({ playing: true, positionMs: 0, durationMs: 200_000 })).toBe(true);
    expect(inSongWindow({ playing: false, positionMs: 30_000, durationMs: 200_000 })).toBe(false); // paused
    expect(inSongWindow({ playing: true, positionMs: 200_000, durationMs: 200_000 })).toBe(false); // the song ended
    expect(inSongWindow({ playing: true, positionMs: 250_000, durationMs: 200_000 })).toBe(false);
    expect(inSongWindow({ playing: true, positionMs: -1, durationMs: 200_000 })).toBe(false);
    expect(inSongWindow({ playing: true, positionMs: NaN, durationMs: 200_000 })).toBe(false);
  });

  it('does not close for a song whose length is not known yet', () => {
    expect(inSongWindow({ playing: true, positionMs: 30_000, durationMs: 0 })).toBe(true);
    expect(inSongWindow({ playing: false, positionMs: 30_000, durationMs: 0 })).toBe(false);
  });
});

describe('what the beat code does', () => {
  const base = { style: 'glow', reduceMotion: false, lyricsKind: 'synced', sceneShown: false, bigBeats: true } as const;

  it('flashes in the short pauses of a song with synced lyrics, and lets big beats glow anywhere', () => {
    expect(beatPlan(base)).toEqual({ detect: true, flashIn: 'pauses', bigAnywhere: true });
    expect(beatPlan({ ...base, bigBeats: false })).toEqual({ detect: true, flashIn: 'pauses', bigAnywhere: false });
  });

  it('lets big beats glow even without synced lyrics (plain text, or still loading)', () => {
    expect(beatPlan({ ...base, lyricsKind: 'plain' })).toEqual({ detect: true, flashIn: 'never', bigAnywhere: true });
    expect(beatPlan({ ...base, lyricsKind: null })).toEqual({ detect: true, flashIn: 'never', bigAnywhere: true });
    expect(beatPlan({ ...base, lyricsKind: 'plain', bigBeats: false })).toEqual({ detect: false, flashIn: 'never', bigAnywhere: false });
  });

  it('flashes on every strong beat when the no-lyrics scene is showing, and still feeds the scene when the flash is off', () => {
    expect(beatPlan({ ...base, lyricsKind: 'none', sceneShown: true })).toEqual({ detect: true, flashIn: 'always', bigAnywhere: false });
    expect(beatPlan({ ...base, style: 'off', lyricsKind: 'instrumental', sceneShown: true })).toEqual({
      detect: true,
      flashIn: 'never',
      bigAnywhere: false,
    });
  });

  it('does nothing with the flash off or with Reduce motion', () => {
    const none = { detect: false, flashIn: 'never', bigAnywhere: false };
    expect(beatPlan({ ...base, style: 'off' })).toEqual(none);
    expect(beatPlan({ ...base, reduceMotion: true })).toEqual(none);
    expect(beatPlan({ ...base, lyricsKind: 'none', sceneShown: true, reduceMotion: true })).toEqual(none);
  });

  it('calls a beat big from 0.7 up', () => {
    expect(BIG_BEAT).toBe(0.7);
    expect(isBigBeat(0.69)).toBe(false);
    expect(isBigBeat(0.7)).toBe(true);
    expect(isBigBeat(1)).toBe(true);
  });
});

describe('the beat bus', () => {
  it('tells everyone who listens, until they stop', () => {
    const heard: number[] = [];
    const stop = onBeat((s) => heard.push(s));
    emitBeat(0.5);
    emitBeat(1);
    stop();
    emitBeat(0.2);
    expect(heard).toEqual([0.5, 1]);
  });
});
