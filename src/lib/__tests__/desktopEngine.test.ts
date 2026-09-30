import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopEngine } from '../desktopEngine';
import type { DesktopCommand, DesktopSnapshot, LyricsStageDesktopApi } from '../desktopTypes';

function fakeApi() {
  const sent: DesktopCommand[] = [];
  let listener: ((s: DesktopSnapshot) => void) | null = null;
  const api: LyricsStageDesktopApi = {
    isDesktop: true,
    platform: 'linux',
    version: 'test',
    onSnapshot: (cb) => {
      listener = cb;
      return () => (listener = null);
    },
    command: async (c) => {
      sent.push(c);
      return { ok: true };
    },
    openSpotify: vi.fn(async () => {}),
    setAlwaysOnTop: async () => {},
  };
  return { api, sent, emit: (s: DesktopSnapshot) => listener?.(s) };
}

const track = (title: string, durationMs = 200_000) => ({
  uri: `spotify:track:${title.replace(/\W/g, '')}123456`,
  title,
  artist: 'Artist',
  album: 'Album',
  durationMs,
  artUrl: null,
});

describe('DesktopEngine', () => {
  let now = 0;
  beforeEach(() => {
    now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(Date, 'now').mockImplementation(() => 1_000_000 + now);
  });
  afterEach(() => vi.restoreAllMocks());

  const snap = (over: Partial<DesktopSnapshot>): DesktopSnapshot => ({
    source: 'applescript',
    running: true,
    playing: true,
    track: track('Song A'),
    positionMs: 0,
    at: Date.now(),
    canSeek: true,
    ...over,
  });

  it('follows the Spotify app and detects an Automix blend', () => {
    const { api, emit } = fakeApi();
    const engine = new DesktopEngine(api);
    engine.start();
    emit(snap({ positionMs: 190_000 }));
    expect(engine.getState().track?.name).toBe('Song A');
    expect(engine.getState().change.transition.kind).toBe('initial');
    // 4 s later Spotify switches, with ~6 s of Song A still left and Song B starting 8 s in (Automix intro skip).
    now += 4000;
    emit(snap({ positionMs: 194_000 }));
    now += 250;
    emit(snap({ track: track('Song B'), positionMs: 8_000 }));
    const { change } = engine.getState();
    expect(change.track?.name).toBe('Song B');
    expect(change.transition.kind).toBe('blend');
    expect(engine.getState().spotifyApp).toEqual({ running: true, problem: undefined, exactPosition: true });
    engine.stop();
  });

  it('counts time itself when the Spotify app gives no position (Linux)', () => {
    const { api, emit } = fakeApi();
    const engine = new DesktopEngine(api);
    engine.start();
    emit(snap({ source: 'mpris', positionMs: null }));
    now += 3000;
    emit(snap({ source: 'mpris', positionMs: null }));
    expect(engine.clock.now()).toBe(3000);
    expect(engine.getState().spotifyApp?.exactPosition).toBe(false);
    // Paused in Spotify → our clock stops too.
    emit(snap({ source: 'mpris', positionMs: null, playing: false }));
    now += 5000;
    expect(engine.clock.now()).toBe(3000);
  });

  it('keeps the last song paused when Spotify closes', () => {
    const { api, emit } = fakeApi();
    const engine = new DesktopEngine(api);
    engine.start();
    emit(snap({ positionMs: 1000 }));
    emit(snap({ running: false, track: null, positionMs: null }));
    expect(engine.getState().track?.name).toBe('Song A');
    expect(engine.getState().status).toBe('paused');
    expect(engine.getState().spotifyApp?.running).toBe(false);
  });

  it('sends controls to the Spotify app and opens Spotify search', async () => {
    const { api, sent, emit } = fakeApi();
    const engine = new DesktopEngine(api);
    engine.start();
    emit(snap({ positionMs: 1000 }));
    await engine.togglePlay();
    await engine.next();
    await engine.seek(42_000);
    expect(sent).toEqual([{ type: 'playpause' }, { type: 'next' }, { type: 'seek', positionMs: 42_000 }]);
    expect(engine.clock.now()).toBe(42_000);
    await engine.search('yellow');
    expect(api.openSpotify).toHaveBeenCalledWith('yellow');
    await expect(engine.addToQueue()).rejects.toThrow(/Spotify app/);
  });

  it('turns failed commands into errors', async () => {
    const { api } = fakeApi();
    api.command = async () => ({ ok: false, error: 'Nope' });
    const engine = new DesktopEngine(api);
    await expect(engine.next()).rejects.toThrow('Nope');
  });
});
