// What the Spotify-style app shows: your home page, library, search and the pages of playlists, albums and artists.
//
// `spotifyCatalog` reads it all from Spotify's Web API. `demoCatalog` is a small made-up library for the demo mode, so
// every screen can be tried without an account. Both answer the same questions (the `Catalog` interface).
//
// Spotify's rules for apps in development mode shape this file: a search returns at most 10 results (so the search page
// has a "more" button), the songs of a playlist can only be read when you own or share it, and artists have no "popular
// songs" list anymore (we search for the artist's songs instead).
import { DEMO_PLAYLISTS, demoSongs } from './demo';
import { SpotifyError, spotify, pickImages, toTrackInfo, type ApiAlbum, type ApiArtist, type ApiPaging, type ApiPlaylist, type ApiTrack } from './spotify';
import type { TrackInfo } from './types';

export interface Profile {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** True for Premium; null when Spotify doesn't say. */
  premium: boolean | null;
}

export interface AlbumSummary {
  id: string;
  uri: string;
  name: string;
  artist: string;
  artUrl: string | null;
  year: string;
  /** "Album", "Single", ... */
  kind: string;
}

export interface ArtistSummary {
  id: string;
  uri: string;
  name: string;
  artUrl: string | null;
}

export interface PlaylistSummary {
  id: string;
  uri: string;
  name: string;
  owner: string;
  artUrl: string | null;
  trackCount: number | null;
  /** You made it or share it (so its songs can be shown). */
  mine: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  /** The offset to ask for the next page with, or null at the end. */
  nextOffset: number | null;
}

export interface SearchResults {
  tracks: TrackInfo[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
  playlists: PlaylistSummary[];
  /** The offset for "show more", or null when every kind came back short. */
  nextOffset: number | null;
}

export interface PlaylistDetail {
  playlist: PlaylistSummary;
  description: string;
  tracks: TrackInfo[];
  /** Spotify only lets an app read the songs of playlists you made or share. */
  restricted: boolean;
}

export interface AlbumDetail {
  album: AlbumSummary;
  tracks: TrackInfo[];
}

export interface ArtistDetail {
  artist: ArtistSummary;
  genres: string[];
  popular: TrackInfo[];
  albums: AlbumSummary[];
}

export interface HomeData {
  recent: TrackInfo[];
  playlists: PlaylistSummary[];
  topArtists: ArtistSummary[];
  topTracks: TrackInfo[];
}

export interface Catalog {
  readonly isDemo: boolean;
  profile(): Promise<Profile>;
  home(): Promise<HomeData>;
  playlists(offset?: number): Promise<Page<PlaylistSummary>>;
  likedTracks(offset?: number): Promise<Page<TrackInfo>>;
  savedAlbums(offset?: number): Promise<Page<AlbumSummary>>;
  followedArtists(): Promise<ArtistSummary[]>;
  search(query: string, offset?: number): Promise<SearchResults>;
  playlist(id: string): Promise<PlaylistDetail>;
  album(id: string): Promise<AlbumDetail>;
  artist(id: string): Promise<ArtistDetail>;
  /** Which of these songs are in "Liked songs" (same order). */
  likedState(uris: string[]): Promise<boolean[]>;
  setLiked(uri: string, liked: boolean): Promise<void>;
}

// ---- Turning Spotify's answers into our shapes (pure, so they can be tested) -------------------------------------

const present = <T>(list: (T | null | undefined)[] | undefined): T[] => (list ?? []).filter((x): x is T => !!x);

export const idOfUri = (uri: string) => uri.split(':').pop() ?? uri;

export function mapAlbum(a: ApiAlbum): AlbumSummary {
  const kind = a.album_type ? a.album_type[0].toUpperCase() + a.album_type.slice(1) : 'Album';
  return {
    id: a.id,
    uri: a.uri,
    name: a.name,
    artist: a.artists.map((x) => x.name).join(', '),
    artUrl: pickImages(a.images).large,
    year: a.release_date?.slice(0, 4) ?? '',
    kind,
  };
}

export function mapArtist(a: ApiArtist): ArtistSummary {
  return { id: a.id, uri: a.uri, name: a.name, artUrl: pickImages(a.images).large };
}

export function mapPlaylist(p: ApiPlaylist, myId: string | null): PlaylistSummary {
  return {
    id: p.id,
    uri: p.uri,
    name: p.name,
    owner: p.owner?.display_name ?? p.owner?.id ?? '',
    artUrl: pickImages(p.images ?? undefined).large,
    trackCount: p.items?.total ?? p.tracks?.total ?? null,
    mine: !!myId && p.owner?.id === myId,
  };
}

/** A real song (not a podcast episode, an ad slot or a local file we can't play from here). */
export const isSong = (t: ApiTrack | null | undefined): t is ApiTrack => !!t && Array.isArray(t.artists) && !!t.uri && !t.is_local;

/** The same song twice in a row of "recently played" is shown once. */
export function uniqueTracks(tracks: TrackInfo[]): TrackInfo[] {
  const seen = new Set<string>();
  return tracks.filter((t) => (seen.has(t.key) ? false : (seen.add(t.key), true)));
}

/** Songs of a playlist page: Spotify names the song `item` now, and `track` before. */
export function playlistTracks(page: ApiPaging<{ item?: ApiTrack | null; track?: ApiTrack | null }> | null): TrackInfo[] {
  return present(page?.items).map((row) => row.item ?? row.track).filter(isSong).map(toTrackInfo);
}

/** The songs of an album come without the album's own name and cover: put them back. */
export function albumTracks(tracks: ApiTrack[], album: ApiAlbum): TrackInfo[] {
  return tracks.filter(isSong).map((t) => toTrackInfo({ ...t, album: { id: album.id, name: album.name, images: album.images } }));
}

const nextOffsetOf = (p: { offset: number; limit: number; total: number; next: string | null } | null | undefined) =>
  p && p.next ? p.offset + p.limit : null;

// ---- Spotify ------------------------------------------------------------------------------------------------------

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>, ttl = TTL_MS): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const forgetCached = (prefix: string) => [...cache.keys()].filter((k) => k.startsWith(prefix)).forEach((k) => cache.delete(k));

