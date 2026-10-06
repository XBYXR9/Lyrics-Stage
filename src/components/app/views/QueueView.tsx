// The queue: what is playing, and what comes next.
import { useEffect, useState } from 'react';
import { useEngineState } from '../../../hooks/hooks';
import { friendlyError } from '../../../lib/spotify';
import type { TrackInfo } from '../../../lib/types';
import { TrackList } from '../common';
import { useApp } from '../context';

export function QueueView() {
  const { engine, catalog, router } = useApp();
  const state = useEngineState(engine);
  const [next, setNext] = useState<TrackInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = state.track?.key ?? '';

  // Look again when the song changes, and every few seconds (songs get added from other devices).
  useEffect(() => {
    let alive = true;
    const load = () =>
      engine.queueList().then(
        (list) => alive && (setNext(list), setError(null)),
        (e) => alive && setError(friendlyError(e)),
      );
    void load();
    const id = setInterval(load, 6000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [engine, key]);

  return (
    <div className="page">
      <h1 className="page-title">Queue</h1>
      <section className="shelf">
        <div className="shelf-head">
          <h2>Now playing</h2>
        </div>
        {state.track ? <TrackList tracks={[state.track]} engine={engine} catalog={catalog} showAlbum /> : <div className="page-note">Nothing is playing.</div>}
      </section>
      <section className="shelf">
        <div className="shelf-head">
          <h2>Next up</h2>
        </div>
        {error && <div className="page-note">{error}</div>}
        {next && next.length === 0 && !error && <div className="page-note">Your queue is empty. Press + next to a song to add it.</div>}
        {next && next.length > 0 && (
          <TrackList
            tracks={next}
            engine={engine}
            catalog={catalog}
            onOpenAlbum={(t) => t.albumId && router.go({ view: 'album', id: t.albumId })}
            onOpenArtist={(t) => t.artistIds?.[0] && router.go({ view: 'artist', id: t.artistIds[0] })}
          />
        )}
      </section>
    </div>
  );
}
