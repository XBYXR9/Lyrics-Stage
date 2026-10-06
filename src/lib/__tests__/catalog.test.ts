import { describe, expect, it } from 'vitest';
import {
  albumTracks,
  idOfUri,
  isSong,
  mapAlbum,
  mapArtist,
  mapPlaylist,
  playlistTracks,
  stripTags,
  uniqueTracks,
} from '../catalog';
import type { ApiAlbum, ApiTrack } from '../spotify';
import type { TrackInfo } from '../types';

const track = (id: string, over: Partial<ApiTrack> = {}): ApiTrack => ({
  id,
  uri: `spotify:track:${id}`,
  name: `Song ${id}`,
  duration_ms: 200000,
  artists: [{ id: 'a1', name: 'Artist' }],
  album: { id: 'al1', name: 'Album', images: [{ url: 'big.jpg', width: 640, height: 640 }, { url: 'small.jpg', width: 64, height: 64 }] },
  ...over,
});

describe('catalog: turning Spotify answers into what the app shows', () => {
  it('maps an album with its year, kind and cover', () => {
    const a: ApiAlbum = { id: 'x', uri: 'spotify:album:x', name: 'LP', album_type: 'single', release_date: '2021-05-03', images: [{ url: 'c.jpg', width: 300, height: 300 }], artists: [{ name: 'A' }, { name: 'B' }] };
    expect(mapAlbum(a)).toEqual({ id: 'x', uri: 'spotify:album:x', name: 'LP', artist: 'A, B', artUrl: 'c.jpg', year: '2021', kind: 'Single' });
  });

  it('maps an artist, and copes with no picture', () => {
    expect(mapArtist({ id: 'z', uri: 'spotify:artist:z', name: 'Zed' })).toEqual({ id: 'z', uri: 'spotify:artist:z', name: 'Zed', artUrl: null });
  });

  it('maps a playlist: the song count (named tracks or items), who made it, and whether it is yours', () => {
    const old = mapPlaylist({ id: 'p', uri: 'spotify:playlist:p', name: 'Mix', owner: { id: 'me', display_name: 'Me' }, tracks: { total: 12 }, images: null }, 'me');
    expect(old).toMatchObject({ trackCount: 12, owner: 'Me', mine: true, artUrl: null });
    const renamed = mapPlaylist({ id: 'q', uri: 'spotify:playlist:q', name: 'New', owner: { id: 'someone' }, items: { total: 3 } }, 'me');
    expect(renamed).toMatchObject({ trackCount: 3, owner: 'someone', mine: false });
    expect(mapPlaylist({ id: 'r', uri: 'u', name: 'N' }, null).trackCount).toBeNull();
  });

  it('keeps only real songs from a playlist page (not null rows, episodes or local files), whatever Spotify calls the song', () => {
    const page = {
      items: [
        { item: track('1') },
        { track: track('2') }, // the older name
        null,
        { item: null },
        { item: track('3', { is_local: true }) },
        { item: { ...track('4'), artists: undefined as never } }, // an episode has no artists
      ],
      total: 6,
      offset: 0,
      limit: 50,
      next: null,
    };
    expect(playlistTracks(page).map((t) => t.key)).toEqual(['1', '2']);
    expect(playlistTracks(null)).toEqual([]);
    expect(isSong(null)).toBe(false);
  });

  it('puts the album back on the songs of an album, so they have a cover and a link to it', () => {
    const album: ApiAlbum = { id: 'al9', uri: 'spotify:album:al9', name: 'Nine', images: [{ url: 'nine.jpg', width: 640, height: 640 }], artists: [{ name: 'A' }] };
    const simple = { ...track('7'), album: undefined as never };
    const [t] = albumTracks([simple], album);
    expect(t).toMatchObject({ album: 'Nine', artUrl: 'nine.jpg', albumId: 'al9', artistIds: ['a1'] });
  });

  it('remembers each song of the album and artists for the links', () => {
    const t = playlistTracks({ items: [{ item: track('1') }], total: 1, offset: 0, limit: 50, next: null })[0];
    expect(t.albumId).toBe('al1');
    expect(t.artistIds).toEqual(['a1']);
    expect(t.artUrl).toBe('big.jpg');
    expect(t.artThumbUrl).toBe('small.jpg');
  });

  it('shows a song played twice once', () => {
    const t = (key: string) => ({ key }) as TrackInfo;
    expect(uniqueTracks([t('a'), t('b'), t('a'), t('c'), t('b')]).map((x) => x.key)).toEqual(['a', 'b', 'c']);
  });

  it('cleans playlist descriptions', () => {
    expect(stripTags('Chill &amp; <a href="x">calm</a> &quot;vibes&quot; &#x27;now&#x27;')).toBe('Chill & calm "vibes" \'now\'');
    expect(idOfUri('spotify:playlist:37i9dQ')).toBe('37i9dQ');
  });
});