/** Clears what was remembered (after signing out). */
export const clearCatalogCache = () => cache.clear();

async function settled<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    // A missing permission or a limit shouldn't blank the whole page: show the rest.
    if (err instanceof SpotifyError && (err.status === 401 || err.status === 429)) throw err;
    return fallback;
  }
}

export const spotifyCatalog: Catalog = {
  isDemo: false,

  profile: () =>
    cached('me', async () => {
      const me = await spotify.me();
      if (!me) throw new SpotifyError(401, 'Could not read your Spotify profile.');
      return {
        id: me.id,
        name: me.display_name || me.id,
        avatarUrl: pickImages(me.images).small,
        premium: me.product ? me.product === 'premium' : null,
      };
    }, 10 * 60_000),

  async home() {
    const me = await this.profile();
    const [recent, playlists, artists, tracks] = await Promise.all([
      settled(cached('recent', () => spotify.recentlyPlayed()), null),
      settled(cached('playlists:0', () => spotify.myPlaylists(0)), null),
      settled(cached('topArtists', () => spotify.topArtists()), null),
      settled(cached('topTracks', () => spotify.topTracks()), null),
    ]);
    return {
      recent: uniqueTracks(present(recent?.items).map((r) => r.track).filter(isSong).map(toTrackInfo)).slice(0, 12),
      playlists: present(playlists?.items).map((p) => mapPlaylist(p, me.id)).slice(0, 12),
      topArtists: present(artists?.items).map(mapArtist),
      topTracks: present(tracks?.items).filter(isSong).map(toTrackInfo),
    };
  },

  async playlists(offset = 0) {
    const me = await this.profile();
    const page = await cached(`playlists:${offset}`, () => spotify.myPlaylists(offset));
    return { items: present(page?.items).map((p) => mapPlaylist(p, me.id)), total: page?.total ?? 0, nextOffset: nextOffsetOf(page) };
  },

  async likedTracks(offset = 0) {
    const page = await cached(`liked:${offset}`, () => spotify.likedTracks(offset));
    return {
      items: present(page?.items).map((r) => r.track).filter(isSong).map(toTrackInfo),
      total: page?.total ?? 0,
      nextOffset: nextOffsetOf(page),
    };
  },

  async savedAlbums(offset = 0) {
    const page = await cached(`albums:${offset}`, () => spotify.savedAlbums(offset));
    return { items: present(page?.items).map((r) => mapAlbum(r.album)), total: page?.total ?? 0, nextOffset: nextOffsetOf(page) };
  },

  async followedArtists() {
    const res = await cached('artists', () => spotify.followedArtists());
    return present(res?.artists.items).map(mapArtist);
  },

  async search(query, offset = 0) {
    const res = await spotify.searchAll(query.trim(), offset);
    const me = await this.profile().catch(() => null);
    const pages = [res?.tracks, res?.albums, res?.artists, res?.playlists];
    const more = pages.map(nextOffsetOf).filter((n): n is number => n !== null);
    return {
      tracks: present(res?.tracks?.items).filter(isSong).map(toTrackInfo),
      albums: present(res?.albums?.items).map(mapAlbum),
      artists: present(res?.artists?.items).map(mapArtist),
      playlists: present(res?.playlists?.items).map((p) => mapPlaylist(p, me?.id ?? null)),
      nextOffset: more.length ? Math.min(...more) : null,
    };
  },

  async playlist(id) {
    const me = await this.profile();
    const meta = await spotify.playlist(id);
    if (!meta) throw new SpotifyError(404, 'That playlist could not be found.');
    const playlist = mapPlaylist(meta, me.id);
    const tracks: TrackInfo[] = [];
    let restricted = false;
    try {
      let offset: number | null = 0;
      // Fetch all the pages (50 at a time), up to a sensible limit.
      while (offset !== null && offset < 1000) {
        const page = await spotify.playlistItems(id, offset);
        tracks.push(...playlistTracks(page));
        offset = nextOffsetOf(page);
      }
    } catch (err) {
      if (err instanceof SpotifyError && err.status === 403) restricted = true;
      else throw err;
    }
    return { playlist, description: stripTags(meta.description ?? ''), tracks, restricted };
  },

  async album(id) {
    const a = await spotify.album(id);
    if (!a) throw new SpotifyError(404, 'That album could not be found.');
    const all = present(a.tracks.items);
    let offset = nextOffsetOf(a.tracks);
    while (offset !== null && offset < 500) {
      const page = await spotify.albumTracks(id, offset);
      all.push(...present(page?.items));
      offset = nextOffsetOf(page);
    }
    return { album: mapAlbum(a), tracks: albumTracks(all, a) };
  },

  async artist(id) {
    const a = await spotify.artist(id);
    if (!a) throw new SpotifyError(404, 'That artist could not be found.');
    const [albums, found] = await Promise.all([
      settled(spotify.artistAlbums(id), null),
      // Spotify no longer lists an artist's popular songs: these are the best matches when searching for the name.
      settled(spotify.searchAll(`artist:"${a.name.replace(/"/g, '')}"`), null),
    ]);
    const popular = present(found?.tracks?.items)
      .filter(isSong)
      .filter((t) => t.artists.some((x) => x.id === id))
      .map(toTrackInfo);
    return { artist: mapArtist(a), genres: a.genres ?? [], popular, albums: present(albums?.items).map(mapAlbum) };
  },

  async likedState(uris) {
    if (!uris.length) return [];
    const out: boolean[] = [];
    for (let i = 0; i < uris.length; i += 50) {
      const res = await spotify.libraryContains(uris.slice(i, i + 50));
      out.push(...(res ?? uris.slice(i, i + 50).map(() => false)));
    }
    return out;
  },

  async setLiked(uri, liked) {
    if (liked) await spotify.saveToLibrary([uri]);
    else await spotify.removeFromLibrary([uri]);
    forgetCached('liked:');
  },
};

