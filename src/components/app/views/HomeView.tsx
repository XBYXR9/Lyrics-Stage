// Home: a greeting, what you played lately, your playlists, and your favorite artists and songs.
import { useMemo } from 'react';
import { HeartIcon } from '../../Icons';
import { Cover, MediaCard, PageState, Shelf, TrackList, run, useLoad } from '../common';
import { useApp } from '../context';

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

export function HomeView() {
  const { engine, catalog, router, profile } = useApp();
  const home = useLoad(() => catalog.home(), 'home');
  const data = home.data;
  const hello = useMemo(() => greeting(), []);
  return (
    <div className="page">
      <h1 className="page-title">
        {hello}
        {profile ? `, ${profile.name}` : ''}
      </h1>
      <PageState loading={home.loading} error={home.error} onRetry={home.reload}>
        {data && (
          <>
            <div className="quick-grid">
              <button className="quick" onClick={() => router.go({ view: 'liked' })}>
                <span className="cover liked-cover">
                  <HeartIcon filled width={22} height={22} />
                </span>
                <span>Liked songs</span>
              </button>
              {data.playlists.slice(0, 5).map((p) => (
                <button key={p.id} className="quick" onClick={() => router.go({ view: 'playlist', id: p.id })}>
                  <Cover url={p.artUrl} />
                  <span>{p.name}</span>
                </button>
              ))}
            </div>

            {data.recent.length > 0 && (
              <Shelf title="Recently played">
                {data.recent.map((t) => (
                  <MediaCard
                    key={t.key}
                    art={t.artUrl}
                    title={t.name}
                    subtitle={t.artists.join(', ')}
                    onOpen={() => (t.albumId ? router.go({ view: 'album', id: t.albumId }) : run(engine.playTrack(t.uri)))}
                    onPlay={() => run(engine.playUris(data.recent.map((x) => x.uri), data.recent.indexOf(t)))}
                  />
                ))}
              </Shelf>
            )}

            {data.playlists.length > 0 && (
              <Shelf title="Your playlists">
                {data.playlists.map((p) => (
                  <MediaCard
                    key={p.id}
                    art={p.artUrl}
                    title={p.name}
                    subtitle={p.owner}
                    onOpen={() => router.go({ view: 'playlist', id: p.id })}
                    onPlay={() => run(engine.playContext(p.uri))}
                  />
                ))}
              </Shelf>
            )}

            {data.topArtists.length > 0 && (
              <Shelf title="Your top artists">
                {data.topArtists.map((a) => (
                  <MediaCard key={a.id} round art={a.artUrl} title={a.name} subtitle="Artist" onOpen={() => router.go({ view: 'artist', id: a.id })} />
                ))}
              </Shelf>
            )}

            {data.topTracks.length > 0 && (
              <section className="shelf">
                <div className="shelf-head">
                  <h2>Your top songs</h2>
                </div>
                <TrackList tracks={data.topTracks.slice(0, 10)} engine={engine} catalog={catalog} numbered onOpenAlbum={(t) => t.albumId && router.go({ view: 'album', id: t.albumId })} onOpenArtist={(t) => t.artistIds?.[0] && router.go({ view: 'artist', id: t.artistIds[0] })} />
              </section>
            )}

            {!data.recent.length && !data.playlists.length && !data.topArtists.length && (
              <div className="page-note">Play something and it shows up here. Try searching for a song you like.</div>
            )}
          </>
        )}
      </PageState>
    </div>
  );
}
