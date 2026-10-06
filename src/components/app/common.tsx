// Building blocks the pages of the Spotify-style app share: loading helpers, covers, cards, and the song list.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useEngineState, formatTime } from '../../hooks/hooks';
import type { Catalog } from '../../lib/catalog';
import type { Engine } from '../../lib/engine';
import { friendlyError, SpotifyError } from '../../lib/spotify';
import type { TrackInfo } from '../../lib/types';
import { HeartIcon, PauseIcon, PlayIcon, PlusIcon } from '../Icons';
import { toast } from '../Toasts';

/** Shows an error as a toast (for button presses). */
export const run = (p: Promise<unknown>) => p.catch((e) => toast(friendlyError(e), 'error'));

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Loads something when the page opens (and again when `key` changes), without showing an old answer for a new page. */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({ key: '', data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    let alive = true;
    latest.current().then(
      (data) => alive && setState({ key, data, error: null }),
      (err) => alive && setState({ key, data: null, error: err instanceof SpotifyError && err.status === 401 ? 'Your Spotify login expired. Sign in again from Settings.' : friendlyError(err) }),
    );
    return () => {
      alive = false;
    };
  }, [key, nonce]);
  const ready = state.key === key;
  return {
    data: ready ? state.data : null,
    error: ready ? state.error : null,
    loading: !ready,
    reload: useCallback(() => setNonce((n) => n + 1), []),
  };
}

/** A cover picture, or a soft colored square when there is none (or it doesn't load). */
export function Cover({ url, round = false, className = '' }: { url: string | null | undefined; round?: boolean; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  const show = url && url !== broken;
  return show ? (
    <img className={`cover${round ? ' round' : ''} ${className}`} src={url} alt="" loading="lazy" onError={() => setBroken(url)} />
  ) : (
    <span className={`cover blank${round ? ' round' : ''} ${className}`} aria-hidden />
  );
}

/** A square (or round, for artists) card: a picture, a title and a line under it. */
export function MediaCard({
  art,
  title,
  subtitle,
  round,
  onOpen,
  onPlay,
}: {
  art: string | null;
  title: string;
  subtitle?: string;
  round?: boolean;
  onOpen: () => void;
  onPlay?: () => void;
}) {
  return (
    <div className="media-card">
      <div className="media-art">
        <button className="media-art-open" onClick={onOpen} aria-label={`Open ${title}`} tabIndex={-1}>
          <Cover url={art} round={round} />
        </button>
        {onPlay && (
          <button className="media-play" onClick={onPlay} aria-label={`Play ${title}`}>
            <PlayIcon width={20} height={20} />
          </button>
        )}
      </div>
      <button className={`media-text${round ? ' centered' : ''}`} onClick={onOpen}>
        <span className="media-title">{title}</span>
        {subtitle && <span className="media-sub">{subtitle}</span>}
      </button>
    </div>
  );
}

/** A titled row of cards that scrolls sideways. */
export function Shelf({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2>{title}</h2>
        {action}
      </div>
      <div className="shelf-row">{children}</div>
    </section>
  );
}

/** Which of these songs are liked (asked in groups, and kept up to date when a heart is pressed). */
export function useLiked(catalog: Catalog, tracks: TrackInfo[]): { liked: Set<string>; toggle: (t: TrackInfo) => void } {
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const asked = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const fresh = tracks.filter((t) => !asked.current.has(t.uri)).slice(0, 300);
    if (!fresh.length) return;
    fresh.forEach((t) => asked.current.add(t.uri));
    // The answer is kept even when the list changes meanwhile (it is about these songs, whatever is on screen now).
    catalog.likedState(fresh.map((t) => t.uri)).then(
      (states) => {
        if (!mounted.current) return;
        setLiked((cur) => {
          const next = new Set(cur);
          fresh.forEach((t, i) => (states[i] ? next.add(t.uri) : next.delete(t.uri)));
          return next;
        });
      },
      () => fresh.forEach((t) => asked.current.delete(t.uri)),
    );
  }, [catalog, tracks]);
  const toggle = useCallback(
    (t: TrackInfo) => {
      const was = liked.has(t.uri);
      setLiked((cur) => {
        const next = new Set(cur);
        if (was) next.delete(t.uri);
        else next.add(t.uri);
        return next;
      });
      catalog.setLiked(t.uri, !was).catch((err) => {
        setLiked((cur) => {
          const next = new Set(cur);
          if (was) next.add(t.uri);
          else next.delete(t.uri);
          return next;
        });
        toast(friendlyError(err), 'error');
      });
    },
    [catalog, liked],
  );
  return { liked, toggle };
}

