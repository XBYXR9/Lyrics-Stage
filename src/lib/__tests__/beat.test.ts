import { describe, expect, it } from 'vitest';
import { bassBins, detectBeat, newBeatState } from '../audioLevels';
import { BIG_BEAT, beatPlan, canFlash, emitBeat, FAST_FLASH_GAP_MS, FLASH_MS, flashShape, inSongWindow, isBigBeat, MIN_FLASH_GAP_MS, MIN_PAUSE_MS, onBeat, shortPauseAt } from '../beat';
import { buildSynced } from '../lrc';
import { DEFAULT_SETTINGS } from '../settings';
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

  /**
   * Feeds `secs` seconds (60 frames a second) of made-up bass into the detector and returns the strength of every
   * beat it heard. `bass(t, bin)` is the level (0..1) of each of the 5 bass bins at time t (seconds).
   */
  const listen = (bass: (t: number, bin: number) => number, secs = 12) => {
    const state = newBeatState();
    const strengths: number[] = [];
    for (let f = 0; f < secs * 60; f++) {
      const t = f / 60;
      const s = detectBeat([0, 1, 2, 3, 4].map((bin) => Math.min(1, Math.max(0, bass(t, bin)))), state, t * 1000);
      if (s > 0) strengths.push(s);
    }
    return strengths;
  };
  /** A kick (or bass note) of this height that starts every `period` seconds and fades with time constant `tau`. */
  const hit = (t: number, period: number, height: number, tau = 0.08) => height * Math.exp(-(t % period) / tau);

  it('hears kick drums in the music but not steady loud bass', () => {
    const kicks = listen((t) => 0.25 + hit(t, 0.5, 0.65), 6);
    expect(kicks.length).toBeGreaterThanOrEqual(10); // 12 kicks in 6 s, the first only teaches the starting level
    expect(listen(() => 0.9, 6)).toHaveLength(0);
  });

  it('hears a kick every 120 ms, one beat per kick', () => {
    // 41 kicks in 5 s (16th notes at 125 BPM): the old fixed 250 ms gap dropped about half of them
    const heard = listen((t) => 0.1 + hit(t, 0.12, 0.8, 0.03), 5).length;
    expect(heard).toBeGreaterThanOrEqual(38);
    expect(heard).toBeLessThanOrEqual(42);
  });

  it('hears every kind of bass beat, soft or hard, not only the big ones', () => {
    const kicks = (period: number, secs = 12) => Math.floor(secs / period);
    const all = (base: number, height: number, period: number, tau = 0.08) => listen((t) => base + hit(t, period, height, tau)).length;
    expect(all(0.1, 0.85, 0.5)).toBeGreaterThanOrEqual(kicks(0.5) - 2); // hard kicks
    expect(all(0.1, 0.3, 0.5)).toBeGreaterThanOrEqual(kicks(0.5) - 2); // soft kicks
    expect(all(0.05, 0.9, 1, 0.4)).toBeGreaterThanOrEqual(kicks(1) - 2); // 808s with a long tail
    expect(all(0.1, 0.8, 0.29, 0.06)).toBeGreaterThanOrEqual(30); // fast kicks, 3 to 4 a second
    // a pure low note that only shows in two of the bins
    expect(listen((t, bin) => (bin === 1 || bin === 2 ? 0.1 + hit(t, 0.5, 0.7) : 0.05)).length).toBeGreaterThanOrEqual(kicks(0.5) - 2);
  });

  it('hears kicks over loud, steady bass: a held bass note in one bin does not hide them', () => {
    // bin 1 holds a loud steady bass note; the kicks rise in the bins around it
    const heard = listen((t, bin) => (bin === 1 ? 0.8 : 0.25 + hit(t, 0.5, 0.55))).length;
    expect(heard).toBeGreaterThanOrEqual(10);
    // and when every bin is loud and steady with only small kicks on top
    expect(listen((t) => 0.6 + hit(t, 0.5, 0.35)).length).toBeGreaterThanOrEqual(10);
  });

  it('does not take steady or slowly swelling bass for beats', () => {
    expect(listen(() => 0.6)).toHaveLength(0);
    expect(listen((t) => 0.5 + 0.2 * Math.sin(t * 1.2))).toHaveLength(0); // a slow swell, once every 5 seconds
    // a fast wobble is rhythmic bass: about one beat per pulse
    const wobble = listen((t) => 0.5 + 0.2 * Math.sin(t * 8)).length;
    expect(wobble).toBeGreaterThanOrEqual(10);
    expect(wobble).toBeLessThanOrEqual(17);
  });

  it('rates beats against the hardest recent one, so a steady groove still has big beats', () => {
    const strengths = listen((t) => 0.15 + hit(t, 0.5, 0.75), 6);
    expect(strengths.length).toBeGreaterThanOrEqual(10);
    expect(strengths.filter((s) => s >= 0.7).length).toBeGreaterThanOrEqual(strengths.length - 1);
    // a clearly softer kick between hard ones is a weaker beat
    const mixed = listen((t) => 0.15 + hit(t, 1, 0.75) + (t % 1 >= 0.5 ? hit(t - 0.5, 1, 0.12) : 0), 8);
    expect(Math.min(...mixed)).toBeLessThan(Math.max(...mixed));
  });

  it('listens to the bass range only', () => {
    // 48 kHz with 1024 bins: 23.4 Hz per bin, so bins 1 to 5 (23 to 117 Hz)
    expect(bassBins(new Uint8Array(1024), 48000)).toHaveLength(5);
    const spectrum = new Uint8Array(1024);
    spectrum[2] = 255;
    spectrum[40] = 255; // a treble bin: ignored
    const bins = Array.from(bassBins(spectrum, 48000));
    expect(bins[1]).toBe(1);
    expect(Math.max(...bins.filter((_, i) => i !== 1))).toBe(0);
  });
});

