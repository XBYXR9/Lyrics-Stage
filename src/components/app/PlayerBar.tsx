// The bar at the bottom: the song, the controls, a progress bar, and buttons for the lyrics, the queue, volume and devices.
import { useEngineState } from '../../hooks/hooks';
import { HeartIcon, LyricsIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, QueueIcon, RepeatIcon, ShuffleIcon } from '../Icons';
import { DeviceMenu, Progress, Volume } from '../NowPlaying';
import { Cover, run, useLiked } from './common';
import { useApp } from './context';
import type { RepeatMode } from '../../lib/engine';

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: 'context', context: 'track', track: 'off' };

export function PlayerBar() {
  const { engine, catalog, router, openLyrics } = useApp();
  const state = useEngineState(engine);
  const track = state.track;
  const { liked, toggle } = useLiked(catalog, track ? [track] : []);
  const isLiked = !!track && liked.has(track.uri);
  return (
    <footer className="pb" aria-label="Player">
      <div className="pb-left">
        <button className="pb-cover" onClick={openLyrics} aria-label="Open the lyrics" title="Open the lyrics">
          <Cover url={track?.artUrl} />
        </button>
        {track ? (
          <>
            <div className="pb-meta">
              <button className="pb-title link inline" onClick={() => track.albumId && router.go({ view: 'album', id: track.albumId })}>
                {track.name}
              </button>
              <span className="pb-artist">{track.artists.join(', ')}</span>
            </div>
            <button className={`track-like${isLiked ? ' on' : ''}`} onClick={() => toggle(track)} aria-pressed={isLiked} aria-label={isLiked ? 'Remove from Liked songs' : 'Add to Liked songs'}>
              <HeartIcon width={20} height={20} filled={isLiked} />
            </button>
          </>
        ) : (
          <div className="pb-meta">
            <span className="pb-title">Nothing playing</span>
            <span className="pb-artist">Pick a song to start</span>
          </div>
        )}
      </div>

      <div className="pb-center">
        <div className="pb-controls">
          <button className={`icon-btn small hide-small${state.shuffle ? ' lit' : ''}`} onClick={() => run(engine.setShuffle(!state.shuffle))} aria-pressed={state.shuffle} aria-label="Shuffle" title="Shuffle">
            <ShuffleIcon width={20} height={20} />
          </button>
          <button className="icon-btn" onClick={() => run(engine.previous())} aria-label="Previous">
            <PrevIcon width={24} height={24} />
          </button>
          <button className="pb-play" onClick={() => run(engine.togglePlay())} disabled={!track} aria-label={state.isPlaying ? 'Pause' : 'Play'}>
            {state.isPlaying ? <PauseIcon width={22} height={22} /> : <PlayIcon width={22} height={22} />}
          </button>
          <button className="icon-btn" onClick={() => run(engine.next())} aria-label="Next">
            <NextIcon width={24} height={24} />
          </button>
          <button className={`icon-btn small hide-small${state.repeat !== 'off' ? ' lit' : ''}`} onClick={() => run(engine.setRepeat(NEXT_REPEAT[state.repeat]))} aria-label={`Repeat: ${state.repeat === 'off' ? 'off' : state.repeat === 'track' ? 'this song' : 'all'}`} title="Repeat">
            <RepeatIcon width={20} height={20} one={state.repeat === 'track'} />
          </button>
        </div>
        {track && <Progress engine={engine} durationMs={track.durationMs} />}
      </div>

      <div className="pb-right">
        <button className="pb-lyrics" onClick={openLyrics} title="Open the lyrics">
          <LyricsIcon width={20} height={20} />
          <span>Lyrics</span>
        </button>
        <button className={`icon-btn small${router.route.view === 'queue' ? ' lit' : ''}`} onClick={() => router.go({ view: 'queue' })} aria-label="Queue" title="Queue">
          <QueueIcon width={20} height={20} />
        </button>
        <div className="pb-volume">
          <Volume engine={engine} volume={state.volume} />
        </div>
        <div className="pb-device">
          <DeviceMenu engine={engine} state={state} />
        </div>
      </div>
    </footer>
  );
}
