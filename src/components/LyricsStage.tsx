// Holds one "layer" of lyrics per song. When songs change, the old layer fades
// out while the new one fades in. For Spotify Automix / Crossfade blends the
// fade lasts as long as the songs overlap, and the old song's lyrics keep
// moving in time while they fade — so the lyrics blend just like the audio.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useFrame, useLatest, useLyrics, usePalette, useTranslation } from '../hooks/hooks';
import { FixedClock, type Clock } from '../lib/clock';
import type { Engine, TrackChange } from '../lib/engine';
import { findLineIndex } from '../lib/lrc';
import type { Settings } from '../lib/settings';
import { useSongPrefs } from '../lib/songMemory';
import { showsScene } from '../lib/scene';
import { visualTransitionMs } from '../lib/transitions';
import type { Lyrics, TrackInfo, TransitionKind } from '../lib/types';
import { analyzeVibe } from '../lib/vibe';
import { BeatScene } from './BeatScene';
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
  nudge,
  settings,
  onSeek,
}: {
  engine: Engine;
  change: TrackChange;
  /** The song playing now (its cover may arrive after the song change). */
  currentTrack: TrackInfo | null;
  /** A timing nudge for the song with this key (see src/lib/nudge.ts). */
  nudge: { key: string | null; ms: number };
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
          nudgeMs={nudge.key !== null && nudge.key === layer.track.key ? nudge.ms : 0}
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
  nudgeMs,
  onSeek,
}: {
  layer: Layer;
  track: TrackInfo;
  settings: Settings;
  nudgeMs: number;
  onSeek: (ms: number) => void;
}) {
  const { lyrics, loading, error, retry } = useLyrics(track);
  const { palette, ready } = usePalette(track.artUrl);
  const vibe = useMemo(() => analyzeVibe(lyrics, palette), [lyrics, palette]);
  // A style remembered for this song wins (when remembering is on).
  const remembered = useSongPrefs(settings.rememberPerSong ? track.key : null);
  const choice = remembered?.style ?? settings.style;
  const styleId = choice === 'auto' ? vibe.autoStyle : choice;
  const translation = useTranslation(track, lyrics);
  const live = layer.phase !== 'out';
  // What the instrumental breaks show (bars or dots), shared with every lyric style below.
  const breakVisual = useMemo(
    () => ({ mode: settings.breakVisual, energy: vibe.energy, calm: settings.reduceMotion }),
    [settings.breakVisual, vibe.energy, settings.reduceMotion],
  );

  // Songs without lyrics (or instrumentals) get the beat scene, unless the user chose just a message.
  const sceneKind = showsScene(lyrics?.kind ?? 'none', settings.noLyricsVisual, settings.reduceMotion) ? settings.noLyricsVisual : null;

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
    const title = 'No lyrics for this one';
    const subtitle = (
      <>
        Lyrics come from{' '}
        <a href="https://lrclib.net" target="_blank" rel="noreferrer">
          LRCLIB
        </a>
        , a free community database — anyone can add missing songs.
      </>
    );
    body =
      sceneKind === 'orb' || sceneKind === 'bars' ? (
        <BeatScene visual={sceneKind} palette={palette} clock={layer.clock} energy={vibe.energy} title={title} subtitle={subtitle} />
      ) : (
        <Message title={title} subtitle={subtitle} />
      );
  } else if (lyrics.kind === 'instrumental') {
    const subtitle = 'Just vibes — no words in this one.';
    body =
      sceneKind === 'orb' || sceneKind === 'bars' ? (
        <BeatScene visual={sceneKind} palette={palette} clock={layer.clock} energy={vibe.energy} title="Instrumental" subtitle={subtitle} />
      ) : (
        <Message title="Instrumental" subtitle={subtitle} icon={<span className="msg-note">♪</span>} />
      );
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
        offsetMs={settings.offsetMs + nudgeMs}
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
      <BreakVisualContext.Provider value={breakVisual}>{body}</BreakVisualContext.Provider>
      {translation.lines && lyrics && lyrics.kind === 'synced' && (
        <TranslationCaption lyrics={lyrics} translated={translation.lines} clock={layer.clock} offsetMs={settings.offsetMs + nudgeMs} />
      )}
    </div>
  );
}

/** The translation of the line being sung, small, at the bottom of the screen. */
function TranslationCaption({
  lyrics,
  translated,
  clock,
  offsetMs,
}: {
  lyrics: Lyrics;
  translated: string[];
  clock: Clock;
  offsetMs: number;
}) {
  const [index, setIndex] = useState(-1);
  const p = useLatest({ lyrics, clock, offsetMs });
  const last = useRef(-1);
  useFrame((now) => {
    const { lyrics, clock, offsetMs } = p.current;
    const idx = findLineIndex(lyrics.lines, clock.now(now) + offsetMs);
    if (idx !== last.current) {
      last.current = idx;
      setIndex(idx);
    }
  });
  const text = index >= 0 ? translated[index] : '';
  if (!text) return null;
  return (
    <div className="translation" key={index} aria-label="Translation">
      {text}
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