describe('fast beats', () => {
  /**
   * The beats heard in a pattern, after the bass has been smeared the way the analyser smears it (an FFT window of about
   * 43 ms, then smoothing of 0.55 per read), read 60 times a second.
   */
  const heard = (pattern: (t: number) => number, secs = 10) => {
    const state = newBeatState();
    let smooth = [0, 0, 0, 0, 0];
    let n = 0;
    for (let f = 0; f < secs * 60; f++) {
      const t = f / 60;
      let level = 0;
      for (let k = 0; k < 5; k++) level += pattern(t - k * 0.0086) / 5;
      smooth = smooth.map((v) => 0.55 * v + 0.45 * Math.min(1, Math.max(0, level)));
      if (detectBeat(smooth, state, t * 1000) > 0) n++;
    }
    return n;
  };
  const kick = (t: number, period: number, height: number, tau: number, rise = 0.002) => {
    const x = ((t % period) + period) % period;
    return 0.1 + height * (1 - Math.exp(-x / rise)) * Math.exp(-x / tau);
  };

  it('follows fast drum patterns beat by beat (a fixed 250 ms gap heard only 44 to 71% of them)', () => {
    // [period (s), tau (s)]: 8ths at 140 and 170 BPM, 16ths at 100 and 120 BPM, trap 808s, a double kick
    for (const [period, tau] of [[0.214, 0.07], [0.176, 0.06], [0.15, 0.05], [0.125, 0.05], [0.2, 0.2], [0.18, 0.06]]) {
      const expected = Math.floor(10 / period) - 1;
      const n = heard((t) => kick(t, period, 0.65, tau));
      expect(n, `period ${period}`).toBeGreaterThanOrEqual(Math.floor(expected * 0.9));
      expect(n, `period ${period}`).toBeLessThanOrEqual(Math.ceil(expected * 1.1));
    }
  });

  it('still counts one long kick or 808 once, however slowly it rises', () => {
    // [period, tau, rise]: the longer a note takes to rise, the longer it looks "new"; a plain shorter gap counted these twice
    for (const [period, tau, rise] of [[1, 0.4, 0.03], [1, 0.4, 0.08], [0.5, 0.15, 0.05], [0.7, 0.3, 0.12], [0.6, 0.5, 0.2]]) {
      const expected = Math.floor(12 / period);
      const n = heard((t) => kick(t, period, 0.7, tau, rise), 12);
      expect(n, `period ${period}, tau ${tau}, rise ${rise}`).toBeLessThanOrEqual(expected + 1);
      expect(n, `period ${period}, tau ${tau}, rise ${rise}`).toBeGreaterThanOrEqual(expected - 2);
    }
  });

  it('counts a kick that is louder than the one before it, even before the last one has faded', () => {
    // every other kick is much harder, so the bass climbs past the previous top before the beat is noticed
    const n = heard((t) => 0.1 + (Math.floor(t / 0.25) % 2 === 0 ? 0.3 : 0.8) * Math.exp(-(t % 0.25) / 0.07));
    expect(n).toBeGreaterThanOrEqual(36); // 39 kicks
  });
});

