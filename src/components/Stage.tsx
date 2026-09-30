// The main screen: background, player panel, lyrics, top bar and panels.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useEngineState, useLyrics, usePalette } from '../hooks/hooks';
import { startLogin } from '../lib/auth';
import { desktopApi } from '../lib/desktopTypes';
import type { Engine, SpotifyAppStatus } from '../lib/engine';
import { prefetchLyrics } from '../lib/lyrics';
import { FALLBACK_PALETTE, getPalette, loadImage } from '../lib/palette';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { friendlyError } from '../lib/spotify';
import { visualTransitionMs } from '../lib/transitions';
import type { Palette, StyleChoice } from '../lib/types';
import { analyzeVibe } from '../lib/vibe';
import { Background } from './Background';
import { ExpandIcon, LyricsIcon, SearchIcon, SettingsIcon, SparkleIcon } from './Icons';
import { LyricsStage } from './LyricsStage';
import { NowPlaying, VOLUME_STEP } from './NowPlaying';
import { SearchPanel } from './SearchPanel';
import { SettingsPanel } from './SettingsPanel';
import { STYLES, styleName } from './styles';
import { Dots } from './styles/Dots';
import { toast, Toasts } from './Toasts';

const STYLE_ORDER: StyleChoice[] = ['auto', ...STYLES.map((s) => s.id)];
const run = (p: Promise<unknown>) => p.catch((e) => toast(friendlyError(e), 'error'));

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

/** In fullscreen, the buttons fade out after this long without mouse, touch or keyboard use. */
const HIDE_CONTROLS_AFTER_MS = 2500;

/** Page fullscreen (F) or the window's own fullscreen (e.g. the desktop app's green button on macOS). */
const isFullscreen = () =>
  !!document.fullscreenElement || (window.innerWidth >= screen.width && window.innerHeight >= screen.height);

/**
 * True while the buttons should be hidden: in fullscreen, after a few idle
 * seconds, unless a panel is open or the pointer rests on the controls.
 */
