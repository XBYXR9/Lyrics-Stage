// Search: songs, artists, albums and playlists. Spotify gives 10 of each kind at a time, so there is a "Show more".
import { useEffect, useRef, useState } from 'react';
import type { SearchResults } from '../../../lib/catalog';
import { friendlyError } from '../../../lib/spotify';
import { SearchIcon } from '../../Icons';
import { MediaCard, Shelf, TrackList, run } from '../common';
import { useApp } from '../context';

const EMPTY: SearchResults = { tracks: [], albums: [], artists: [], playlists: [], nextOffset: null };

/** Adds a page of results to what is shown, leaving out what is there already. */
function mergeBy<T>(a: T[], b: T[], key: (item: T) => string): T[] {
  const seen = new Set(a.map(key));
  return [...a, ...b.filter((i) => !seen.has(key(i)))];
}

const merge = (a: SearchResults, b: SearchResults): SearchResults => ({
  tracks: mergeBy(a.tracks, b.tracks, (t) => t.key),
  albums: mergeBy(a.albums, b.albums, (x) => x.id),
  artists: mergeBy(a.artists, b.artists, (x) => x.id),
  playlists: mergeBy(a.playlists, b.playlists, (x) => x.id),
  nextOffset: b.nextOffset,
});

export function SearchView({ initial = '' }: { initial?: string }) {
  const { engine, catalog, router } = useApp();
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  // Search a moment after typing stops.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setError(null);
      return;
    }
    const id = ++latest.current;
    setBusy(true);
    const timer = setTimeout(() => {
      catalog.search(q).then(
        (r) => id === latest.current && (setResults(r), setError(null), setBusy(false)),
        (e) => id === latest.current && (setError(friendlyError(e)), setBusy(false)),
      );
    }, 350);
    return () => clearTimeout(timer);
  }, [query, catalog]);

  const more = async () => {
    if (!results || results.nextOffset === null) return;
    setBusy(true);
    try {
      const next = await catalog.search(query, results.nextOffset);
      setResults((cur) => (cur ? merge(cur, next) : next));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const r = results ?? EMPTY;
  const none = results && !r.tracks.length && !r.albums.length && !r.artists.length && !r.playlists.length;
  return (
    <div className="page">
      <label className="search-field">
        <SearchIcon width={20} height={20} />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What do you want to listen to?"
          aria-label="Search"
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      {!query.trim() && <div className="page-note">Search for songs, artists, albums and playlists.</div>}
      {error && <div className="page-note">{error}</div>}
      {busy && !results && query.trim() && <div className="page-note">Searching…</div>}
      {none && !busy && <div className="page-note">Nothing found for “{query.trim()}”. Try another spelling.</div>}

      {results && (
        <>
          {r.tracks.length > 0 && (
            <section className="shelf">
              <div className="shelf-head">
                <h2>Songs</h2>
              </div>
              <TrackList tracks={r.tracks} engine={engine} catalog={catalog} onOpenAlbum={(t) => t.albumId && router.go({ view: 'album', id: t.albumId })} onOpenArtist={(t) => t.artistIds?.[0] && router.go({ view: 'artist', id: t.artistIds[0] })} />
            </section>
          )}
          {r.artists.length > 0 && (
            <Shelf title="Artists">
              {r.artists.map((a) => (
                <MediaCard key={a.id} round art={a.artUrl} title={a.name} subtitle="Artist" onOpen={() => router.go({ view: 'artist', id: a.id })} />
              ))}
            </Shelf>
          )}
          {r.albums.length > 0 && (
            <Shelf title="Albums">
              {r.albums.map((a) => (
                <MediaCard key={a.id} art={a.artUrl} title={a.name} subtitle={`${a.year} · ${a.artist}`} onOpen={() => router.go({ view: 'album', id: a.id })} onPlay={() => run(engine.playContext(a.uri))} />
              ))}
            </Shelf>
          )}
          {r.playlists.length > 0 && (
            <Shelf title="Playlists">
              {r.playlists.map((p) => (
                <MediaCard key={p.id} art={p.artUrl} title={p.name} subtitle={`By ${p.owner}`} onOpen={() => router.go({ view: 'playlist', id: p.id })} onPlay={() => run(engine.playContext(p.uri))} />
              ))}
            </Shelf>
          )}
          {r.nextOffset !== null && (
            <div className="more-row">
              <button className="btn" onClick={more} disabled={busy}>
                {busy ? 'Loading…' : 'Show more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
