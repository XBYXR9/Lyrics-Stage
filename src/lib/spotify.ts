// Small wrapper around the Spotify Web API endpoints this app needs.
import { getAccessToken, isLoggedIn } from './auth';
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
      return 'This Spotify account isn’t on the Spotify app’s user list yet. Add its email under User Management in the Spotify Developer Dashboard.';
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
  artists: { name: string }[];
  album: { name: string; images: ApiImage[] };
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

  play: (body: { uris?: string[]; context_uri?: string; position_ms?: number } | undefined, deviceId?: string) =>
    request('/me/player/play', { method: 'PUT', query: { device_id: deviceId }, body: body ?? {} }),

  pause: (deviceId?: string) => request('/me/player/pause', { method: 'PUT', query: { device_id: deviceId } }),

  next: () => request('/me/player/next', { method: 'POST' }),

  previous: () => request('/me/player/previous', { method: 'POST' }),

  seek: (positionMs: number) =>
    request('/me/player/seek', { method: 'PUT', query: { position_ms: Math.max(0, Math.round(positionMs)) } }),

  queue: (uri: string) => request('/me/player/queue', { method: 'POST', query: { uri } }),

  /** Needs Premium, and a device that allows volume control. */
  volume: (percent: number) => request('/me/player/volume', { method: 'PUT', query: { volume_percent: Math.round(percent) } }),

  transfer: (deviceId: string, play = true) =>
    request('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play } }),
};