/** Playlist descriptions can hold a few HTML tags and entities. */
export function stripTags(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

// ---- Demo ---------------------------------------------------------------------------------------------------------

const demoLiked = new Set<string>(['demo:neon', 'demo:moon']);

const demoAlbum = (t: TrackInfo): AlbumSummary => ({
  id: t.key.replace('demo:', ''),
  uri: `demo:album:${t.key.replace('demo:', '')}`,
  name: t.album,
  artist: t.artists.join(', '),
  artUrl: t.artUrl,
  year: '2026',
  kind: 'Album',
});

const demoArtist = (t: TrackInfo): ArtistSummary => ({
  id: t.key.replace('demo:', ''),
  uri: `demo:artist:${t.key.replace('demo:', '')}`,
  name: t.artists[0],
  artUrl: t.artUrl,
});

/** A small made-up library: the demo songs, three playlists, their albums and artists. */
export const demoCatalog: Catalog = {
  isDemo: true,

  async profile() {
    return { id: 'demo', name: 'Demo listener', avatarUrl: null, premium: true };
  },

  async home() {
    const tracks = demoSongs().map((s) => s.track);
    return {
      recent: [...tracks].reverse(),
      playlists: await this.playlists().then((p) => p.items),
      topArtists: tracks.map(demoArtist),
      topTracks: tracks,
    };
  },

  async playlists() {
    const tracks = new Map(demoSongs().map((s) => [s.track.key.replace('demo:', ''), s.track]));
    const items = DEMO_PLAYLISTS.map((p) => ({
      id: p.id,
      uri: `demo:playlist:${p.id}`,
      name: p.name,
      owner: p.owner,
      artUrl: tracks.get(p.keys[0])?.artUrl ?? null,
      trackCount: p.keys.length,
      mine: true,
    }));
    return { items, total: items.length, nextOffset: null };
  },

  async likedTracks() {
    const items = demoSongs().map((s) => s.track).filter((t) => demoLiked.has(t.uri));
    return { items, total: items.length, nextOffset: null };
  },

  async savedAlbums() {
    const items = demoSongs().map((s) => demoAlbum(s.track));
    return { items, total: items.length, nextOffset: null };
  },

  async followedArtists() {
    return demoSongs().map((s) => demoArtist(s.track));
  },

  async search(query) {
    const q = query.trim().toLowerCase();
    const tracks = demoSongs().map((s) => s.track).filter((t) => `${t.name} ${t.artists.join(' ')} ${t.album}`.toLowerCase().includes(q));
    const playlists = (await this.playlists()).items.filter((p) => p.name.toLowerCase().includes(q));
    return {
      tracks,
      albums: tracks.map(demoAlbum),
      artists: tracks.map(demoArtist),
      playlists,
      nextOffset: null,
    };
  },

  async playlist(id) {
    const def = DEMO_PLAYLISTS.find((p) => p.id === id);
    if (!def) throw new SpotifyError(404, 'That playlist could not be found.');
    const all = new Map(demoSongs().map((s) => [s.track.key.replace('demo:', ''), s.track]));
    const summary = (await this.playlists()).items.find((p) => p.id === id)!;
    return { playlist: summary, description: 'A few made-up songs to try the app with.', tracks: def.keys.map((k) => all.get(k)!), restricted: false };
  },

  async album(id) {
    const song = demoSongs().find((s) => s.track.key === `demo:${id}`);
    if (!song) throw new SpotifyError(404, 'That album could not be found.');
    return { album: demoAlbum(song.track), tracks: [song.track] };
  },

  async artist(id) {
    const song = demoSongs().find((s) => s.track.key === `demo:${id}`);
    if (!song) throw new SpotifyError(404, 'That artist could not be found.');
    return { artist: demoArtist(song.track), genres: ['demo pop'], popular: [song.track], albums: [demoAlbum(song.track)] };
  },

  async likedState(uris) {
    return uris.map((u) => demoLiked.has(u));
  },

  async setLiked(uri, liked) {
    if (liked) demoLiked.add(uri);
    else demoLiked.delete(uri);
  },
};

/** The catalog that goes with an engine (the made-up one for the demo). */
export const catalogFor = (isDemo: boolean): Catalog => (isDemo ? demoCatalog : spotifyCatalog);