function useHideControlsInFullscreen(keepVisible: boolean): boolean {
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    const check = () => setFullscreen(isFullscreen());
    check();
    document.addEventListener('fullscreenchange', check);
    window.addEventListener('resize', check);
    return () => {
      document.removeEventListener('fullscreenchange', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  useEffect(() => {
    setIdle(false);
    if (!fullscreen || keepVisible) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let overControls = false;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => (overControls ? arm() : setIdle(true)), HIDE_CONTROLS_AFTER_MS);
    };
    const wake = (e: Event) => {
      overControls = !!(e.target as Element | null)?.closest?.('.topbar button, .np');
      setIdle(false);
      arm();
    };
    const events = ['mousemove', 'pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    events.forEach((name) => window.addEventListener(name, wake, { passive: true }));
    arm();
    return () => {
      clearTimeout(timer);
      events.forEach((name) => window.removeEventListener(name, wake));
    };
  }, [fullscreen, keepVisible]);

  return fullscreen && idle && !keepVisible;
}

export function Stage({ engine, onSignOut, onDemo }: { engine: Engine; onSignOut: () => void; onDemo?: () => void }) {
  const state = useEngineState(engine);
  const settings = useSettings();
  const [panel, setPanel] = useState<'search' | 'settings' | null>(null);
  const [badge, setBadge] = useState<string | null>(null);
  const track = state.track;
  const hideControls = useHideControlsInFullscreen(panel !== null);

  const { palette, ready } = usePalette(track?.artUrl);
  const { lyrics } = useLyrics(track);
  const vibe = useMemo(() => (track ? analyzeVibe(lyrics, palette) : null), [track, lyrics, palette]);

  // The background switches only once the new cover's colors are ready.
  const [scene, setScene] = useState<{ url: string | null; palette: Palette }>({ url: null, palette: FALLBACK_PALETTE });
  useEffect(() => {
    if (ready) setScene({ url: track?.artUrl ?? null, palette });
  }, [ready, palette, track?.artUrl]);

  const change = state.change;
  const blendOn = settings.automixBlend || change.transition.kind !== 'blend';
  const transitionMs = visualTransitionMs(
    blendOn ? change.transition : { ...change.transition, kind: 'natural' },
    settings.reduceMotion,
  );

  // Get the next song's lyrics and colors ready before it starts.
  const next = state.nextTrack;
  useEffect(() => {
    if (!next) return;
    prefetchLyrics(next);
    void getPalette(next.artUrl);
    if (next.artUrl) loadImage(next.artUrl).catch(() => {});
  }, [next]);

  // A little badge when an Automix / Crossfade blend is detected.
  useEffect(() => {
    const t = change.transition;
    if (t.kind !== 'blend' || !settings.automixBlend) return;
    setBadge(`Automix blend · ${(t.overlapMs / 1000).toFixed(1)}s`);
    const id = setTimeout(() => setBadge(null), Math.max(2600, t.overlapMs));
    return () => clearTimeout(id);
  }, [change.seq]);

  const cycleStyle = () => {
    const cur = getSettings().style;
    const nextStyle = STYLE_ORDER[(STYLE_ORDER.indexOf(cur) + 1) % STYLE_ORDER.length];
    updateSettings({ style: nextStyle });
    toast(`Style: ${styleName(nextStyle)}`);
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case ' ':
          if (el.closest('button')) return;
          e.preventDefault();
          void run(engine.togglePlay());
          break;
        case 'n':
          void run(engine.next());
          break;
        case 'p':
          void run(engine.previous());
          break;
        case '/':
          e.preventDefault();
          setPanel('search');
          break;
        case 's':
          setPanel((p) => (p === 'settings' ? null : 'settings'));
          break;
        case 'l':
          updateSettings({ lyricsOnly: !getSettings().lyricsOnly });
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'y':
          cycleStyle();
          break;
        case '-':
        case '=':
        case '+': {
          const delta = e.key === '-' ? -VOLUME_STEP : VOLUME_STEP;
          void engine
            .changeVolume(delta)
            .then(() => {
              const v = engine.getState().volume;
              if (v !== null) toast(`Spotify volume ${v}%`);
            })
            .catch((err) => toast(friendlyError(err), 'error'));
          break;
        }
        case '[':
        case ']': {
          const offsetMs = getSettings().offsetMs + (e.key === ']' ? 100 : -100);
          updateSettings({ offsetMs });
          toast(`Lyrics timing ${offsetMs > 0 ? '+' : ''}${(offsetMs / 1000).toFixed(1)}s`);
          break;
        }
        case 'escape':
          setPanel(null);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  const playHere = async () => {
    try {
      await engine.enableBrowserPlayer();
      const id = engine.getState().browserPlayer.deviceId;
      if (id) await engine.transferTo(id);
      setPanel('search');
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  const currentStyle = settings.style === 'auto' ? vibe?.autoStyle ?? 'apple' : settings.style;
  const desktop = engine.kind === 'desktop' ? desktopApi() : null;

  // Desktop app: keep the window above others if the user wants a lyrics "mini player".
  useEffect(() => {
    void desktop?.setAlwaysOnTop(settings.alwaysOnTop);
  }, [desktop, settings.alwaysOnTop]);

  let content;
  if (!track && state.status === 'connecting') {
    content = (
      <div className="msg">
        <Dots className="msg-dots is-loading" />
        <div className="msg-title">Connecting to Spotify…</div>
      </div>
    );
  } else if (!track && engine.kind === 'desktop') {
    content = <DesktopIdle app={state.spotifyApp} onDemo={onDemo} />;
  } else if (!track) {
    content = (
      <div className="msg idle">
        <div className="msg-title big">Nothing is playing</div>
        <div className="msg-sub">Start a song in any Spotify app and it’ll show up here — or pick one now.</div>
        <div className="msg-actions">
          <button className="btn primary" onClick={() => setPanel('search')}>
            <SearchIcon width={18} height={18} /> Search a song
          </button>
          {state.browserPlayer.status !== 'ready' && (
            <button className="btn ghost" onClick={playHere}>
              Play in this browser
            </button>
          )}
        </div>
      </div>
    );
  } else if (state.status === 'ad') {
    content = (
      <div className="msg">
        <div className="msg-title">Ad break</div>
        <div className="msg-sub">Lyrics will be back after this.</div>
      </div>
    );
  } else {
    content = (
      <LyricsStage
        engine={engine}
        change={change}
        currentTrack={track}
        settings={settings}
        onSeek={(ms) => void run(engine.seek(ms))}
      />
    );
  }

  const stageStyle = {
    '--font-scale': settings.fontScale,
    '--accent': palette.accent,
    '--accent2': palette.accent2,
    '--base': palette.base,
  } as CSSProperties;

  return (
    <div
      className={`stage current-${currentStyle}${desktop ? ` is-desktop platform-${desktop.platform}` : ''}${settings.lyricsOnly ? ' lyrics-only' : ''}${panel ? ' panel-open' : ''}${
        track ? '' : ' no-track'
      }${hideControls ? ' controls-hidden' : ''}`}
      style={stageStyle}
    >
      <Background
        artUrl={scene.url}
        palette={scene.palette}
        mode={settings.background}
        motion={vibe?.motion ?? 0.8}
        transitionMs={transitionMs}
        reduceMotion={settings.reduceMotion}
        shade={0.14 + scene.palette.brightness * 0.42}
      />

      <div
        className={`decor${currentStyle === 'neon' && track ? ' on' : ''}${settings.reduceMotion ? ' calm' : ''}`}
        style={{ '--motion': (vibe?.motion ?? 1).toFixed(2) } as CSSProperties}
        aria-hidden
      >
        {currentStyle === 'neon' && (
          <>
            <div className="ne-grid" />
            <div className="ne-scan" />
          </>
        )}
      </div>

      <header className="topbar">
        {engine.isDemo && <span className="pill hide-mobile">Demo · no sound</span>}
        {state.problem && !state.authExpired && <span className="pill warn">{state.problem}</span>}
        {desktop && track && state.spotifyApp && !state.spotifyApp.running && (
          <span className="pill warn">Spotify is closed</span>
        )}
        {desktop && track && state.spotifyApp?.running && !state.spotifyApp.exactPosition && (
          <span className="pill hide-mobile" title="Spotify's Linux app doesn't share the song position, so timing starts when each song starts. Tap a lyric line to sync.">
            Timing estimated · tap a line to sync
          </span>
        )}
        {settings.lyricsOnly && track && (
          <span className="lo-caption">
            {track.name} · {track.artists.join(', ')}
          </span>
        )}
        <div className="spacer" />
        <button className="icon-btn" onClick={() => setPanel(panel === 'search' ? null : 'search')} aria-label="Search" title="Search (/)">
          <SearchIcon />
        </button>
        <button className="style-btn" onClick={cycleStyle} title="Next lyrics style (Y)">
          <SparkleIcon width={16} height={16} />
          <span>{settings.style === 'auto' ? `Auto · ${styleName(currentStyle)}` : styleName(settings.style)}</span>
        </button>
        <button
          className={`icon-btn${settings.lyricsOnly ? ' on' : ''}`}
          onClick={() => updateSettings({ lyricsOnly: !settings.lyricsOnly })}
          aria-label="Lyrics only"
          title="Lyrics only (L)"
        >
          <LyricsIcon />
        </button>
        <button className="icon-btn" onClick={() => setPanel(panel === 'settings' ? null : 'settings')} aria-label="Settings" title="Settings (S)">
          <SettingsIcon />
        </button>
        <button className="icon-btn hide-mobile" onClick={toggleFullscreen} aria-label="Fullscreen" title="Fullscreen (F)">
          <ExpandIcon />
        </button>
      </header>

      {badge && (
        <div className="badge" role="status">
          <SparkleIcon width={14} height={14} /> {badge}
        </div>
      )}

      <main className="stage-main">
        {!settings.lyricsOnly && <NowPlaying engine={engine} state={state} />}
        <div className="stage-lyrics">{content}</div>
      </main>

      {panel === 'search' && <SearchPanel engine={engine} onClose={() => setPanel(null)} />}
      {panel === 'settings' && (
        <SettingsPanel
          settings={settings}
          vibe={vibe}
          typicalBlendMs={state.typicalBlendMs}
          engineKind={engine.kind}
          onClose={() => setPanel(null)}
          onSignOut={onSignOut}
        />
      )}

      {state.authExpired && (
        <div className="overlay">
          <div className="setup-card glass small">
            <h2>Spotify login expired</h2>
            <p className="tagline">Connect again to keep the lyrics going.</p>
            <button className="btn primary wide" onClick={() => void startLogin()}>
              Reconnect Spotify
            </button>
          </div>
        </div>
      )}
      <Toasts />
    </div>
  );
}

/** What the desktop app shows while nothing is playing in the Spotify app. */
function DesktopIdle({ app, onDemo }: { app: SpotifyAppStatus | null; onDemo?: () => void }) {
  const open = () => void desktopApi()?.openSpotify();
  let title = 'Play something in Spotify';
  let sub = 'Your lyrics show up here as soon as a song starts. Turn on Automix in Spotify (Settings → Playback) and the lyrics blend right along with it.';
  if (app?.problem) {
    title = 'One more step';
    sub = app.problem;
  } else if (!app?.running) {
    title = 'Open Spotify to start';
    sub = 'Log in to the Spotify app the usual way and play a song. Lyrics Stage follows along — no extra login needed.';
  }
  return (
    <div className="msg idle">
      <div className="msg-title big">{title}</div>
      <div className="msg-sub">{sub}</div>
      <div className="msg-actions">
        <button className="btn primary" onClick={open}>
          Open Spotify
        </button>
        {onDemo && (
          <button className="btn ghost" onClick={onDemo}>
            Try the demo
          </button>
        )}
      </div>
    </div>
  );
}
