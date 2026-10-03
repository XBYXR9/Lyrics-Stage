// Holds one "layer" of lyrics per song. When songs change, the old layer fades
// out while the new one fades in. For Spotify Automix / Crossfade blends the
// fade lasts as long as the songs overlap, and the old song's lyrics keep
// moving in time while they fade — so the lyrics blend just like the audio.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLyrics, usePalette } from '../hooks/hooks';
import { FixedClock, type Clock } from '../lib/clock';
import type { Engine, TrackChange } from '../lib/engine';
import type { Settings } from '../lib/settings';
import { visualTransitionMs } from '../lib/transitions';
import type { TrackInfo, TransitionKind } from '../lib/types';
import { analyzeVibe } from '../lib/vibe';
import { BeatFlash } from './BeatFlash';
import { PlainLyrics } from './PlainLyrics';
import { STYLE_BY_ID } from './styles';
import { BreakVisualContext, Dots } from './styles/Dots';

interface Layer {
  key: number;
  track: TrackInfo;
  clock: Clock;
  phase: 'in' | 'live' | 'out';
  ms: number;
  kind: TransitionKind;
  expires: number;
}

function transitionLength(change: TrackChange, settings: Settings): number {
  const t = change.transition;
  if (t.kind === 'blend' && !settings.automixBlend) return visualTransitionMs({ ...t, kind: 'natural' }, settings.reduceMotion);
  return visualTransitionMs(t, settings.reduceMotion);
}

export function LyricsStage({
  engine,
  change,
  currentTrack,
  settings,
  onSeek,
}: {
  engine: Engine;
  change: TrackChange;
  /** The song playing now (its cover may arrive after the song change). */
  currentTrack: TrackInfo | null;
  settings: Settings;
  onSeek: (ms: number) => void;
}) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const lastSeq = useRef(-1);

  useEffect(() => {
    if (lastSeq.current === change.seq) return;
    lastSeq.current = change.seq;
    const ms = transitionLength(change, settings);
    const kind = change.transition.kind;
    const now = performance.now();
    setLayers((prev) => {
      const next = prev.filter((l) => l.phase === 'out' && l.expires > now);
      for (const l of prev) {
        if (l.phase === 'out') continue;
        // The ghost clock keeps the old song "playing" during a blend.
        const clock = change.ghost ?? new FixedClock(l.clock.now());
        next.push({ ...l, phase: 'out', clock, ms, kind, expires: now + ms });
      }
      if (change.track) {
        next.push({
          key: change.seq,
          track: change.track,
          clock: engine.clock,
          phase: kind === 'initial' ? 'live' : 'in',
          ms,
          kind,
          expires: Infinity,
        });
      }
      return next;
    });
    const timer = setTimeout(() => {
      const t = performance.now();
      setLayers((prev) => prev.filter((l) => l.phase !== 'out' || l.expires > t));
    }, ms + 100);
    return () => clearTimeout(timer);
  }, [change.seq]);

  return (
    <div className="lyrics-stage">
      {layers.map((layer) => (
        <LyricsLayer
          key={layer.key}
          layer={layer}
          // The playing song's details can arrive after the song change (cover, length): use the latest.
          track={currentTrack && layer.track.key === currentTrack.key ? currentTrack : layer.track}
          settings={settings}
          onSeek={onSeek}
        />
      ))}
    </div>
  );
}

function LyricsLayer({
  layer,
  track,
  settings,
  onSeek,
}: {
  layer: Layer;
  track: TrackInfo;
  settings: Settings;
  onSeek: (ms: number) => void;
}) {
  const { lyrics, loading, error, retry } = useLyrics(track);
  const { palette, ready } = usePalette(track.artUrl);
  const vibe = useMemo(() => analyzeVibe(lyrics, palette), [lyrics, palette]);
  const styleId = settings.style === 'auto' ? vibe.autoStyle : settings.style;
  const live = layer.phase !== 'out';
  // What the instrumental breaks show (bars or dots), shared with every lyric style below.
  const breakVisual = useMemo(
    () => ({ mode: settings.breakVisual, energy: vibe.energy, calm: settings.reduceMotion }),
    [settings.breakVisual, vibe.energy, settings.reduceMotion],
  );

  let body;
  if (loading || !ready) {
    body = <Message title="Finding lyrics…" icon={<Dots className="msg-dots is-loading" />} />;
  } else if (error) {
    body = (
      <Message title="Couldn't reach the lyrics service" subtitle="Check your internet connection.">
        <button className="btn" onClick={retry}>
          Try again
        </button>
      </Message>
    );
  } else if (!lyrics || lyrics.kind === 'none') {
    body = (
      <Message
        title="No lyrics for this one"
        subtitle={
          <>
            Lyrics come from{' '}
            <a href="https://lrclib.net" target="_blank" rel="noreferrer">
              LRCLIB
            </a>
            , a free community database — anyone can add missing songs.
          </>
        }
      />
    );
  } else if (lyrics.kind === 'instrumental') {
    body = <Message title="Instrumental" subtitle="Just vibes — no words in this one." icon={<span className="msg-note">♪</span>} />;
  } else if (lyrics.kind === 'plain') {
    body = <PlainLyrics lyrics={lyrics} clock={layer.clock} durationMs={track.durationMs} />;
  } else {
    const Style = STYLE_BY_ID[styleId].component;
    body = (
      <Style
        key={styleId}
        lyrics={lyrics}
        clock={layer.clock}
        vibe={vibe}
        palette={palette}
        offsetMs={settings.offsetMs}
        sweep={settings.wordSweep}
        reduceMotion={settings.reduceMotion}
        interactive={live}
        onSeek={onSeek}
      />
    );
  }

  const inMs = layer.kind === 'blend' ? layer.ms * 0.75 : layer.ms;
  const inDelay = layer.kind === 'blend' ? layer.ms * 0.15 : 0;
  return (
    <div
      className={`lyrics-layer phase-${layer.phase} kind-${layer.kind} style-${styleId}`}
      style={
        {
          '--ms': `${layer.ms}ms`,
          '--in-ms': `${Math.round(inMs)}ms`,
          '--in-delay': `${Math.round(inDelay)}ms`,
          '--accent': palette.accent,
          '--accent2': palette.accent2,
        } as CSSProperties
      }
      aria-hidden={!live}
    >
      {/* behind the lyrics: a soft flash on strong beats in the short pauses between lines */}
      {live && settings.beatFlash && !settings.reduceMotion && lyrics?.kind === 'synced' && (
        <BeatFlash lyrics={lyrics} clock={layer.clock} offsetMs={settings.offsetMs} energy={vibe.energy} />
      )}
      <BreakVisualContext.Provider value={breakVisual}>{body}</BreakVisualContext.Provider>
    </div>
  );
}

function Message({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="msg">
      {icon}
      <div className="msg-title">{title}</div>
      {subtitle && <div className="msg-sub">{subtitle}</div>}
      {children}
    </div>
  );
}
