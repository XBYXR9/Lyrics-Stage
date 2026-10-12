// Real word-by-word timings from Musixmatch ("richsync"), for the desktop and phone apps.
//
// This uses the same unofficial route as Musixmatch's own mobile app. It can stop working at any time, so it is off by
// default (Settings → Word-by-word highlight → Exact word timing) and everything falls back to LRCLIB.
// Web pages can't call it (the service doesn't allow that), so the desktop app asks through its main process and the
// phone app through its native network layer. Written for this app.
import { CapacitorHttp } from '@capacitor/core';
import { desktopApi } from './desktopTypes';
import { buildSynced } from './lrc';
import { isNativeApp } from './nativeApp';
import { getSettings } from './settings';
import type { Lyrics, TrackInfo } from './types';

const ORIGIN = 'https://apic-appmobile.musixmatch.com';
const APP_ID = 'mac-ios-v2.0';
const TOKEN_KEY = 'ls.mxm.token';
const HEADERS = { Accept: 'application/json', 'X-Cookie': 'x-mxm-token-guid=', 'x-mxm-app-version': '10.1.1' };
/** If Musixmatch's version of the song is longer or shorter than ours by more than this, it is another recording. */
const MAX_LENGTH_DIFF_SEC = 5;

/** Can this app ask Musixmatch at all? (Not the website.) */
export const musixmatchAvailable = () => !!desktopApi() || isNativeApp();

/** Should lookups also try Musixmatch right now? */
export const musixmatchEnabled = () => getSettings().musixmatchWords && musixmatchAvailable();

interface Answer {
  status: number;
  body: string;
}

async function get(pathAndQuery: string): Promise<Answer> {
  const desktop = desktopApi();
  if (desktop) return desktop.musixmatchGet(pathAndQuery);
  if (isNativeApp()) {
    const res = await CapacitorHttp.get({ url: ORIGIN + pathAndQuery, headers: HEADERS, responseType: 'text' });
    return { status: res.status, body: typeof res.data === 'string' ? res.data : JSON.stringify(res.data) };
  }
  throw new Error('Musixmatch word timing needs the desktop or phone app');
}

const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
};

/** A sign-in token from Musixmatch (kept on this device). Fetches a new one when asked or when there is none. */
async function token(renew = false): Promise<string> {
  const saved = readToken();
  if (saved && !renew) return saved;
  const a = await get(`/ws/1.1/token.get?app_id=${APP_ID}`);
  const user = parseJson(a.body)?.message?.body?.user_token;
  if (a.status !== 200 || typeof user !== 'string' || !user) throw new Error('Musixmatch did not give a token');
  try {
    localStorage.setItem(TOKEN_KEY, user);
  } catch {
    /* storage blocked: the token is fetched again next time */
  }
  return user;
}

// Musixmatch's answers are loose JSON, read defensively.
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function parseJson(text: string): Json | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface RichsyncWord {
  c?: unknown;
  o?: unknown;
}
interface RichsyncLine {
  ts?: unknown;
  te?: unknown;
  l?: RichsyncWord[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Turns Musixmatch's word-timed lyrics into our lyrics. Each line has a start and end in seconds, and each word an
 * offset (in seconds) from the start of its line. Spaces come as words of their own and are glued to the word before.
 * Returns null when the answer has no usable lines. Exported for tests.
 */
export function richsyncToLyrics(richsyncBody: string, durationMs: number): Lyrics | null {
  const lines = parseJson(richsyncBody);
  if (!Array.isArray(lines)) return null;
  const raw = [];
  for (const line of lines as RichsyncLine[]) {
    const ts = num(line?.ts);
    const te = num(line?.te);
    if (ts === null || te === null || !Array.isArray(line.l)) continue;
    const lineStart = Math.round(ts * 1000);
    const lineEnd = Math.round(te * 1000);
    const words: { text: string; start: number; end?: number }[] = [];
    for (const w of line.l) {
      const text = typeof w?.c === 'string' ? w.c : '';
      const offset = num(w?.o);
      if (!text || offset === null) continue;
      if (!text.trim()) {
        if (words.length) words[words.length - 1].text += ' ';
        continue;
      }
      words.push({ text, start: lineStart + Math.round(offset * 1000) });
    }
    if (!words.length) continue;
    words[words.length - 1].end = lineEnd;
    raw.push({ start: lineStart, end: lineEnd, text: words.map((w) => w.text).join(''), words });
  }
  if (!raw.length) return null;
  const lyrics = buildSynced(raw, 'Musixmatch', durationMs);
  return lyrics.kind === 'synced' && lyrics.wordSynced ? lyrics : null;
}

/** Real word timings for this song, or null when Musixmatch has none (or isn't reachable). Never throws. */
export async function fetchMusixmatchWords(track: TrackInfo): Promise<Lyrics | null> {
  try {
    const durationSec = track.durationMs > 0 ? track.durationMs / 1000 : 0;
    for (const renew of [false, true]) {
      const params = new URLSearchParams({
        format: 'json',
        namespace: 'lyrics_richsynched',
        subtitle_format: 'mxm',
        app_id: APP_ID,
        q_album: track.album,
        q_artist: track.artists.join(', '),
        q_artists: track.artists.join(', '),
        q_track: track.name,
        track_spotify_id: track.uri,
        q_duration: String(durationSec),
        f_subtitle_length: String(Math.floor(durationSec)),
        usertoken: await token(renew),
        optional_calls: 'track.richsync',
        richsync_compact_type: 'words',
      });
      const a = await get(`/ws/1.1/macro.subtitles.get?${params}`);
      const json = parseJson(a.body);
      // The token has run out: get a new one and try once more.
      if (json?.message?.header?.status_code === 401 || a.status === 401) {
        if (renew) return null;
        continue;
      }
      const calls = json?.message?.body?.macro_calls;
      const meta = calls?.['matcher.track.get']?.message?.body?.track;
      if (!meta || meta.instrumental || !meta.has_richsync) return null;
      const rich = calls?.['track.richsync.get']?.message;
      const richsync = rich?.header?.status_code === 200 ? rich?.body?.richsync : null;
      if (!richsync?.richsync_body) return null;
      // A different length means a different recording (live, a cover, a radio edit): its timings would be wrong.
      const theirs = num(richsync.richsync_length) ?? num(meta.track_length);
      if (durationSec > 0 && theirs !== null && Math.abs(theirs - durationSec) > MAX_LENGTH_DIFF_SEC) return null;
      return richsyncToLyrics(String(richsync.richsync_body), track.durationMs);
    }
    return null;
  } catch {
    return null;
  }
}
