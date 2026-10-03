import { describe, expect, it } from 'vitest';
import { localIsPlaying, type LocalSnapshot } from '../localPlayer';

const snap = (over: Partial<LocalSnapshot> = {}): LocalSnapshot => ({ uri: 'spotify:track:abc', playing: true, running: true, at: 10_000, ...over });

describe('localIsPlaying', () => {
  it('is true when the Spotify app on this computer is playing exactly this song, just now', () => {
    expect(localIsPlaying(snap(), 'spotify:track:abc', 10_500)).toBe(true);
  });

  it('is false when it is paused, closed, on another song or has told us nothing', () => {
    expect(localIsPlaying(snap({ playing: false }), 'spotify:track:abc', 10_500)).toBe(false);
    expect(localIsPlaying(snap({ running: false }), 'spotify:track:abc', 10_500)).toBe(false);
    expect(localIsPlaying(snap({ uri: 'spotify:track:other' }), 'spotify:track:abc', 10_500)).toBe(false);
    expect(localIsPlaying(snap({ uri: null }), 'spotify:track:abc', 10_500)).toBe(false);
    expect(localIsPlaying(null, 'spotify:track:abc', 10_500)).toBe(false);
  });

  it('is false when what it told us is too old to rely on', () => {
    expect(localIsPlaying(snap(), 'spotify:track:abc', 13_500)).toBe(false);
    expect(localIsPlaying(snap(), 'spotify:track:abc', 12_900)).toBe(true);
  });
});
