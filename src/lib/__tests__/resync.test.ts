import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopEngine } from '../desktopEngine';
import type { DesktopSnapshot, LyricsStageDesktopApi } from '../desktopTypes';
import { BaseEngine } from '../engine';
import { clearTimingLog, timingReport } from '../timingLog';
import type { TrackInfo } from '../types';

const song = (name: string, durationMs = 200_000): TrackInfo => ({
  key: name,
  id: name,
  uri: `spotify:track:${name}`,
  name,
  artists: ['Artist'],
  album: 'Album',
  artUrl: null,
  artThumbUrl: null,
  durationMs,
});

/**
 * A pretend Spotify with the bug: after a blend the reported position of the new song is ahead of the audio by
 * `ahead`, until the music is paused and resumed (which refreshes it).
 */
class World {
  playing = true;
  ahead = 0;
  pos = 0;
  private last = performance.now();
  pauses = 0;
  resumes = 0;
  firstPauseAt: number | null = null;
  failPause: { status: number } | null = null;
  failResumeOnce = false;
  /** Does a pause and resume refresh the position? */
  refreshes = true;
  constructor(public latencyMs = 120) {}
  private advance() {
    const t = performance.now();
    if (this.playing) this.pos += t - this.last;
    this.last = t;
  }
  truth() {
    this.advance();
    return this.pos;
  }
  reported() {
    return this.truth() + this.ahead;
  }
  start(pos: number, ahead: number) {
    this.advance();
    this.pos = pos;
    this.ahead = ahead;
    this.playing = true;
  }
  async pause() {
    this.pauses++;
    this.firstPauseAt ??= performance.now();
    await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.failPause) throw Object.assign(new Error('Spotify says no'), this.failPause);
    this.advance();
    this.playing = false;
    if (this.refreshes) this.ahead = 0;
  }
  async resume() {
    this.resumes++;
    await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.failResumeOnce) {
      this.failResumeOnce = false;
      throw new Error('hiccup');
    }
    this.advance();
    this.playing = true;
  }
}

class TestEngine extends BaseEngine {
  readonly kind = 'web-api' as const;
  resyncAllowed = true;
  constructor(readonly world: World) {
    super();
  }
  protected canResync() {
    return this.resyncAllowed;
  }
  protected async sendPause() {
    await this.world.pause();
  }
  protected async sendResume() {
    await this.world.resume();
  }
  feed(track: TrackInfo, reportedMs: number, playing: boolean) {
    this.observe(track, reportedMs, playing, performance.now());
  }
  learn(b: number, first: number, old: number) {
    this.biasLearner.record({ b, first, old });
  }
  get bias() {
    return this.biasLearner;
  }
}

