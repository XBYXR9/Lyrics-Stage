// Your Library (playlists, albums, artists) and your Liked songs.
import { useCallback, useState } from 'react';
import type { Page } from '../../../lib/catalog';
import { friendlyError } from '../../../lib/spotify';
import type { TrackInfo } from '../../../lib/types';
import { HeartIcon, PlayIcon } from '../../Icons';
import { MediaCard, PageState, TrackList, run, useLoad } from '../common';
import { useApp } from '../context';

type Tab = 'playlists' | 'albums' | 'artists';

/** Loads pages of a list one after another ("Load more"). */
function usePaged<T>(first: Page<T> | null, next: (offset: number) => Promise<Page<T>>) {
  const [extra, setExtra] = useState<{ base: Page<T> | null; items: T[]; nextOffset: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = extra && extra.base === first ? extra : null;
  const items = [...(first?.items ?? []), ...(current?.items ?? [])];
  const nextOffset = current ? current.nextOffset : (first?.nextOffset ?? null);
  const loadMore = useCallback(async () => {
    if (nextOffset === null || busy) return;
    setBusy(true);
    try {
      const page = await next(nextOffset);
      setExtra({ base: first, items: [...(current?.items ?? []), ...page.items], nextOffset: page.nextOffset });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }, [nextOffset, busy, next, first, current]);
  return { items, hasMore: nextOffset !== null, busy, error, loadMore };
}

export function LibraryView() {
  const { engine, catalog, router } = useApp();
  const [tab, setTab] = useState<Tab>('playlists');
  const playlists = useLoad(() => catalog.playlists(0), 'lib:playlists');
  const albums = useLoad(() => catalog.savedAlbums(0), 'lib:albums');
  const artists = useLoad(() => catalog.followedArtists(), 'lib:artists');
  const morePlaylists = usePaged(playlists.data, (o) => catalog.playlists(o));
  const moreAlbums = usePaged(albums.data, (o) => catalog.savedAlbums(o));

  return (
    <div className="page">
      <h1 className="page-title">Your Library</h1>
      <div className="chips" role="tablist">
        {(['playlists', 'albums', 'artists'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`chip${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
            {t === 'playlists' ? 'Playlists' : t === 'albums' ? 'Albums' : 'Artists'}
          </button>
        ))}
      </div>

      {tab === 'playlists' && (
        <PageState loading={playlists.loading} error={playlists.error} onRetry={playlists.reload}>
          <div className="grid">
            <div className="media-card">
              <div className="media-art">
                <button className="media-art-open" onClick={() => router.go({ view: 'liked' })} aria-label="Open Liked songs" tabIndex={-1}>
                  <span className="cover liked-cover big">
                    <HeartIcon filled width={40} height={40} />
                  </span>
                </button>
              </div>
              <button className="media-text" onClick={() => router.go({ view: 'liked' })}>
                <span className="media-title">Liked songs</span>
                <span className="media-sub">Playlist</span>
              </button>
            </div>
            {morePlaylists.items.map((p) => (
              <MediaCard
                key={p.id}
                art={p.artUrl}
                title={p.name}
                subtitle={`${p.owner}${p.trackCount !== null ? ` · ${p.trackCount} songs` : ''}`}
                onOpen={() => router.go({ view: 'playlist', id: p.id })}
                onPlay={() => run(engine.playContext(p.uri))}
              />
            ))}
          </div>
          {morePlaylists.hasMore && (
            <div className="more-row">
              <button className="btn" onClick={morePlaylists.loadMore} disabled={morePlaylists.busy}>
                {morePlaylists.busy ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </PageState>
      )}

      {tab === 'albums' && (
        <PageState loading={albums.loading} error={albums.error} onRetry={albums.reload}>
          {moreAlbums.items.length === 0 && <div className="page-note">Albums you save show up here.</div>}
          <div className="grid">
            {moreAlbums.items.map((a) => (
              <MediaCard key={a.id} art={a.artUrl} title={a.name} subtitle={`${a.year} · ${a.artist}`} onOpen={() => router.go({ view: 'album', id: a.id })} onPlay={() => run(engine.playContext(a.uri))} />
            ))}
          </div>
          {moreAlbums.hasMore && (
            <div className="more-row">
              <button className="btn" onClick={moreAlbums.loadMore} disabled={moreAlbums.busy}>
                {moreAlbums.busy ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </PageState>
      )}

      {tab === 'artists' && (
        <PageState loading={artists.loading} error={artists.error} onRetry={artists.reload}>
          {artists.data?.length === 0 && <div className="page-note">Artists you follow show up here.</div>}
          <div className="grid">
            {artists.data?.map((a) => (
              <MediaCard key={a.id} round art={a.artUrl} title={a.name} subtitle="Artist" onOpen={() => router.go({ view: 'artist', id: a.id })} />
            ))}
          </div>
        </PageState>
      )}
    </div>
  );
}

export function LikedView() {
  const { engine, catalog, router } = useApp();
  const first = useLoad(() => catalog.likedTracks(0), 'liked');
  const paged = usePaged(first.data, (o) => catalog.likedTracks(o));
  const tracks: TrackInfo[] = paged.items;
  return (
    <div className="page">
      <div className="detail-head">
        <span className="cover liked-cover xl">
          <HeartIcon filled width={64} height={64} />
        </span>
        <div className="detail-text">
          <span className="detail-kind">Playlist</span>
          <h1 className="detail-title">Liked songs</h1>
          <span className="detail-meta">{first.data ? `${first.data.total} songs` : ''}</span>
        </div>
      </div>
      <div className="detail-actions">
        <button className="play-big" disabled={!tracks.length} onClick={() => run(engine.playUris(tracks.map((t) => t.uri), 0))} aria-label="Play Liked songs">
          <PlayIcon width={26} height={26} />
        </button>
      </div>
      <PageState loading={first.loading} error={first.error ?? paged.error} onRetry={first.reload}>
        {tracks.length === 0 && <div className="page-note">Press the heart on a song and it is saved here.</div>}
        <TrackList
          tracks={tracks}
          engine={engine}
          catalog={catalog}
          numbered
          onOpenAlbum={(t) => t.albumId && router.go({ view: 'album', id: t.albumId })}
          onOpenArtist={(t) => t.artistIds?.[0] && router.go({ view: 'artist', id: t.artistIds[0] })}
        />
        {paged.hasMore && (
          <div className="more-row">
            <button className="btn" onClick={paged.loadMore} disabled={paged.busy}>
              {paged.busy ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </PageState>
    </div>
  );
}