/**
 * A list of songs. Pressing one plays it: from the playlist or album it belongs to when `context` is given (so the
 * rest of it plays on after the song), otherwise this list in order.
 */
export function TrackList({
  tracks,
  engine,
  catalog,
  context,
  numbered = false,
  showAlbum = true,
  onOpenAlbum,
  onOpenArtist,
}: {
  tracks: TrackInfo[];
  engine: Engine;
  catalog: Catalog;
  /** The uri of the playlist or album these songs are all of. */
  context?: string;
  numbered?: boolean;
  showAlbum?: boolean;
  onOpenAlbum?: (track: TrackInfo) => void;
  onOpenArtist?: (track: TrackInfo) => void;
}) {
  const state = useEngineState(engine);
  const { liked, toggle } = useLiked(catalog, tracks);
  const play = (t: TrackInfo, i: number) => {
    const here = state.track?.key === t.key;
    if (here) return void run(engine.togglePlay());
    void run(context ? engine.playContext(context, t.uri) : engine.playUris(tracks.map((x) => x.uri), i));
  };
  if (!tracks.length) return null;
  return (
    <div className="track-list" role="list">
      {tracks.map((t, i) => {
        const current = state.track?.key === t.key;
        const playing = current && state.isPlaying;
        return (
          <div key={`${t.key}:${i}`} role="listitem" className={`track-row${current ? ' current' : ''}${showAlbum ? '' : ' no-album'}`}>
            <button className="track-play" onClick={() => play(t, i)} aria-label={`${playing ? 'Pause' : 'Play'} ${t.name}`}>
              <span className="track-num">{numbered ? i + 1 : <Cover url={t.artThumbUrl} />}</span>
              <span className="track-icon">{playing ? <PauseIcon width={16} height={16} /> : <PlayIcon width={16} height={16} />}</span>
            </button>
            <div className="track-main" onDoubleClick={() => play(t, i)}>
              <span className="track-name">{t.name}</span>
              <span className="track-artists">
                {onOpenArtist && t.artistIds?.length ? (
                  <button className="link inline" onClick={() => onOpenArtist(t)}>
                    {t.artists.join(', ')}
                  </button>
                ) : (
                  t.artists.join(', ')
                )}
              </span>
            </div>
            {showAlbum && (
              <span className="track-album">
                {onOpenAlbum && t.albumId ? (
                  <button className="link inline" onClick={() => onOpenAlbum(t)}>
                    {t.album}
                  </button>
                ) : (
                  t.album
                )}
              </span>
            )}
            <button className={`track-like${liked.has(t.uri) ? ' on' : ''}`} onClick={() => toggle(t)} aria-label={liked.has(t.uri) ? 'Remove from Liked songs' : 'Add to Liked songs'} aria-pressed={liked.has(t.uri)}>
              <HeartIcon width={18} height={18} filled={liked.has(t.uri)} />
            </button>
            <button className="track-queue" onClick={() => void run(engine.addToQueue(t.uri).then(() => toast('Added to your queue')))} aria-label="Add to queue" title="Add to queue">
              <PlusIcon width={18} height={18} />
            </button>
            <span className="track-time">{formatTime(t.durationMs)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** "3 hr 12 min" or "12 min" for a list of songs. */
export function totalLength(tracks: TrackInfo[]): string {
  const min = Math.round(tracks.reduce((a, t) => a + t.durationMs, 0) / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} hr ${min % 60} min` : `${min} min`;
}

/** What a page shows while loading, or when it failed. */
export function PageState({ loading, error, onRetry, children }: { loading: boolean; error: string | null; onRetry: () => void; children: ReactNode }) {
  if (loading) return <div className="page-note">Loading…</div>;
  if (error)
    return (
      <div className="page-note">
        <p>{error}</p>
        <button className="btn small" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  return <>{children}</>;
}