describe('re-syncing after a blend', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    clearTimingLog();
  });
  afterEach(() => vi.useRealTimers());

  /** Time passes in small steps; Spotify reports every 250 ms. */
  async function run(engine: TestEngine, track: TrackInfo, ms: number) {
    for (let t = 0; t < ms; t += 50) {
      await vi.advanceTimersByTimeAsync(50);
      if (t % 250 === 0) engine.feed(track, engine.world.reported(), engine.world.playing);
    }
  }

  /**
   * `from` plays to 6 s (or `leftMs`) before its end and Spotify mixes into `to`, which starts `startAt` into the
   * song, with its position reported `ahead` too far.
   */
  async function blend(engine: TestEngine, from: TrackInfo, to: TrackInfo, o: { ahead: number; startAt?: number; leftMs?: number }) {
    const w = engine.world;
    const left = o.leftMs ?? 6000;
    w.start(from.durationMs - left - 4000, 0);
    engine.feed(from, w.reported(), true);
    await run(engine, from, 4000);
    w.start(o.startAt ?? 0, o.ahead);
    await run(engine, to, 250);
    return w;
  }

  it('pauses and resumes the music a few seconds after a blend, measures the error and puts the lyrics in time', async () => {
    const w = new World();
    const engine = new TestEngine(w);
    const B = song('B');
    await blend(engine, song('A'), B, { ahead: 6000 });
    expect(engine.getState().change.transition.kind).toBe('blend');
    expect(w.pauses).toBe(0); // not right away: the blend is still going on
    await run(engine, B, 5000);
    expect(w.pauses).toBe(0);
    await run(engine, B, 3000);
    expect(w.pauses).toBe(1);
    expect(w.resumes).toBe(1);
    expect(w.playing).toBe(true);
    await run(engine, B, 1500); // it looks at the position once Spotify has settled, about 2 s after the music resumed
    // the error it found is the error the pretend Spotify had
    const report = timingReport([]);
    expect(report).toMatch(/RE-SYNC measured error=\+[56]\.\d/);
    expect(engine.bias.count).toBe(1);
    // and from then on the lyrics follow the audio
    await run(engine, B, 5000);
    expect(Math.abs(engine.clock.now() - w.truth())).toBeLessThan(400);
  });

  it('keeps the lyrics in time through the pause, whatever the error was', async () => {
    for (const ahead of [2500, 6000, 9500]) {
      const w = new World();
      const engine = new TestEngine(w);
      const B = song('B');
      await blend(engine, song('A'), B, { ahead });
      await run(engine, B, 12_000);
      expect(w.pauses).toBe(1);
      expect(Math.abs(engine.clock.now() - w.truth())).toBeLessThan(400);
    }
  });

  it('learns how to guess the error, and then stops pausing the music', async () => {
    // Automix cut the old song short: much of it was left when it was replaced, so only the first report tells the error.
    const w = new World();
    const engine = new TestEngine(w);
    for (const [i, name] of ['B', 'C', 'D'].entries()) {
      const prev = i === 0 ? song('A') : song(['B', 'C', 'D'][i - 1]);
      await blend(engine, prev, song(name), { ahead: 6000, leftMs: 30_000 });
      await run(engine, song(name), 12_000);
    }
    expect(w.pauses).toBe(3);
    expect(engine.bias.trustedRule()).toBe('first-report');

    // the fourth blend: nothing is paused, and the lyrics are still in time from the very start
    await blend(engine, song('D'), song('E'), { ahead: 6000, leftMs: 30_000 });
    await run(engine, song('E'), 12_000);
    expect(w.pauses).toBe(3);
    expect(Math.abs(engine.clock.now() - w.truth())).toBeLessThan(400);
    expect(timingReport([])).toMatch(/re-sync skipped: the error is guessed well enough/);
  });

  it('checks a trusted guess again every few blends, and notices when it stops fitting', async () => {
    const w = new World();
    const engine = new TestEngine(w);
    for (let i = 0; i < 3; i++) engine.learn(6000, 6100, 6100);
    expect(engine.bias.trustedRule()).toBe('first-report');
    // three blends use the guess without measuring...
    let prev = song('A');
    for (const name of ['B', 'C', 'D']) {
      await blend(engine, prev, song(name), { ahead: 6000 });
      await run(engine, song(name), 9000);
      prev = song(name);
    }
    expect(w.pauses).toBe(0);
    // ...the fourth is measured, and this time the error was something else
    await blend(engine, prev, song('E'), { ahead: 3000, startAt: 8000 }); // starts 8 s in: the first report says 11 s
    await run(engine, song('E'), 9000);
    expect(w.pauses).toBe(1);
    expect(engine.bias.trustedRule()).toBeNull();
  });

  it('does nothing when it is switched off, or the engine cannot do it', async () => {
    const off = new World();
    const e1 = new TestEngine(off);
    e1.setResyncAfterBlend(false);
    await blend(e1, song('A'), song('B'), { ahead: 6000 });
    await run(e1, song('B'), 12_000);
    expect(off.pauses).toBe(0);

    const cannot = new World();
    const e2 = new TestEngine(cannot);
    e2.resyncAllowed = false;
    await blend(e2, song('A'), song('B'), { ahead: 6000 });
    await run(e2, song('B'), 12_000);
    expect(cannot.pauses).toBe(0);
  });

  it('leaves skips and normal song endings alone', async () => {
    const w = new World();
    const engine = new TestEngine(w);
    w.start(30_000, 0);
    engine.feed(song('A'), w.reported(), true);
    await run(engine, song('A'), 1000);
    w.start(0, 0);
    await run(engine, song('B'), 12_000); // pressed next: B starts at 0
    expect(engine.getState().change.transition.kind).toBe('skip');
    expect(w.pauses).toBe(0);
  });

  it('gives up when the song changes before it happens, or someone else pauses', async () => {
    const w = new World();
    const engine = new TestEngine(w);
    await blend(engine, song('A'), song('B'), { ahead: 6000 });
    await run(engine, song('B'), 2000);
    w.start(300, 0);
    await run(engine, song('C'), 12_000); // skipped to another song: no blend, nothing to re-sync
    expect(w.pauses).toBe(0);

    const w2 = new World();
    const e2 = new TestEngine(w2);
    await blend(e2, song('A'), song('B'), { ahead: 6000 });
    await run(e2, song('B'), 1000);
    w2.playing = false; // the person pauses it themselves
    await run(e2, song('B'), 12_000);
    expect(w2.pauses).toBe(0);
  });

  it('never leaves the music paused: a failed resume is tried again', async () => {
    const w = new World();
    w.failResumeOnce = true;
    const engine = new TestEngine(w);
    await blend(engine, song('A'), song('B'), { ahead: 6000 });
    await run(engine, song('B'), 12_000);
    expect(w.pauses).toBe(1);
    expect(w.resumes).toBe(2);
    expect(w.playing).toBe(true);
  });

  it('stops trying when Spotify refuses (no Premium)', async () => {
    const w = new World();
    w.failPause = { status: 403 };
    const engine = new TestEngine(w);
    await blend(engine, song('A'), song('B'), { ahead: 6000 });
    await run(engine, song('B'), 12_000);
    expect(w.pauses).toBe(1);
    expect(w.playing).toBe(true);
    expect(timingReport([])).toMatch(/will not try again/);
    await blend(engine, song('B'), song('C'), { ahead: 6000 });
    await run(engine, song('C'), 12_000);
    expect(w.pauses).toBe(1);
  });

  it('does not mistake a stale answer from Spotify right after the resume for the refreshed position', async () => {
    const w = new World();
    const engine = new TestEngine(w);
    const B = song('B');
    await blend(engine, song('A'), B, { ahead: 6000 });
    // For 1.8 s after the pause, Spotify's server still answers with its old, ahead position, as if nothing happened.
    let staleBase: { pos: number; at: number } | null = null;
    for (let t = 0; t < 14_000; t += 50) {
      await vi.advanceTimersByTimeAsync(50);
      if (t % 250 !== 0) continue;
      const staleNow = w.firstPauseAt !== null && performance.now() < w.firstPauseAt + 1800;
      if (staleNow) staleBase ??= { pos: w.reported(), at: performance.now() };
      engine.feed(B, staleNow && staleBase ? staleBase.pos + (performance.now() - staleBase.at) : w.reported(), staleNow || w.playing);
    }
    expect(w.pauses).toBe(1);
    expect(timingReport([])).toMatch(/RE-SYNC measured error=\+[56]\.\d/);
  });

  it('measures no error when the pause does not refresh anything, and does not learn nonsense from a wild number', async () => {
    const w = new World();
    w.refreshes = false;
    const engine = new TestEngine(w);
    await blend(engine, song('A'), song('B'), { ahead: 6000 });
    await run(engine, song('B'), 12_000);
    expect(engine.bias.count).toBe(1);
    expect(timingReport([])).toMatch(/RE-SYNC measured error=[+-]0\.\d/);
  });

  it('works through the Spotify app on this computer too, and not where the app gives no position (Linux)', async () => {
    for (const exact of [true, false]) {
      const w = new World(30);
      const sent: string[] = [];
      let emit: (s: DesktopSnapshot) => void = () => {};
      const api = {
        isDesktop: true,
        platform: 'win32',
        version: 'test',
        onSnapshot: (cb: (s: DesktopSnapshot) => void) => {
          emit = cb;
          return () => {};
        },
        command: async (c: { type: string }) => {
          sent.push(c.type);
          if (c.type === 'pause') await w.pause();
          if (c.type === 'play') await w.resume();
          return { ok: true };
        },
        openSpotify: async () => {},
      } as unknown as LyricsStageDesktopApi;
      const engine = new DesktopEngine(api);
      engine.start();
      const snap = (t: TrackInfo): DesktopSnapshot => ({
        source: 'smtc',
        running: true,
        playing: w.playing,
        track: { uri: t.uri, title: t.name, artist: 'Artist', album: 'Album', durationMs: t.durationMs, artUrl: null },
        positionMs: exact ? Math.round(w.reported()) : null,
        at: Date.now(),
        canSeek: true,
      });
      const play = async (t: TrackInfo, ms: number) => {
        for (let i = 0; i < ms; i += 50) {
          await vi.advanceTimersByTimeAsync(50);
          if (i % 250 === 0) emit(snap(t));
        }
      };
      const A = song('A');
      const B = song('B');
      w.start(190_000, 0);
      emit(snap(A));
      await play(A, 4000);
      w.start(0, 6000);
      await play(B, 12_000);
      expect(sent).toEqual(exact ? ['pause', 'play'] : []);
      if (exact) expect(Math.abs(engine.clock.now() - w.truth())).toBeLessThan(400);
      engine.stop();
    }
  });
});
