import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricsStageDesktopApi } from '../desktopTypes';

// Spotify's servers, pretended: nothing is playing anywhere, and these devices exist.
const server = vi.hoisted(() => ({
  devices: [] as { id: string | null; name: string; type: string; is_active: boolean; volume_percent: number | null }[],
  play: vi.fn(async (_body: unknown, deviceId?: string) => {
    if (!deviceId) {
      const { SpotifyError } = await import('../spotify');
      throw new SpotifyError(404, 'No active device', 'NO_ACTIVE_DEVICE');
    }
  }),
}));
vi.mock('../spotify', async (importOriginal) => {
  const real = await importOriginal<typeof import('../spotify')>();
  return {
    ...real,
    spotify: {
      getPlayer: async () => null,
      getQueue: async () => null,
      getDevices: async () => ({ devices: server.devices }),
      play: (body: unknown, deviceId?: string) => server.play(body, deviceId),
    },
  };
});

import { SpotifyEngine } from '../engine';

const device = (id: string, name: string, type: string) => ({ id, name, type, is_active: false, volume_percent: 50 });

const desktop = (hostname: string, openSpotify: () => Promise<void> = async () => {}) =>
  ({ hostname: async () => hostname, openSpotify: vi.fn(openSpotify), onSnapshot: () => () => {}, command: async () => ({ ok: true }) }) as unknown as LyricsStageDesktopApi;

describe('pressing play with nothing playing', () => {
  beforeEach(() => {
    server.devices = [];
    server.play.mockClear();
  });

  it('plays on this computer, not on a speaker or another computer', async () => {
    server.devices = [device('echo', 'Yahias Echo Pop', 'Speaker'), device('other', 'LAPTOP-OTHER', 'Computer'), device('mine', 'My-PC', 'Computer')];
    const engine = new SpotifyEngine({ browserPlayer: false, local: desktop('my-pc.local') });
    await engine.playUris(['spotify:track:1', 'spotify:track:2'], 1);
    const last = server.play.mock.calls.at(-1)!;
    expect(last[1]).toBe('mine');
    expect(last[0]).toEqual({ uris: ['spotify:track:2'] });
  });

  it('uses the only computer when the names do not match', async () => {
    server.devices = [device('echo', 'Echo', 'Speaker'), device('c1', 'Spotify on PC', 'Computer')];
    const engine = new SpotifyEngine({ browserPlayer: false, local: desktop('something-else') });
    await engine.playContext('spotify:playlist:p1');
    expect(server.play.mock.calls.at(-1)![1]).toBe('c1');
  });

  it('opens Spotify on this computer and waits for it to show up', async () => {
    vi.useFakeTimers();
    try {
      const api = desktop('my-pc', async () => {
        server.devices = [device('mine', 'my-pc', 'Computer')];
      });
      server.devices = [device('echo', 'Echo', 'Speaker')];
      const engine = new SpotifyEngine({ browserPlayer: false, local: api });
      const playing = engine.playContext('spotify:album:a1');
      await vi.advanceTimersByTimeAsync(2500);
      await playing;
      expect(api.openSpotify).toHaveBeenCalled();
      expect(server.play.mock.calls.at(-1)![1]).toBe('mine');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never starts a speaker by itself: it says Spotify is not open here', async () => {
    vi.useFakeTimers();
    try {
      server.devices = [device('echo', 'Echo', 'Speaker')];
      const engine = new SpotifyEngine({ browserPlayer: false, local: desktop('my-pc') });
      const playing = engine.playContext('spotify:album:a1');
      const failed = expect(playing).rejects.toThrow(/isn’t open on this computer/);
      await vi.advanceTimersByTimeAsync(15000);
      await failed;
      expect(server.play.mock.calls.every((c) => c[1] === undefined)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
