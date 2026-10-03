// The main screen: background, player panel, lyrics, top bar and panels.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useBeatFlash, useRealSound } from '../hooks/beatHooks';
import { useEngineState, useLyrics, usePalette, usePresence } from '../hooks/hooks';
import { startLogin } from '../lib/auth';
import { desktopApi, type UpdateStatus } from '../lib/desktopTypes';
import type { Engine, SpotifyAppStatus } from '../lib/engine';
import { prefetchLyrics } from '../lib/lyrics';
import { describeNudge, nudgeBy } from '../lib/nudge';
import { showsScene } from '../lib/scene';
import { FALLBACK_PALETTE, getPalette, loadImage } from '../lib/palette';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { friendlyError } from '../lib/spotify';
import { appVersion, isWatchingTiming, logTiming, sec } from '../lib/timingLog';
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

/** Desktop app: where its own update stands (null in the browser). */
function useAppUpdate(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => desktopApi()?.onUpdate(setStatus), []);
  return status;
}

/** How long the cover and player take to slide away (matches the CSS animation). */
const PANEL_EXIT_MS = 600;

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

export function Stage({
  engine,
  onSignOut,
  onDemo,
  onSignIn,
}: {
  engine: Engine;
  onSignOut: () => void;
  onDemo?: () => void;
  /** Desktop app, while following the Spotify app on this computer: switch to signing in with Spotify. */
  onSignIn?: () => void;
}) {
  const state = useEngineState(engine);
  const settings = useSettings();
  const [panel, setPanel] = useState<'search' | 'settings' | null>(null);
  const [badge, setBadge] = useState<string | null>(null);
  const track = state.track;
  // A timing nudge for the song playing now (keys , and .): only changes when the lyrics show, and ends with the song.
  const [songNudge, setSongNudge] = useState<{ key: string | null; ms: number }>({ key: null, ms: 0 });
  const nudgeRef = useRef(songNudge);
  nudgeRef.current = songNudge;
  const trackKeyRef = useRef<string | null>(null);
  trackKeyRef.current = track?.key ?? null;
  const nudgeMs = track && songNudge.key === track.key ? songNudge.ms : 0;
  const hideControls = useHideControlsInFullscreen(panel !== null);

  // Switching "lyrics only" on slides the cover and player away; switching it off brings them back.
  const presence = usePresence(!settings.lyricsOnly, settings.reduceMotion ? 0 : PANEL_EXIT_MS);
  const showPanel = !!track && presence.mounted;
  const panelLeaving = presence.leaving;
  useEffect(() => {
    // The lyrics area changed width: lyric styles that measure themselves look again.
    if (settings.reduceMotion) return;
    const id = setTimeout(() => window.dispatchEvent(new Event('resize')), PANEL_EXIT_MS + 60);
    return () => clearTimeout(id);
  }, [settings.lyricsOnly]);

  const { palette, ready } = usePalette(track?.artUrl);
  const { lyrics } = useLyrics(track);
  const vibe = useMemo(() => (track ? analyzeVibe(lyrics, palette) : null), [track, lyrics, palette]);

  // Beat effects. Everything that reacts to the sound or to the beat only counts inside the song's playback window.
  const fxRef = useRef<HTMLDivElement>(null);
  const kickRef = useRef<HTMLDivElement>(null);
  const song = { clock: engine.clock, durationMs: track?.durationMs ?? 0, active: !!track && state.status !== 'ad' };
  const sceneShown = song.active && showsScene(lyrics?.kind ?? null, settings.noLyricsVisual, settings.reduceMotion);
  const usesBeats = !settings.reduceMotion && (settings.beatStyle !== 'off' || settings.breakVisual === 'bars' || settings.noLyricsVisual !== 'message');
  const canHearPc = desktopApi()?.platform === 'win32';
  useRealSound(canHearPc && settings.soundSync === 'on' && usesBeats, song, settings.soundDelayMs);
  useBeatFlash(
    { fx: fxRef, kick: kickRef },
    {
      style: settings.beatStyle,
      reduceMotion: settings.reduceMotion,
      lyrics,
      sceneShown,
      whileSinging: settings.flashWhileSinging,
      song,
      offsetMs: settings.offsetMs + nudgeMs,
      energy: vibe?.energy ?? 0.5,
    },
  );
  // Windows desktop app: ask once whether the effects may follow the computer's sound.
  const askSound = canHearPc && settings.soundSync === 'ask' && usesBeats && song.active;

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
        case ',':
        case '.':
        case '<':
        case '>': {
          const key = trackKeyRef.current;
          if (!key) break;
          const step = e.key === ',' || e.key === '.' ? 500 : 100;
          const base = nudgeRef.current.key === key ? nudgeRef.current.ms : 0;
          const ms = nudgeBy(base, e.key === '.' || e.key === '>' ? step : -step);
          setSongNudge({ key, ms });
          toast(describeNudge(ms));
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

  // The web version leaves the page to log in again; the desktop app logs in through the browser and restarts the connection.
  const reconnect = async () => {
    try {
      const err = await startLogin();
      if (!desktop) return;
      if (err) toast(err, 'error');
      else window.location.reload();
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

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
  // The desktop app window (whether it follows the Spotify app here or is signed in to Spotify).
  const desktop = desktopApi();
  const update = useAppUpdate();

  // Desktop app signed in to Spotify: also note what the Spotify app on this computer reports around song changes,
  // to compare with what Spotify's servers say (for the timing report).
  useEffect(() => {
    if (!desktop || engine.kind === 'desktop') return;
    let lastLoggedAt = 0;
    return desktop.onSnapshot((s) => {
      const now = performance.now();
      if (!isWatchingTiming() || now - lastLoggedAt < 500) return;
      lastLoggedAt = now;
      logTiming(`local app "${s.track?.title ?? '-'}" position=${s.positionMs === null ? 'n/a' : sec(s.positionMs)} playing=${s.playing ? 1 : 0}`);
    });
  }, [desktop, engine]);

  /** What the timing report starts with: where the numbers come from and which settings were on. */
  const timingHeader = () => [
    `version: ${appVersion()}`,
    `source: ${engine.kind}${desktop ? ` (desktop app, ${desktop.platform})` : ' (browser)'}`,
    `settings: offset=${sec(settings.offsetMs)}s blendFix=${settings.fixBlendTiming ? 'on' : 'off'} automixBlend=${settings.automixBlend ? 'on' : 'off'}`,
    `typical blend seen: ${sec(state.typicalBlendMs)}s`,
    `now: ${track ? `"${track.name}" clock=${sec(engine.clock.now())} of ${sec(track.durationMs)} playing=${state.isPlaying ? 1 : 0} nudge=${sec(nudgeMs)}s` : 'no song'}`,
  ];

  // Tell the engine whether to correct the song position after an Automix / Crossfade hand-over.
  useEffect(() => engine.setBlendTimingFix(settings.fixBlendTiming), [engine, settings.fixBlendTiming]);

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
    content = <DesktopIdle app={state.spotifyApp} onDemo={onDemo} onSignIn={onSignIn} />;
  } else if (!track) {
    content = (
      <div className="msg idle">
        <div className="msg-title big">Nothing is playing</div>
        <div className="msg-sub">Start a song in any Spotify app and it’ll show up here — or pick one now.</div>
        <div className="msg-actions">
          <button className="btn primary" onClick={() => setPanel('search')}>
            <SearchIcon width={18} height={18} /> Search a song
          </button>
          {engine.canPlayHere && state.browserPlayer.status !== 'ready' && (
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
        nudge={songNudge}
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
      }${hideControls ? ' controls-hidden' : ''}${settings.reduceMotion ? ' calm-ui' : ''}`}
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

      {/* behind the lyrics: the beat flash (its look is picked in Settings; the variables are set every frame) */}
      <div className="beat-fx" data-style={settings.beatStyle} ref={fxRef} aria-hidden>
        <div className="bf-glow" />
        <div className="bf-ring" />
        <div className="bf-screen" />
        <div className="bf-edges" />
      </div>

      <header className="topbar">
        {askSound && (
          <span
            className="pill ask-pill"
            role="group"
            aria-label="Follow the computer's sound?"
            title="The sound is only used while a song plays, analysed inside the app and never recorded or sent anywhere. You can change this in Settings."
          >
            <span>Make the effects follow your PC’s sound?</span>
            <button onClick={() => updateSettings({ soundSync: 'on' })}>Yes</button>
            <button onClick={() => updateSettings({ soundSync: 'off' })}>No thanks</button>
          </span>
        )}
        {nudgeMs !== 0 && (
          <button
            className="pill nudge-pill"
            onClick={() => setSongNudge({ key: null, ms: 0 })}
            title="Back to normal timing for this song"
          >
            {describeNudge(nudgeMs)} · Reset
          </button>
        )}
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
        {update?.state === 'ready' && (
          <button className="pill update-pill" onClick={() => void desktopApi()?.installUpdate()} title={`Restart to use version ${update.version}`}>
            Update ready · Restart
          </button>
        )}
        {update?.state === 'available' && (
          <a className="pill update-pill" href={update.url} target="_blank" rel="noreferrer" title="Opens the download page">
            Version {update.version} is out · Download
          </a>
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

      <main className={`stage-main${showPanel ? ' has-panel' : ''}`}>
        {showPanel && (
          <div className={`np-slot${panelLeaving ? ' leaving' : ''}`} inert={panelLeaving || undefined}>
            <NowPlaying engine={engine} state={state} />
          </div>
        )}
        <div className="stage-lyrics" ref={kickRef}>
          {content}
        </div>
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
          onSignIn={onSignIn}
          timingHeader={timingHeader}
        />
      )}

      {state.authExpired && (
        <div className="overlay">
          <div className="setup-card glass small">
            <h2>Spotify login expired</h2>
            <p className="tagline">Connect again to keep the lyrics going.</p>
            <button className="btn primary wide" onClick={reconnect}>
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
function DesktopIdle({ app, onDemo, onSignIn }: { app: SpotifyAppStatus | null; onDemo?: () => void; onSignIn?: () => void }) {
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
        {onSignIn && (
          <button className="btn ghost" onClick={onSignIn}>
            Sign in with Spotify
          </button>
        )}
        {onDemo && (
          <button className="btn ghost" onClick={onDemo}>
            Try the demo
          </button>
        )}
      </div>
    </div>
  );
}
