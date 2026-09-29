// Finds lyrics for a Spotify track using LRCLIB (https://lrclib.net) — a free,
// open, community lyrics database with time-synced lyrics. No API key needed.

import { parseLrc, parseLyricsfile, plainLyrics } from './lrc';
import type { Lyrics, TrackInfo } from './types';

const BASE = 'https://lrclib.net/api';
// LRCLIB asks apps to identify themselves. Browsers can't set User-Agent, so
// LRCLIB accepts this header instead.
const HEADERS = { 'Lrclib-Client': 'LyricsStage/0.1 (https://github.com/xbyxr9/spotifylyrics)' };

interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number | null; // seconds
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  hasWordSync?: boolean;
  lyricsfile?: string | null;
}

const NONE = (source = 'LRCLIB'): Lyrics => ({ kind: 'none', lines: [], wordSynced: false, source });

/** Strip bits that make titles fail to match: "- Remastered 2011", "(feat. X)" etc. */
export function cleanTitle(name: string): string {
  return name
    .replace(/\s*[([](feat\.?|ft\.?|featuring|with|prod\.?)\s[^)\]]*[)\]]/gi, '')
    .replace(/\s+[-–—]\s+from\s+["“'].*$/i, '')
    .replace(
      /\s+[-–—]\s+(\d{4}\s+)?(remaster(ed)?|re-?recorded|live|mono|stereo|single|radio edit|edit|version|acoustic|demo|bonus|deluxe|explicit|clean|sped up|slowed|taylor's version)\b.*$/i,
      '',
    )
    .replace(/\s*[([](remaster(ed)?|\d{4} remaster(ed)?|explicit|clean|live|mono|stereo)[^)\]]*[)\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toLyrics(r: LrclibRecord, durationMs: number): Lyrics {
  const source = 'LRCLIB';
  if (r.hasWordSync && r.lyricsfile) {
    const parsed = parseLyricsfile(r.lyricsfile, source, durationMs);
    if (parsed?.wordSynced) return parsed;
  }
  if (r.syncedLyrics?.trim()) {
    const parsed = parseLrc(r.syncedLyrics, source, durationMs);
    if (parsed.lines.length) return parsed;
  }
  if (r.instrumental) return { kind: 'instrumental', lines: [], wordSynced: false, source };
  if (r.plainLyrics?.trim()) return plainLyrics(r.plainLyrics, source);
  return NONE(source);
}

/** Lower is better. */
function score(r: LrclibRecord, durationSec: number, title: string): number {
  const diff = r.duration ? Math.abs(r.duration - durationSec) : 6;
  let s = diff * 2;
  if (!r.syncedLyrics) s += 40;
  if (r.hasWordSync) s -= 6;
  if (r.trackName.toLowerCase().trim() !== title.toLowerCase()) s += 3;
  return s;
}

function pickBest(records: LrclibRecord[], durationSec: number, title: string): LrclibRecord | null {
  const usable = records.filter(
    (r) =>
      (r.syncedLyrics || r.plainLyrics || r.instrumental) &&
      (!r.duration || Math.abs(r.duration - durationSec) <= (r.syncedLyrics ? 8 : 20)),
  );
  usable.sort((a, b) => score(a, durationSec, title) - score(b, durationSec, title));
  return usable[0] ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET from LRCLIB. 404 means "not found" (null). Network hiccups and busy responses are retried once. */
async function getJson<T>(path: string, params: Record<string, string>, signal?: AbortSignal, retry = true): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { headers: HEADERS, signal });
  } catch (err) {
    if (!retry || signal?.aborted) throw err;
    await sleep(900);
    return getJson(path, params, signal, false);
  }
  if (res.status === 404) return null;
  if ((res.status === 429 || res.status >= 500) && retry) {
    const wait = Math.min(3000, (Number(res.headers.get('Retry-After')) || 1) * 1000);
    await sleep(wait);
    return getJson(path, params, signal, false);
  }
  if (!res.ok) throw new Error(`LRCLIB error ${res.status}`);
  return (await res.json()) as T;
}

async function lookup(track: TrackInfo, signal?: AbortSignal): Promise<Lyrics> {
  const artist = track.artists[0] ?? '';
  const durationSec = Math.round(track.durationMs / 1000);
  const title = cleanTitle(track.name) || track.name;

  // 1. Exact match (fast, cached by LRCLIB).
  if (track.album) {
    const exact = await getJson<LrclibRecord>(
      '/get',
      { track_name: track.name, artist_name: artist, album_name: track.album, duration: String(durationSec) },
      signal,
    );
    if (exact && (exact.syncedLyrics || exact.instrumental)) return toLyrics(exact, track.durationMs);
  }

  // 2. Search by cleaned title + artist, then a looser free-text search.
  const searches: Record<string, string>[] = [
    { track_name: title, artist_name: artist },
    { q: `${title} ${artist}` },
  ];
  let fallback: LrclibRecord | null = null;
  for (const params of searches) {
    const results = await getJson<LrclibRecord[]>('/search', params, signal);
    const best = results ? pickBest(results, durationSec, title) : null;
    if (best?.syncedLyrics || best?.instrumental) return toLyrics(best, track.durationMs);
    fallback ??= best;
  }
  return fallback ? toLyrics(fallback, track.durationMs) : NONE();
}

// ---- Caching: in memory for this visit + a small local cache between visits.

const memory = new Map<string, Promise<Lyrics>>();
const STORE_PREFIX = 'ls.lyrics.v1.';
const STORE_INDEX = 'ls.lyrics.v1.index';
const STORE_MAX = 80;

function readStore(key: string): Lyrics | null {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    return raw ? (JSON.parse(raw) as Lyrics) : null;
  } catch {
    return null;
  }
}

function writeStore(key: string, lyrics: Lyrics) {
  try {
    const index: string[] = JSON.parse(localStorage.getItem(STORE_INDEX) || '[]');
    const next = [key, ...index.filter((k) => k !== key)];
    for (const old of next.splice(STORE_MAX)) localStorage.removeItem(STORE_PREFIX + old);
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(lyrics));
    localStorage.setItem(STORE_INDEX, JSON.stringify(next));
  } catch {
    /* storage full or blocked — fine, it's only a cache */
  }
}

export function getLyrics(track: TrackInfo): Promise<Lyrics> {
  if (track.localLyrics) return Promise.resolve(track.localLyrics);
  const cached = memory.get(track.key);
  if (cached) return cached;
  const stored = readStore(track.key);
  if (stored) {
    const p = Promise.resolve(stored);
    memory.set(track.key, p);
    return p;
  }
  const p = lookup(track).then(
    (lyrics) => {
      if (lyrics.kind !== 'none') writeStore(track.key, lyrics);
      return lyrics;
    },
    (err) => {
      memory.delete(track.key); // allow a retry later
      throw err;
    },
  );
  memory.set(track.key, p);
  return p;
}

/** Start loading lyrics early (e.g. for the next song in the queue). */
export function prefetchLyrics(track: TrackInfo | null) {
  if (track) void getLyrics(track).catch(() => {});
}
