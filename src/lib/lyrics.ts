// Finds lyrics for a Spotify track using LRCLIB (https://lrclib.net) — a free,
// open, community lyrics database with time-synced lyrics. No API key needed.

import { parseLrc, parseLyricsfile, plainLyrics } from './lrc';
import type { Lyrics, TrackInfo } from './types';

const BASE = 'https://lrclib.net/api';
// LRCLIB asks apps to identify themselves. Browsers can't set User-Agent, so
// LRCLIB accepts this header instead.
const HEADERS = { 'Lrclib-Client': 'LyricsStage/0.1 (https://github.com/xbyxr9/spotifylyrics)' };

export interface LrclibRecord {
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

/** Strip bits that make titles fail to match: "- Remastered 2011", "(feat. X)", "(Radio Edit)" etc. */
export function cleanTitle(name: string): string {
  return name
    .replace(/\s*[([](feat\.?|ft\.?|featuring|with|prod\.?)\s[^)\]]*[)\]]/gi, '')
    .replace(/\s+[-–—]\s+from\s+["“'].*$/i, '')
    .replace(
      /\s+[-–—]\s+(\d{4}\s+)?(remaster(ed)?|re-?recorded|live|mono|stereo|single|radio edit|edit|version|acoustic|demo|bonus|deluxe|explicit|clean|sped up|slowed|original mix|extended|taylor's version)\b.*$/i,
      '',
    )
    .replace(
      /\s*[([](remaster(ed)?|\d{4} (remaster(ed)?|mix|version)|explicit|clean|live|mono|stereo|radio edit|single version|album version|acoustic|sped up|slowed|bonus track|original mix|extended|deluxe|from\s)[^)\]]*[)\]]/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lowercase letters and digits only, accents removed: "Beyoncé!" → "beyonce". */
export const normalizeName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

/** Every artist in a combined string like "A, B & C feat. D", normalized. */
function artistNames(artist: string): string[] {
  return artist
    .split(/,\s+|\s+&\s+|\s+(?:feat\.?|ft\.?|featuring|with|x)\s+/i)
    .map(normalizeName)
    .filter(Boolean);
}

/** Does an LRCLIB artist field name one of our artists? ("Beyoncé & JAY-Z" matches "Beyonce, JAY Z".) */
export function sameArtist(recordArtist: string, ourArtist: string): boolean {
  const theirs = normalizeName(recordArtist);
  if (!theirs) return false;
  return artistNames(ourArtist).some((a) => a === theirs || (a.length >= 3 && (theirs.includes(a) || a.includes(theirs))));
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

export interface MatchContext {
  /** The song's length in seconds, or null when the player hasn't said. */
  durationSec: number | null;
  title: string;
  /** Full artist string, e.g. "A, B". */
  artist: string;
  /** True when LRCLIB already matched the artist (a search by artist name). */
  artistChecked: boolean;
}

/** Lower is better. */
function score(r: LrclibRecord, m: MatchContext): number {
  const diff = m.durationSec === null ? 0 : r.duration ? Math.abs(r.duration - m.durationSec) : 6;
  let s = diff * 2;
  if (!r.syncedLyrics) s += 40;
  if (r.hasWordSync) s -= 6;
  if (normalizeName(cleanTitle(r.trackName) || r.trackName) !== normalizeName(m.title)) s += 3;
  if (!m.artistChecked && !sameArtist(r.artistName, m.artist)) s += 4;
  return s;
}

/**
 * Picks the record that really is this recording. A different length usually
 * means a different version (live, radio edit, a cover) whose timing won't
 * match what you hear, so those are left out. Exported for tests.
 */
export function pickBest(records: LrclibRecord[], m: MatchContext): LrclibRecord | null {
  const usable = records.filter((r) => {
    if (!(r.syncedLyrics || r.plainLyrics || r.instrumental)) return false;
    const artistOk = m.artistChecked || sameArtist(r.artistName, m.artist);
    if (m.durationSec === null) return artistOk; // can't compare lengths: at least the artist must match
    if (!r.duration) return artistOk;
    const diff = Math.abs(r.duration - m.durationSec);
    // Someone else's artist name (another script, a typo) is only trusted when the length matches closely.
    if (!artistOk) return diff <= 2;
    return diff <= (r.syncedLyrics ? 8 : 20);
  });
  usable.sort((a, b) => score(a, m) - score(b, m));
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

/**
 * First artist from a combined string like "A, B" (the Spotify app joins
 * artists with commas). Only commas are split — "Simon & Garfunkel" is one artist.
 */
export function primaryArtist(artist: string): string {
  return artist.split(/,\s+/)[0]?.trim() || artist;
}

/** The song's length in whole seconds, or null when the player hasn't reported it (yet). */
const lengthSec = (track: TrackInfo) => (track.durationMs > 0 ? Math.round(track.durationMs / 1000) : null);

async function lookup(track: TrackInfo, signal?: AbortSignal): Promise<Lyrics> {
  const fullArtist = track.artists.join(', ');
  const artist = primaryArtist(track.artists[0] ?? '');
  const durationSec = lengthSec(track);
  const title = cleanTitle(track.name) || track.name;

  // 1. Exact match (fast, cached by LRCLIB). It needs the song's length. Try the full artist string, then the first artist.
  if (track.album && durationSec !== null) {
    for (const name of new Set([fullArtist, artist])) {
      const exact = await getJson<LrclibRecord>(
        '/get',
        { track_name: track.name, artist_name: name, album_name: track.album, duration: String(durationSec) },
        signal,
      );
      if (exact && (exact.syncedLyrics || exact.instrumental)) return toLyrics(exact, track.durationMs);
    }
  }

  // 2. Search by cleaned title + artist, then a looser free-text search, then by title
  //    alone (for when LRCLIB spells the artist differently).
  const searches: { params: Record<string, string>; artistChecked: boolean }[] = [
    { params: { track_name: title, artist_name: artist }, artistChecked: true },
    { params: { q: `${title} ${artist}` }, artistChecked: false },
    { params: { track_name: title }, artistChecked: false },
  ];
  let fallback: LrclibRecord | null = null;
  for (const { params, artistChecked } of searches) {
    const results = await getJson<LrclibRecord[]>('/search', params, signal);
    const best = results ? pickBest(results, { durationSec, title, artist: fullArtist, artistChecked }) : null;
    if (best?.syncedLyrics || best?.instrumental) return toLyrics(best, track.durationMs);
    fallback ??= best;
  }
  return fallback ? toLyrics(fallback, track.durationMs) : NONE();
}

// ---- Caching: in memory for this visit + a small local cache between visits.

const memory = new Map<string, Promise<Lyrics>>();
// v2: results are saved per song *and* length, so a lookup made while the
// player still reported the wrong length can't stick. Older results are dropped.
const STORE_PREFIX = 'ls.lyrics.v2.';
const STORE_INDEX = 'ls.lyrics.v2.index';
const STORE_MAX = 80;
const OLD_PREFIX = 'ls.lyrics.v1.';

/** Songs are looked up again when the player corrects the song's length. */
const cacheKey = (track: TrackInfo) => `${track.key}|${lengthSec(track) ?? '?'}`;

let oldCacheCleared = false;
function clearOldCache() {
  if (oldCacheCleared) return;
  oldCacheCleared = true;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(OLD_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* storage blocked — nothing to clear */
  }
}

function readStore(key: string): Lyrics | null {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    return raw ? (JSON.parse(raw) as Lyrics) : null;
  } catch {
    return null;
  }
}

function writeStore(key: string, lyrics: Lyrics) {
  clearOldCache();
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

/** True when lyrics for this song (at this length) are already loaded or saved, so no waiting is needed. */
export function hasCachedLyrics(track: TrackInfo): boolean {
  const key = cacheKey(track);
  return !!track.localLyrics || memory.has(key) || readStore(key) !== null;
}

export function getLyrics(track: TrackInfo): Promise<Lyrics> {
  if (track.localLyrics) return Promise.resolve(track.localLyrics);
  const key = cacheKey(track);
  const cached = memory.get(key);
  if (cached) return cached;
  const stored = readStore(key);
  if (stored) {
    const p = Promise.resolve(stored);
    memory.set(key, p);
    return p;
  }
  const p = lookup(track).then(
    (lyrics) => {
      // Only save results found with a known length; they're the reliable ones.
      if (lyrics.kind !== 'none' && lengthSec(track) !== null) writeStore(key, lyrics);
      return lyrics;
    },
    (err) => {
      memory.delete(key); // allow a retry later
      throw err;
    },
  );
  memory.set(key, p);
  return p;
}

/** Start loading lyrics early (e.g. for the next song in the queue). */
export function prefetchLyrics(track: TrackInfo | null) {
  if (track) void getLyrics(track).catch(() => {});
}
