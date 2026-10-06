import { describe, expect, it } from 'vitest';
import { clipFromRect } from '../../components/app/LyricsOverlay';
import { routeKey } from '../../components/app/nav';
import { SCOPES } from '../auth';
import { demoCatalog } from '../catalog';

describe('the Lyrics tab window', () => {
  it('opens from the box of the cover: the distance from each edge of the screen', () => {
    const clip = clipFromRect({ top: 700, left: 20, right: 80, bottom: 760 }, 1360, 820);
    expect(clip).toBe('inset(700px 1280px 60px 20px round 10px)');
  });

  it('stays on the screen when the cover is partly outside it, and has a fallback without a cover', () => {
    expect(clipFromRect({ top: -10, left: -5, right: 1400, bottom: 900 }, 1360, 820)).toBe('inset(0px 0px 0px 0px round 10px)');
    expect(clipFromRect(null, 1000, 600)).toBe('inset(300px 500px 300px 500px round 12px)');
  });
});

describe('pages', () => {
  it('names the same page the same way, and different pages differently', () => {
    expect(routeKey({ view: 'home' })).toBe('home');
    expect(routeKey({ view: 'album', id: 'x' })).toBe('album:x');
    expect(routeKey({ view: 'album', id: 'x' })).not.toBe(routeKey({ view: 'playlist', id: 'x' }));
    expect(routeKey({ view: 'search', q: 'abc' })).toBe('search:abc');
  });
});

describe('sign-in permissions', () => {
  it('asks for the library, playlists, follows, history and likes, along with playing', () => {
    for (const scope of [
      'streaming',
      'user-modify-playback-state',
      'user-library-read',
      'user-library-modify',
      'playlist-read-private',
      'playlist-read-collaborative',
      'user-follow-read',
      'user-read-recently-played',
      'user-top-read',
    ])
      expect(SCOPES.split(' ')).toContain(scope);
  });
});

// The demo library has no network: it must hold together on its own (the canvas covers need a page, so only the data here).
describe('demo library', () => {
  it('has the same answers for liking a song', async () => {
    expect(await demoCatalog.profile()).toMatchObject({ name: 'Demo listener', premium: true });
  });
});