describe('flash', () => {
  it('flashes at most three times a second', () => {
    expect(MIN_FLASH_GAP_MS).toBeGreaterThanOrEqual(1000 / 3);
    expect(canFlash(1000, 800)).toBe(false);
    expect(canFlash(1000, 600)).toBe(true);
    expect(canFlash(0, -Infinity)).toBe(true);
  });

  it('may follow fast beats, about seven a second, only when asked to', () => {
    expect(FAST_FLASH_GAP_MS).toBeLessThan(MIN_FLASH_GAP_MS);
    expect(1000 / FAST_FLASH_GAP_MS).toBeGreaterThan(6);
    expect(canFlash(1000, 800)).toBe(false); // 200 ms: too soon for the normal limit...
    expect(canFlash(1000, 800, true)).toBe(true); // ...but fine when following fast beats
    expect(canFlash(1000, 900, true)).toBe(false); // still not faster than that
    expect(DEFAULT_SETTINGS.fastFlashes).toBe(false); // off unless somebody switches it on
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
  const base = { style: 'glow', reduceMotion: false, lyricsKind: 'synced', sceneShown: false, whileSinging: true } as const;

  it('flashes in the short pauses of a song with synced lyrics, and lets every bass beat glow anywhere', () => {
    expect(beatPlan(base)).toEqual({ detect: true, flashIn: 'pauses', anywhere: true });
    expect(beatPlan({ ...base, whileSinging: false })).toEqual({ detect: true, flashIn: 'pauses', anywhere: false });
  });

  it('lets bass beats glow even without synced lyrics (plain text, or still loading)', () => {
    expect(beatPlan({ ...base, lyricsKind: 'plain' })).toEqual({ detect: true, flashIn: 'never', anywhere: true });
    expect(beatPlan({ ...base, lyricsKind: null })).toEqual({ detect: true, flashIn: 'never', anywhere: true });
    expect(beatPlan({ ...base, lyricsKind: 'plain', whileSinging: false })).toEqual({ detect: false, flashIn: 'never', anywhere: false });
  });

  it('flashes on every strong beat when the no-lyrics scene is showing, and still feeds the scene when the flash is off', () => {
    expect(beatPlan({ ...base, lyricsKind: 'none', sceneShown: true })).toEqual({ detect: true, flashIn: 'always', anywhere: false });
    expect(beatPlan({ ...base, style: 'off', lyricsKind: 'instrumental', sceneShown: true })).toEqual({
      detect: true,
      flashIn: 'never',
      anywhere: false,
    });
  });

  it('does nothing with the flash off or with Reduce motion', () => {
    const none = { detect: false, flashIn: 'never', anywhere: false };
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
