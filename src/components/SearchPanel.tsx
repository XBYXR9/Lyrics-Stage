// Search Spotify and play any song (or add it to the queue).
import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../hooks/hooks';
import type { Engine } from '../lib/engine';
import { prefetchLyrics } from '../lib/lyrics';
import { friendlyError } from '../lib/spotify';
import type { TrackInfo } from '../lib/types';
import { CloseIcon, PlayIcon, QueueIcon, SearchIcon } from './Icons';
import { toast } from './Toasts';

export function SearchPanel({ engine, onClose }: { engine: Engine; onClose: () => void }) {
  if (engine.searchMode === 'external') return <SpotifySearch engine={engine} onClose={onClose} />;
  return <ResultsSearch engine={engine} onClose={onClose} />;
}

/** Desktop app: search happens in the Spotify app itself. */
function SpotifySearch({ engine, onClose }: { engine: Engine; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const go = async () => {
    try {
      await engine.search(query);
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };
  return (
    <aside className="panel glass panel-short" aria-label="Search">
      <div className="panel-head">
        <div className="search-box">
          <SearchIcon width={18} height={18} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search songs, artists…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void go();
              if (e.key === 'Escape') onClose();
              e.stopPropagation();
            }}
          />
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close search">
          <CloseIcon />
        </button>
      </div>
      <div className="results">
        <div className="panel-hint">
          Press Enter to search in the Spotify app. Pick a song there and the lyrics show up here.
        </div>
        <button className="btn primary wide" onClick={() => void go()}>
          {query.trim() ? `Search “${query.trim()}” in Spotify` : 'Open Spotify'}
        </button>
      </div>
    </aside>
  );
}

function ResultsSearch({ engine, onClose }: { engine: Engine; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TrackInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    let alive = true;
    const q = query.trim();
    if (!q && !engine.isDemo) {
      setResults([]);
      return;
    }
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const found = await engine.search(q);
        if (alive) setResults(found);
      } catch (e) {
        if (alive) toast(friendlyError(e), 'error');
      } finally {
        if (alive) setBusy(false);
      }
    }, 320);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, engine]);

  const play = async (t: TrackInfo) => {
    prefetchLyrics(t);
    try {
      await engine.playTrack(t.uri);
      onClose();
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  const queue = async (t: TrackInfo) => {
    prefetchLyrics(t);
    try {
      await engine.addToQueue(t.uri);
      toast(`Added “${t.name}” to the queue`);
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  return (
    <aside className="panel glass" aria-label="Search">
      <div className="panel-head">
        <div className="search-box">
          <SearchIcon width={18} height={18} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search songs, artists…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) void play(results[0]);
              if (e.key === 'Escape') onClose();
              e.stopPropagation();
            }}
          />
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close search">
          <CloseIcon />
        </button>
      </div>
      <div className="results">
        {busy && !results.length && <div className="panel-hint">Searching…</div>}
        {!busy && query.trim() && !results.length && <div className="panel-hint">No songs found.</div>}
        {!query.trim() && !engine.isDemo && (
          <div className="panel-hint">Type a song or artist. Press Enter to play the top result.</div>
        )}
        {results.map((t) => (
          <div key={t.key} className="result">
            <button className="result-main" onClick={() => play(t)} title={`Play ${t.name}`}>
              {t.artThumbUrl ? <img src={t.artThumbUrl} alt="" /> : <div className="result-art-empty">♪</div>}
              <div className="result-text">
                <div className="result-title">{t.name}</div>
                <div className="result-sub">
                  {t.artists.join(', ')} · {formatTime(t.durationMs)}
                </div>
              </div>
              <span className="result-play">
                <PlayIcon width={16} height={16} />
              </span>
            </button>
            <button className="icon-btn small" onClick={() => queue(t)} aria-label={`Add ${t.name} to queue`} title="Add to queue">
              <QueueIcon width={18} height={18} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
