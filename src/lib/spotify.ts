// Small wrapper around the Spotify Web API endpoints this app needs.
import { getAccessToken, isLoggedIn, usesBuiltInClientId } from './auth';
import type { TrackInfo } from './types';

const API = 'https://api.spotify.com/v1';

export class SpotifyError extends Error {
  status: number;
  reason?: string;
  retryAfterMs?: number;
  constructor(status: number, message: string, reason?: string, retryAfterMs?: number) {
    super(message);
    this.status = status;
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Turns API failures into short sentences a person can act on. */
export function friendlyError(err: unknown): string {
  if (err instanceof SpotifyError) {
    if (err.reason === 'NO_ACTIVE_DEVICE' || err.status === 404)
      return 'No active Spotify device. Open Spotify on any device (or press "Play here").';
    if (err.reason === 'VOLUME_CONTROL_DISALLOW') return 'This Spotify device doesn’t let apps change its volume.';
    // Development-mode Spotify apps only allow the accounts listed under User Management.
    if (err.status === 403 && /not be registered|not registered/i.test(err.message))
      return usesBuiltInClientId()
        ? 'This Spotify account isn’t on the list of the Spotify app built into this version, which only has room for a few people. Ask whoever made the app to add your email, or sign in with a Client ID of your own (free): disconnect, then choose “Use a different Client ID”.'
        : 'This Spotify account isn’t on the Spotify app’s user list yet. Add its email under User Management in the Spotify Developer Dashboard.';
    if (err.reason === 'PREMIUM_REQUIRED' || err.status === 403)
      return 'Spotify only allows controlling playback with a Premium account.';
    if (err.status === 401) return 'Your Spotify login expired. Please connect again.';
    if (err.status === 429) return 'Spotify asked us to slow down for a moment.';
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

interface RequestOptions {
  method?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T | null> {
  const token = await getAccessToken(retried);
  if (!token) {
    throw new SpotifyError(401, isLoggedIn() ? 'Could not refresh the Spotify login.' : 'Not logged in.');
  }
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && !retried) return request<T>(path, opts, true);
  if (res.status === 204 || res.status === 202) return null;
  if (!res.ok) {
    let message = `Spotify error ${res.status}`;
    let reason: string | undefined;
    try {
      const json = await res.json();
      message = json?.error?.message || message;
      reason = json?.error?.reason;
    } catch {
      /* empty body */
    }
    const retryAfter = Number(res.headers.get('Retry-After'));
    throw new SpotifyError(res.status, message, reason, retryAfter > 0 ? retryAfter * 1000 : undefined);
  }
  // Playback commands (play, pause, next, seek, volume…) used to answer with
  // nothing; Spotify now sends a short plain-text id instead. Only JSON answers
  // carry data we use.
  const text = await res.text();
  const isJson = /json/i.test(res.headers.get('Content-Type') ?? '') || /^\s*[[{]/.test(text);
  return text && isJson ? (JSON.parse(text) as T) : null;
}

// ---- Raw API shapes (only the fields we use) ----

interface ApiImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface ApiTrack {
  id: string | null;
  uri: string;
  name: string;
  duration_ms: number;
  is_local?: boolean;
  explicit?: boolean;
  artists: { id?: string | null; name: string }[];
  album: { id?: string; name: string; images: ApiImage[] };
}

export interface ApiPaging<T> {
  items: (T | null)[];
  total: number;
  offset: number;
  limit: number;
  next: string | null;
}

export interface ApiAlbum {
  id: string;
  uri: string;
  name: string;
  album_type?: string;
  release_date?: string;
  total_tracks?: number;
  images: ApiImage[];
  artists: { id?: string | null; name: string }[];
}

export interface ApiArtist {
  id: string;
  uri: string;
  name: string;
  genres?: string[];
  images?: ApiImage[];
}

export interface ApiPlaylist {
  id: string;
  uri: string;
  name: string;
  description?: string | null;
  images?: ApiImage[] | null;
  owner?: { id?: string; display_name?: string | null };
  /** Spotify renamed `tracks` to `items` in 2026; either can come back. */
  tracks?: { total?: number };
  items?: { total?: number };
}

export interface ApiProfile {
  id: string;
  display_name?: string | null;
  images?: ApiImage[];
  product?: string;
}

export interface ApiDevice {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number | null;
}

export interface ApiPlayerState {
  device: ApiDevice;
  is_playing: boolean;
  progress_ms: number | null;
  /** When Spotify says this state was produced (epoch ms). */
  timestamp?: number;
  currently_playing_type: 'track' | 'episode' | 'ad' | 'unknown';
  item: ApiTrack | null;
  shuffle_state?: boolean;
  repeat_state?: string;
}

export function pickImages(images: { url: string; width?: number | null }[] | undefined) {
  if (!images?.length) return { large: null, small: null };
  const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return { large: sorted[0].url, small: sorted[sorted.length - 1].url };
}

export function toTrackInfo(t: ApiTrack): TrackInfo {
  const art = pickImages(t.album?.images);
  return {
    key: t.id ?? t.uri,
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => a.name),
    album: t.album?.name ?? '',
    artUrl: art.large,
    artThumbUrl: art.small,
    durationMs: t.duration_ms,
    albumId: t.album?.id,
    artistIds: t.artists.map((a) => a.id).filter((id): id is string => !!id),
  };
}

// ---- Endpoints ----

export const spotify = {
  getPlayer: () => request<ApiPlayerState>('/me/player'),

  getQueue: () =>
    request<{ currently_playing: ApiTrack | null; queue: (ApiTrack | { type: string })[] }>('/me/player/queue'),

  getDevices: () => request<{ devices: ApiDevice[] }>('/me/player/devices'),

  /** Search is limited to 10 results per request for development-mode apps. */
  search: (q: string) =>
    request<{ tracks: { items: ApiTrack[] } }>('/search', { query: { q, type: 'track', limit: 10 } }),

  /** Start playing songs, or a playlist / album (`offset`: which song of it to start with). */
  play: (
    body: { uris?: string[]; context_uri?: string; position_ms?: number; offset?: { uri: string } | { position: number } } | undefined,
    deviceId?: string,
  ) =>
    request('/me/player/play', { method: 'PUT', query: { device_id: deviceId }, body: body ?? {} }),

  pause: (deviceId?: string) => request('/me/player/pause', { method: 'PUT', query: { device_id: deviceId } }),

  next: () => request('/me/player/next', { method: 'POST' }),

  previous: () => request('/me/player/previous', { method: 'POST' }),

  seek: (positionMs: number) =>
    request('/me/player/seek', { method: 'PUT', query: { position_ms: Math.max(0, Math.round(positionMs)) } }),

  queue: (uri: string) => request('/me/player/queue', { method: 'POST', query: { uri } }),

  /** Needs Premium, and a device that allows volume control. */
  volume: (percent: number) => request('/me/player/volume', { method: 'PUT', query: { volume_percent: Math.round(percent) } }),

  /** Needs Premium. state: "off", "context" (the playlist or album) or "track". */
  repeat: (state: 'off' | 'context' | 'track') => request('/me/player/repeat', { method: 'PUT', query: { state } }),

  shuffle: (on: boolean) => request('/me/player/shuffle', { method: 'PUT', query: { state: on ? 'true' : 'false' } }),

  // ---- Library and browsing (the Spotify-style app). Limits follow Spotify's rules for apps in development mode:
  // searches return at most 10 results, playlist songs come from /items, and the library is /me/library.

  me: () => request<ApiProfile>('/me'),

  myPlaylists: (offset = 0) => request<ApiPaging<ApiPlaylist>>('/me/playlists', { query: { limit: 50, offset } }),

  playlist: (id: string) =>
    request<ApiPlaylist>(`/playlists/${id}`, { query: { fields: 'id,uri,name,description,images,owner(id,display_name),tracks(total),items(total)' } }),

  /** Only works for playlists you own or share (Spotify's rule): anything else answers 403. */
  playlistItems: (id: string, offset = 0) =>
    request<ApiPaging<{ item?: ApiTrack | null; track?: ApiTrack | null }>>(`/playlists/${id}/items`, {
      query: { limit: 50, offset, additional_types: 'track' },
    }),

  likedTracks: (offset = 0) => request<ApiPaging<{ track: ApiTrack }>>('/me/tracks', { query: { limit: 50, offset } }),

  savedAlbums: (offset = 0) => request<ApiPaging<{ album: ApiAlbum }>>('/me/albums', { query: { limit: 50, offset } }),

  followedArtists: (after?: string) =>
    request<{ artists: { items: ApiArtist[]; total?: number; cursors?: { after?: string | null } } }>('/me/following', {
      query: { type: 'artist', limit: 50, after },
    }),

  recentlyPlayed: () => request<{ items: { track: ApiTrack }[] }>('/me/player/recently-played', { query: { limit: 50 } }),

  topArtists: () => request<ApiPaging<ApiArtist>>('/me/top/artists', { query: { limit: 12, time_range: 'medium_term' } }),

  topTracks: () => request<ApiPaging<ApiTrack>>('/me/top/tracks', { query: { limit: 20, time_range: 'medium_term' } }),

  searchAll: (q: string, offset = 0) =>
    request<{
      tracks?: ApiPaging<ApiTrack>;
      albums?: ApiPaging<ApiAlbum>;
      artists?: ApiPaging<ApiArtist>;
      playlists?: ApiPaging<ApiPlaylist>;
    }>('/search', { query: { q, type: 'track,album,artist,playlist', limit: 10, offset } }),

  album: (id: string) =>
    request<ApiAlbum & { tracks: ApiPaging<ApiTrack> }>(`/albums/${id}`),

  albumTracks: (id: string, offset = 0) => request<ApiPaging<ApiTrack>>(`/albums/${id}/tracks`, { query: { limit: 50, offset } }),

  artist: (id: string) => request<ApiArtist>(`/artists/${id}`),

  artistAlbums: (id: string) =>
    request<ApiPaging<ApiAlbum>>(`/artists/${id}/albums`, { query: { include_groups: 'album,single', limit: 50 } }),

  libraryContains: (uris: string[]) => request<boolean[]>('/me/library/contains', { query: { uris: uris.join(',') } }),

  saveToLibrary: (uris: string[]) => request('/me/library', { method: 'PUT', query: { uris: uris.join(',') } }),

  removeFromLibrary: (uris: string[]) => request('/me/library', { method: 'DELETE', query: { uris: uris.join(',') } }),

  transfer: (deviceId: string, play = true) =>
    request('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play } }),
};
