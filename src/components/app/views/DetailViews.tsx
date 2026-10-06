// The pages of one playlist, one album and one artist.
import type { ReactNode } from 'react';
import { PlayIcon, ShuffleIcon } from '../../Icons';
import { toast } from '../../Toasts';
import { Cover, MediaCard, PageState, Shelf, TrackList, run, totalLength, useLoad } from '../common';
import { useApp } from '../context';
import type { TrackInfo } from '../../../lib/types';

function Header({ art, kind, title, meta, children, round }: { art: string | null; kind: string; title: string; meta: ReactNode; children?: ReactNode; round?: boolean }) {
  return (
    <div className="detail-head">
      <Cover url={art} round={round} className="xl" />
      <div className="detail-text">
        <span className="detail-kind">{kind}</span>
        <h1 className="detail-title">{title}</h1>
        {children}
        <span className="detail-meta">{meta}</span>
      </div>
    </div>
  );
}

export function PlaylistView({ id }: { id: string }) {
  const { engine, catalog, router } = useApp();
  const page = useLoad(() => catalog.playlist(id), `playlist:${id}`);
  const d = page.data;
  const shufflePlay = async () => {
    try {
      await engine.setShuffle(true);
      await engine.playContext(d!.playlist.uri);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That didn’t work.', 'error');
    }
  };
  return (
    <div className="page">
      <PageState loading={page.loading} error={page.error} onRetry={page.reload}>
        {d && (
          <>
            <Header
              art={d.playlist.artUrl}
              kind="Playlist"
              title={d.playlist.name}
              meta={
                <>
                  {d.playlist.owner}
                  {d.playlist.trackCount !== null ? ` · ${d.playlist.trackCount} songs` : ''}
                  {d.tracks.length ? `, ${totalLength(d.tracks)}` : ''}
                </>
              }
            >
              {d.description && <p className="detail-desc">{d.description}</p>}
            </Header>
            <div className="detail-actions">
              <button className="play-big" onClick={() => run(engine.playContext(d.playlist.uri))} aria-label={`Play ${d.playlist.name}`}>
                <PlayIcon width={26} height={26} />
              </button>
              <button className="icon-btn big" onClick={shufflePlay} aria-label="Shuffle play" title="Shuffle play">
                <ShuffleIcon width={26} height={26} />
              </button>
            </div>
            {d.restricted && (
              <div className="page-note">
                Spotify only lets apps show the songs of playlists you made or share. You can still press play to listen to it.
              </div>
            )}
            <TrackList
              tracks={d.tracks}
              engine={engine}
              catalog={catalog}
              context={d.playlist.uri}
              numbered
              onOpenAlbum={(t) => t.albumId && router.go({ view: 'album', id: t.albumId })}
              onOpenArtist={(t) => t.artistIds?.[0] && router.go({ view: 'artist', id: t.artistIds[0] })}
            />
          </>
        )}
      </PageState>
    </div>
  );
}

export function AlbumView({ id }: { id: string }) {
  const { engine, catalog, router } = useApp();
  const page = useLoad(() => catalog.album(id), `album:${id}`);
  const d = page.data;
  return (
    <div className="page">
      <PageState loading={page.loading} error={page.error} onRetry={page.reload}>
        {d && (
          <>
            <Header art={d.album.artUrl} kind={d.album.kind} title={d.album.name} meta={`${d.album.artist}${d.album.year ? ` · ${d.album.year}` : ''} · ${d.tracks.length} songs, ${totalLength(d.tracks)}`} />
            <div className="detail-actions">
              <button className="play-big" onClick={() => run(engine.playContext(d.album.uri))} aria-label={`Play ${d.album.name}`}>
                <PlayIcon width={26} height={26} />
              </button>
            </div>
            <TrackList tracks={d.tracks} engine={engine} catalog={catalog} context={d.album.uri} numbered showAlbum={false} onOpenArtist={(t) => t.artistIds?.[0] && router.go({ view: 'artist', id: t.artistIds[0] })} />
          </>
        )}
      </PageState>
    </div>
  );
}

export function ArtistView({ id }: { id: string }) {
  const { engine, catalog, router } = useApp();
  const page = useLoad(() => catalog.artist(id), `artist:${id}`);
  const d = page.data;
  const popular: TrackInfo[] = d?.popular.slice(0, 10) ?? [];
  return (
    <div className="page">
      <PageState loading={page.loading} error={page.error} onRetry={page.reload}>
        {d && (
          <>
            <Header round art={d.artist.artUrl} kind="Artist" title={d.artist.name} meta={d.genres.slice(0, 3).join(' · ')} />
            <div className="detail-actions">
              <button className="play-big" disabled={!popular.length} onClick={() => run(engine.playUris(popular.map((t) => t.uri), 0))} aria-label={`Play ${d.artist.name}`}>
                <PlayIcon width={26} height={26} />
              </button>
            </div>
            {popular.length > 0 && (
              <section className="shelf">
                <div className="shelf-head">
                  <h2>Popular</h2>
                </div>
                <TrackList tracks={popular} engine={engine} catalog={catalog} numbered onOpenAlbum={(t) => t.albumId && router.go({ view: 'album', id: t.albumId })} />
              </section>
            )}
            {d.albums.length > 0 && (
              <Shelf title="Albums and singles">
                {d.albums.map((a) => (
                  <MediaCard key={a.id} art={a.artUrl} title={a.name} subtitle={`${a.year} · ${a.kind}`} onOpen={() => router.go({ view: 'album', id: a.id })} onPlay={() => run(engine.playContext(a.uri))} />
                ))}
              </Shelf>
            )}
          </>
        )}
      </PageState>
    </div>
  );
}
