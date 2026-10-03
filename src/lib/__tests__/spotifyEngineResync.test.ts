import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopSnapshot, LyricsStageDesktopApi } from '../desktopTypes';
import { clearTimingLog, timingReport } from '../timingLog';

// Spotify's servers, pretended: what the player reports, and the pause and play commands.
const server = vi.hoisted(() => ({
  state: null as unknown,
  pause: vi.fn(async () => {}),
  play: vi.fn(async () => {}),
}));
vi.mock('../spotify', async (importOriginal) => {
  const real = await importOriginal<typeof import('../spotify')>();
  return {
    ...real,
    spotify: {
      getPlayer: async () => server.state,
      getQueue: async () => null,
      pause: (...a: unknown[]) => server.pause(...(a as [])),
      play: (...a: unknown[]) => server.play(...(a as [])),
    },
  };
});

import { SpotifyEngine } from '../engine';

const apiTrack = (name: string) => ({
  id: name,
  uri: `spotify:track:${name}`,
  name,
  duration_ms: 200_000,
  artists: [{ name: 'Artist' }],
  album: { name: 'Album', images: [] },
});

/** The player, with the bug: after a blend its position runs `ahead` too far, until the music is paused and resumed. */
class Player {
  playing = true;
  pos = 0;
  ahead = 0;
  track = 'A';
  private last = performance.now();
  private advance() {
    const t = performance.now();
    if (this.playing) this.pos += t - this.last;
    this.last = t;
  }
  start(track: string, pos: number, ahead: number) {
    this.advance();
    this.track = track;
    this.pos = pos;
    this.ahead = ahead;
    this.playing = true;
  }
  truth() {
    this.advance();
    return this.pos;
  }
  async pause(latency: number) {
    await new Promise((r) => setTimeout(r, latency));
    this.advance();
    this.playing = false;
    this.ahead = 0;
  }
  async resume(latency: number) {
    await new Promise((r) => setTimeout(r, latency));
    this.advance();
    this.playing = true;
  }
  /** What Spotify's servers answer. */
  report() {
    this.advance();
    return {
      device: { id: 'pc', name: 'My PC', type: 'Computer', is_active: true, volume_percent: 50 },
      is_playing: this.playing,
      progress_ms: Math.round(this.pos + this.ahead),
      timestamp: Date.now(),
      currently_playing_type: 'track',
      item: apiTrack(this.track),
    };
  }
}

describe('re-syncing through the Web API engine', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    vi.stubGlobal('document', { hidden: false });
    clearTimingLog();
    server.pause.mockClear();
    server.play.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** The Spotify app on this computer: reports what it plays, and takes pause and play commands quickly. */
  function localApp(p: Player, o: { plays: () => boolean }) {
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
        if (c.type === 'pause') await p.pause(20);
        if (c.type === 'play') await p.resume(20);
        return { ok: true };
      },
    } as unknown as LyricsStageDesktopApi;
    const tell = () =>
      emit({
        source: 'smtc',
        running: true,
        playing: o.plays(),
        track: { uri: `spotify:track:${p.track}`, title: p.track, artist: 'Artist', album: 'Album', durationMs: 200_000, artUrl: null },
        positionMs: Math.round(p.truth()),
        at: Date.now(),
        canSeek: true,
      } as DesktopSnapshot);
    return { api, sent, tell };
  }

  async function blendAndWait(localPlays: boolean) {
    const p = new Player();
    server.state = null;
    server.pause.mockImplementation(async () => p.pause(150));
    server.play.mockImplementation(async () => p.resume(150));
    const local = localApp(p, { plays: () => localPlays && p.playing });
    const engine = new SpotifyEngine({ browserPlayer: false, local: local.api });
    const step = async (ms: number) => {
      for (let t = 0; t < ms; t += 50) {
        await vi.advanceTimersByTimeAsync(50);
        server.state = p.report();
        if (t % 250 === 0) local.tell();
      }
    };
    p.start('A', 190_000, 0);
    server.state = p.report();
    engine.start();
    await step(4000);
    p.start('B', 0, 6000); // Spotify mixes into B, and reports its position 6 s ahead
    await step(14_000);
    const result = { engine, p, local };
    engine.stop();
    return result;
  }

  it('pauses the Spotify app on this computer itself when it is the one playing (a much shorter gap)', async () => {
    const { engine, p, local } = await blendAndWait(true);
    expect(engine.getState().change.transition.kind).toBe('blend');
    expect(local.sent).toEqual(['pause', 'play']);
    expect(server.pause).not.toHaveBeenCalled();
    expect(p.playing).toBe(true);
    expect(timingReport([])).toMatch(/through the Spotify app on this computer/);
    expect(timingReport([])).toMatch(/RE-SYNC measured error=\+[56]\.\d/);
  });

  it('uses Spotify’s servers when the music plays somewhere else, such as a phone', async () => {
    const { p, local } = await blendAndWait(false);
    expect(local.sent).toEqual([]);
    expect(server.pause).toHaveBeenCalledTimes(1);
    expect(server.play).toHaveBeenCalledTimes(1);
    expect(p.playing).toBe(true);
    expect(timingReport([])).toMatch(/through Spotify’s servers/);
  });
});
