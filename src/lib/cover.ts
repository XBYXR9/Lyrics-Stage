// Finds an album cover when the music player doesn't hand one over (Windows
// sometimes shares the song title but not the cover). Uses Apple's free iTunes
// Search API: no key needed, and it allows requests from any site.
import { cleanTitle, normalizeName as norm, primaryArtist, sameArtist } from './lyrics';

export interface CoverQuery {
  name: string;
  artists: string[];
  album: string;
}

interface ItunesResult {
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
}

const overlaps = (a: string, b: string) => !!a && !!b && (a.includes(b) || b.includes(a));

/** 0..1: how alike two names are (1 = same). Catches spellings like "Tamally" vs "Tamly". */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

/** Same name, one inside the other ("Song" / "Song (Live)"), or spelled almost the same. */
const alike = (a: string, b: string) => a === b || overlaps(a, b) || similarity(a, b) >= 0.8;

const cleaned = (s: string) => norm(cleanTitle(s) || s);

/** Asks for a bigger picture than the 100×100 thumbnail. */
const big = (url: string) => url.replace(/\/\d+x\d+bb\./, '/600x600bb.');

/** Picks the result that really is this song (right artist and title), preferring the same album. Exported for tests. */
export function pickCover(results: ItunesResult[], q: CoverQuery): string | null {
  const artists = q.artists.join(', ');
  const title = cleaned(q.name);
  const album = cleaned(q.album);
  let best: { url: string; score: number } | null = null;
  for (const r of results) {
    if (!r.artworkUrl100 || !r.trackName || !r.artistName) continue;
    if (!sameArtist(r.artistName, artists)) continue;
    const t = cleaned(r.trackName);
    if (!alike(t, title)) continue;
    const a = cleaned(r.collectionName ?? '');
    const sameEdition = norm(r.collectionName ?? '') === norm(q.album); // "After Hours" over "After Hours (Deluxe)"
    const score = (t === title ? 2 : 0) + (album && a === album ? 3 : album && alike(a, album) ? 1 : 0) + (sameEdition ? 1 : 0);
    if (!best || score > best.score) best = { url: r.artworkUrl100, score };
  }
  return best ? big(best.url) : null;
}

/** Picks this artist's album with (nearly) the same name. Exported for tests. */
export function pickAlbumCover(results: ItunesResult[], q: CoverQuery): string | null {
  const album = cleaned(q.album);
  if (!album) return null;
  const artists = q.artists.join(', ');
  let best: { url: string; score: number } | null = null;
  for (const r of results) {
    if (!r.artworkUrl100 || !r.collectionName || !r.artistName) continue;
    if (!sameArtist(r.artistName, artists)) continue;
    const a = cleaned(r.collectionName);
    if (!alike(a, album)) continue;
    const score = (a === album ? 2 : 1) + (norm(r.collectionName) === norm(q.album) ? 1 : 0);
    if (!best || score > best.score) best = { url: r.artworkUrl100, score };
  }
  return best ? big(best.url) : null;
}

async function search(params: Record<string, string>): Promise<ItunesResult[]> {
  const url = `https://itunes.apple.com/search?${new URLSearchParams({ media: 'music', ...params })}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`iTunes ${res.status}`);
    const json = (await res.json()) as { results?: ItunesResult[] };
    return json.results ?? [];
  } finally {
    clearTimeout(timer);
  }
}

const memory = new Map<string, Promise<string | null>>();

export function findCover(q: CoverQuery): Promise<string | null> {
  const artist = primaryArtist(q.artists[0] ?? '');
  const key = `${artist}|${q.name}|${q.album}`.toLowerCase();
  let p = memory.get(key);
  if (!p) {
    p = (async () => {
      const title = cleanTitle(q.name) || q.name;
      if (!artist && !title) return null;
      try {
        // 1. The song itself.
        const songs = await search({ term: `${artist} ${title}`.trim(), entity: 'song', limit: '15' });
        const song = pickCover(songs, q);
        if (song) return song;
        // 2. Its album: the cover is the album's anyway, and album names differ less between stores than song titles.
        const albumName = cleanTitle(q.album) || q.album;
        if (!albumName) return null;
        const albums = await search({ term: `${artist} ${albumName}`.trim(), entity: 'album', limit: '10' });
        return pickAlbumCover(albums, q);
      } catch {
        memory.delete(key); // allow another try later (e.g. offline)
        return null;
      }
    })();
    memory.set(key, p);
  }
  return p;
}
