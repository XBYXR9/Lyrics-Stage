// Finds an album cover when the music player doesn't hand one over (Windows
// sometimes shares the song title but not the cover). Uses Apple's free iTunes
// Search API: no key needed, and it allows requests from any site.
import { cleanTitle, primaryArtist } from './lyrics';

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

/** Lowercase letters and digits only, accents removed: "Beyoncé!" → "beyonce". */
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

const overlaps = (a: string, b: string) => !!a && !!b && (a.includes(b) || b.includes(a));

/** Picks the result that really is this song (right artist and title), preferring the same album. Exported for tests. */
export function pickCover(results: ItunesResult[], q: CoverQuery): string | null {
  const artist = norm(primaryArtist(q.artists[0] ?? ''));
  const title = norm(cleanTitle(q.name) || q.name);
  const album = norm(cleanTitle(q.album) || q.album);
  let best: { url: string; score: number } | null = null;
  for (const r of results) {
    if (!r.artworkUrl100 || !r.trackName || !r.artistName) continue;
    if (!overlaps(norm(r.artistName), artist)) continue;
    const t = norm(cleanTitle(r.trackName) || r.trackName);
    if (t !== title && !overlaps(t, title)) continue;
    const a = norm(r.collectionName ?? '');
    const score = (t === title ? 2 : 0) + (album && a === album ? 3 : overlaps(a, album) ? 1 : 0);
    if (!best || score > best.score) best = { url: r.artworkUrl100, score };
  }
  // Ask for a bigger picture than the 100×100 thumbnail.
  return best ? best.url.replace(/\/\d+x\d+bb\./, '/600x600bb.') : null;
}

const memory = new Map<string, Promise<string | null>>();

export function findCover(q: CoverQuery): Promise<string | null> {
  const artist = primaryArtist(q.artists[0] ?? '');
  const key = `${artist}|${q.name}|${q.album}`.toLowerCase();
  let p = memory.get(key);
  if (!p) {
    p = (async () => {
      const term = `${artist} ${cleanTitle(q.name) || q.name}`.trim();
      if (!term) return null;
      const url = `https://itunes.apple.com/search?${new URLSearchParams({ term, media: 'music', entity: 'song', limit: '10' })}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) return null;
        const json = (await res.json()) as { results?: ItunesResult[] };
        return pickCover(json.results ?? [], q);
      } catch {
        memory.delete(key); // allow another try later (e.g. offline)
        return null;
      } finally {
        clearTimeout(timer);
      }
    })();
    memory.set(key, p);
  }
  return p;
}
