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

  it('shows a cover that arrives a moment after the song change (Windows)', () => {
    const { api, emit } = fakeApi();
    const engine = new DesktopEngine(api, async () => null);
    engine.start();
    emit(snap({ positionMs: 1000 }));
    expect(engine.getState().track?.artUrl).toBeNull();
    emit(snap({ positionMs: 1250, track: { ...track('Song A'), artUrl: 'data:image/jpeg;base64,AAA' } }));
    expect(engine.getState().track?.artUrl).toBe('data:image/jpeg;base64,AAA');
    expect(engine.getState().track?.name).toBe('Song A');
    expect(engine.getState().change.seq).toBe(1); // still the same song, no transition
  });

  it('updates the song length when it arrives after the title (Windows)', () => {
    const { api, emit } = fakeApi();
    const engine = new DesktopEngine(api, async () => null);
    engine.start();
    emit(snap({ positionMs: 0, track: track('Song A', 0) }));
    expect(engine.getState().track?.durationMs).toBe(0);
    emit(snap({ positionMs: 250, track: track('Song A', 185_000) }));
    expect(engine.getState().track?.durationMs).toBe(185_000);
    expect(engine.getState().change.seq).toBe(1);
  });

  it('looks up a cover when the player gives none, once per song', async () => {
    const { api, emit } = fakeApi();
    const finder = vi.fn(async () => 'https://covers.example/a.jpg');
    const engine = new DesktopEngine(api, finder);
    engine.start();
    emit(snap({ positionMs: 1000 }));
    emit(snap({ positionMs: 1250 }));
    await vi.waitFor(() => expect(engine.getState().track?.artUrl).toBe('https://covers.example/a.jpg'));
    emit(snap({ positionMs: 1500 }));
    expect(finder).toHaveBeenCalledTimes(1);
    expect(finder).toHaveBeenCalledWith({ name: 'Song A', artists: ['Artist'], album: 'Album' });
    // The player's own cover still wins if it shows up later.
    emit(snap({ positionMs: 1750, track: { ...track('Song A'), artUrl: 'data:image/png;base64,BBB' } }));
    expect(engine.getState().track?.artUrl).toBe('data:image/png;base64,BBB');
  });

  it("looks up a cover when the player's picture doesn't load", async () => {
    const { api, emit } = fakeApi();
    const finder = vi.fn(async () => 'https://covers.example/a.jpg');
    const engine = new DesktopEngine(api, finder);
    engine.start();
    const broken = 'data:image/jpeg;base64,BROKEN';
    emit(snap({ positionMs: 1000, track: { ...track('Song A'), artUrl: broken } }));
    expect(finder).not.toHaveBeenCalled();
    engine.coverFailed(broken);
    await vi.waitFor(() => expect(engine.getState().track?.artUrl).toBe('https://covers.example/a.jpg'));
    // The player keeps sending the broken picture: it stays replaced.
    emit(snap({ positionMs: 1250, track: { ...track('Song A'), artUrl: broken } }));
    expect(engine.getState().track?.artUrl).toBe('https://covers.example/a.jpg');
    expect(finder).toHaveBeenCalledTimes(1);
  });

  it('changes the volume and shows the level Spotify reports', async () => {
    const { api, emit, sent } = fakeApi();
    api.command = async (c) => {
      sent.push(c);
      return { ok: true, volume: 40 };
    };
    const engine = new DesktopEngine(api, async () => null);
    engine.start();
    emit(snap({ volume: 50 }));
    expect(engine.getState().volume).toBe(50);
    await engine.changeVolume(-10);
    expect(sent).toContainEqual({ type: 'volume', delta: -10 });
    expect(engine.getState().volume).toBe(40);
    // A late snapshot with the old level doesn't undo the change.
    emit(snap({ volume: 50, positionMs: 250 }));
    expect(engine.getState().volume).toBe(40);
  });

  it('turns failed commands into errors', async () => {
    const { api } = fakeApi();
    api.command = async () => ({ ok: false, error: 'Nope' });
    const engine = new DesktopEngine(api);
    await expect(engine.next()).rejects.toThrow('Nope');
  });
});
