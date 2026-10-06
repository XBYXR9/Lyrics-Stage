// The main screen: background, player panel, lyrics, top bar and panels.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useBeatFlash, useRealSound } from '../hooks/beatHooks';
import { useEngineState, useKeepAwake, useLyrics, usePalette, usePresence, useRecordFrame } from '../hooks/hooks';
import { loginStaysInApp, startLogin } from '../lib/auth';
import { desktopApi, MUSIC_APP_LABEL, type MusicApp, type UpdateStatus } from '../lib/desktopTypes';
import type { Engine, SpotifyAppStatus } from '../lib/engine';
import { prefetchLyrics } from '../lib/lyrics';
import { motionHintText, takeMotionHint } from '../lib/motionHint';
import { isNativeApp, onNativeBack, setSystemBarsHidden } from '../lib/nativeApp';
import { describeNudge, nudgeBy } from '../lib/nudge';
import { forgetSong, getSongPrefs, rememberSong, useSongPrefs } from '../lib/songMemory';
import { finishSleepTimer, formatLeft, getSleepState, sleepDim, SLEEP_FADE_MS, useSleepState, wakeFromSleep } from '../lib/sleepTimer';
import { useWallpaper } from '../lib/wallpaper';
import { showsScene } from '../lib/scene';
import { FALLBACK_PALETTE, getPalette, loadImage } from '../lib/palette';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { friendlyError } from '../lib/spotify';
import { appVersion, isWatchingTiming, logTiming, sec } from '../lib/timingLog';
import { coverMergeBlocker, visualTransitionMs } from '../lib/transitions';
import type { Palette, StyleChoice, TrackInfo } from '../lib/types';
import { analyzeVibe } from '../lib/vibe';
import { Background } from './Background';
import { CardPanel } from './CardPanel';
import { CardIcon, CloseIcon, ExpandIcon, LyricsIcon, PortraitIcon, SearchIcon, SettingsIcon, SparkleIcon } from './Icons';
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
  const wallpaper = useWallpaper();
  const [panel, setPanel] = useState<'search' | 'settings' | 'card' | null>(null);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const native = isNativeApp();
  // The recording view: a full-screen 9:16 frame with no buttons, to record for TikTok.
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const recFrame = useRecordFrame(recording);
  const startRecording = useCallback(() => {
    setPanel(null);
    setRecording(true);
  }, []);
  const track = state.track;
  // A timing nudge for the song playing now (keys , and .): only changes when the lyrics show, and ends with the song.
  const [songNudge, setSongNudge] = useState<{ key: string | null; ms: number }>({ key: null, ms: 0 });
  const nudgeRef = useRef(songNudge);
  nudgeRef.current = songNudge;
  const trackKeyRef = useRef<string | null>(null);
  trackKeyRef.current = track?.key ?? null;
  // With "Remember for each song" on, the nudge (and the lyric style) of a song come back the next time it plays.
  const remembered = useSongPrefs(settings.rememberPerSong ? (track?.key ?? null) : null);
  const nudgeMs = track && songNudge.key === track.key ? songNudge.ms : (remembered?.nudgeMs ?? 0);
  /** Shows the lyrics later (negative) or earlier (positive) for the song playing now; keys , . < > and the buttons in Settings. */
  const nudgeLyrics = useCallback((deltaMs: number) => {
    const key = trackKeyRef.current;
    if (!key) return;
    const saved = getSettings().rememberPerSong ? (getSongPrefs(key)?.nudgeMs ?? 0) : 0;
    const base = nudgeRef.current.key === key ? nudgeRef.current.ms : saved;
    const ms = nudgeBy(base, deltaMs);
    setSongNudge({ key, ms });
    if (getSettings().rememberPerSong) rememberSong(key, { nudgeMs: ms });
    toast(describeNudge(ms));
  }, []);
  /** Back to normal timing for the song playing now (and forgets the saved nudge). */
  const resetNudge = useCallback(() => {
    const key = trackKeyRef.current;
    setSongNudge({ key, ms: 0 });
    if (key) rememberSong(key, { nudgeMs: 0 });
  }, []);
  const hideControls = useHideControlsInFullscreen(panel !== null);

  // Switching "lyrics only" on slides the cover and player away; switching it off brings them back.
  const presence = usePresence(!settings.lyricsOnly, settings.reduceMotion ? 0 : PANEL_EXIT_MS);
  const showPanel = !!track && presence.mounted && !recording;
  const panelLeaving = presence.leaving;
  useEffect(() => {
    // The lyrics area changed width: lyric styles that measure themselves look again.
    if (settings.reduceMotion) return;
    const id = setTimeout(() => window.dispatchEvent(new Event('resize')), PANEL_EXIT_MS + 60);
    return () => clearTimeout(id);
  }, [settings.lyricsOnly]);

  // The recording view goes full screen (on the phone, the status and navigation bars hide instead) and ends when
  // fullscreen ends (Esc). The things that measure themselves look again when the frame appears and goes away.
  useEffect(() => {
    if (!recording) return;
    const alreadyFullscreen = !!document.fullscreenElement;
    let wasFullscreen = alreadyFullscreen;
    const onChange = () => {
      if (document.fullscreenElement) wasFullscreen = true;
      else if (wasFullscreen) setRecording(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    if (native) setSystemBarsHidden(true);
    else if (!alreadyFullscreen) void document.documentElement.requestFullscreen?.().catch(() => {});
    const looked = setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
    return () => {
      clearTimeout(looked);
      document.removeEventListener('fullscreenchange', onChange);
      if (native) setSystemBarsHidden(false);
      else if (!alreadyFullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
    };
  }, [recording, native]);

  // Android app: keep the screen on while a song plays, and let the back button close a panel before it leaves the app.
  // The recording view keeps the screen on everywhere, so it doesn't go dark in the middle of a take.
  useKeepAwake((native || recording) && state.isPlaying);
  useEffect(() => {
    if (!native) return;
    return onNativeBack(() => {
      if (recordingRef.current) {
        setRecording(false);
        return true;
      }
      if (!panelRef.current) return false;
      setPanel(null);
      return true;
    });
  }, [native]);

  const { palette, ready } = usePalette(track?.artUrl);
  const { lyrics } = useLyrics(track);
  const vibe = useMemo(() => (track ? analyzeVibe(lyrics, palette) : null), [track, lyrics, palette]);

  // Beat effects. Everything that reacts to the sound or to the beat only counts inside the song's playback window.
  const fxRef = useRef<HTMLDivElement>(null);
  const kickRef = useRef<HTMLDivElement>(null);
  const song = { clock: engine.clock, durationMs: track?.durationMs ?? 0, active: !!track && state.status !== 'ad' };
  const sceneShown = song.active && showsScene(lyrics?.kind ?? null, settings.noLyricsVisual, settings.reduceMotion);
  const usesBeats =
    !settings.reduceMotion && (settings.beatStyle !== 'off' || settings.breakVisual === 'bars' || settings.noLyricsVisual !== 'message' || settings.backgroundBeat);
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
      fast: settings.fastFlashes,
      background: settings.backgroundBeat,
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

  // For the timing report, and a note when a setting is why the covers don't merge (otherwise it just looks broken).
  useEffect(() => {
    if (change.seq === 0) return;
    const blocker = coverMergeBlocker(change, settings);
    const systemReduces = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    logTiming(
      `change #${change.seq} (${change.transition.kind}): song-change animation ${transitionMs} ms${settings.reduceMotion ? ' (Reduce motion is on)' : ''}, cover merge ${
        blocker ? `off (${blocker})` : showPanel ? 'on' : 'on, but the player panel is hidden (Lyrics only)'
      }`,
    );
    const hint = change.transition.kind === 'blend' ? motionHintText(blocker, systemReduces) : null;
    if (hint && takeMotionHint()) toast(hint, 'info', 9000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change.seq]);

  // Get the next song's lyrics and colors ready before it starts.
  const next = state.nextTrack;
  useEffect(() => {
    if (!next) return;
    prefetchLyrics(next);
    void getPalette(next.artUrl);
    if (next.artUrl) loadImage(next.artUrl).catch(() => {});
  }, [next]);

  /** Picks a lyric style: for every song, and (with "Remember for each song") for the song playing now. */
  const pickStyle = useCallback((choice: StyleChoice) => {
    updateSettings({ style: choice });
    const key = trackKeyRef.current;
    if (key && getSettings().rememberPerSong) rememberSong(key, { style: choice });
  }, []);
  const cycleStyle = () => {
    const key = trackKeyRef.current;
    const cur = (getSettings().rememberPerSong && key ? getSongPrefs(key)?.style : undefined) ?? getSettings().style;
    const nextStyle = STYLE_ORDER[(STYLE_ORDER.indexOf(cur) + 1) % STYLE_ORDER.length];
    pickStyle(nextStyle);
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
        case 'r':
          if (recordingRef.current) setRecording(false);
          else startRecording();
          break;
        // The recording view shows nothing but the lyrics: no panels, no fullscreen switch.
        case '/':
          e.preventDefault();
          if (!recordingRef.current) setPanel('search');
          break;
        case 's':
          if (!recordingRef.current) setPanel((p) => (p === 'settings' ? null : 'settings'));
          break;
        case 'l':
          if (!recordingRef.current) updateSettings({ lyricsOnly: !getSettings().lyricsOnly });
          break;
        case 'c':
          if (!recordingRef.current && engine.getState().track) setPanel((p) => (p === 'card' ? null : 'card'));
          break;
        case 'f':
          if (!recordingRef.current) toggleFullscreen();
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
          const step = e.key === ',' || e.key === '.' ? 500 : 100;
          nudgeLyrics(e.key === '.' || e.key === '>' ? step : -step);
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
          setRecording(false);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, nudgeLyrics, startRecording]);

  // The web version leaves the page to log in again; the desktop app logs in through the browser and restarts the connection.
  const reconnect = async () => {
    try {
      const err = await startLogin();
      if (!loginStaysInApp()) return;
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

  const styleChoice = remembered?.style ?? settings.style;
  const currentStyle = styleChoice === 'auto' ? vibe?.autoStyle ?? 'apple' : styleChoice;
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
    `re-sync after a blend: ${engine.describeBlendBias()}`,
    `motion: reduceMotion=${settings.reduceMotion ? 'on' : 'off'} system=${window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'animations off' : 'animations on'} lyricsOnly=${settings.lyricsOnly ? 'on' : 'off'}`,
    `typical blend seen: ${sec(state.typicalBlendMs)}s`,
    `now: ${track ? `"${track.name}" clock=${sec(engine.clock.now())} of ${sec(track.durationMs)} playing=${state.isPlaying ? 1 : 0} nudge=${sec(nudgeMs)}s` : 'no song'}`,
  ];

  // Tell the engine whether to correct the song position after an Automix / Crossfade hand-over.
  useEffect(() => engine.setBlendTimingFix(settings.fixBlendTiming), [engine, settings.fixBlendTiming]);
  useEffect(() => engine.setResyncAfterBlend(settings.resyncAfterBlend), [engine, settings.resyncAfterBlend]);

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
    content = <DesktopIdle musicApp={settings.musicApp} app={state.spotifyApp} onDemo={onDemo} onSignIn={onSignIn} />;
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
        nudge={{ key: track?.key ?? null, ms: nudgeMs }}
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
    ...(recording ? { '--rec-w': `${recFrame.width}px`, '--rec-h': `${recFrame.height}px` } : null),
  } as CSSProperties;

  return (
    <div
      className={`stage current-${currentStyle}${desktop ? ` is-desktop platform-${desktop.platform}` : ''}${native ? ' is-native' : ''}${recording ? ' rec' : ''}${settings.lyricsOnly ? ' lyrics-only' : ''}${panel ? ' panel-open' : ''}${
        track ? '' : ' no-track'
      }${hideControls ? ' controls-hidden' : ''}${settings.reduceMotion ? ' calm-ui' : ''}`}
      style={stageStyle}
    >
      {/* Everything that is part of the picture. In the recording view this is the 9:16 frame in the middle of the screen. */}
      <div className="stage-frame">
        <Background
          artUrl={scene.url}
          palette={scene.palette}
          mode={settings.background}
          wallpaper={wallpaper}
          motion={vibe?.motion ?? 0.8}
          transitionMs={transitionMs}
          reduceMotion={settings.reduceMotion}
          beatMotion={settings.backgroundBeat}
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

        {recording && settings.recordInfo && track && (
          <div className="rec-hud" key={track.key}>
            {track.artUrl && <img className="rec-cover" src={track.artUrl} alt="" />}
            <div className="rec-meta">
              <div className="rec-title">{track.name}</div>
              <div className="rec-artist">{track.artists.join(', ')}</div>
            </div>
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
      </div>

      {recording && (
        <>
          <button className="rec-exit" onClick={() => setRecording(false)} aria-label="Leave the recording view" title="Leave (Esc)">
            <CloseIcon />
          </button>
          <div className="rec-hint" role="status">
            Recording view · {recFrame.width} × {recFrame.height} · {native ? 'Back' : 'Esc'} to leave
          </div>
        </>
      )}

      {!recording && (
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
              onClick={resetNudge}
              title="Back to normal timing for this song"
            >
              {describeNudge(nudgeMs)} · Reset
            </button>
          )}
          {engine.isDemo && <span className="pill hide-mobile">Demo · no sound</span>}
          {state.problem && !state.authExpired && <span className="pill warn">{state.problem}</span>}
          {desktop && track && state.spotifyApp && !state.spotifyApp.running && (
            <span className="pill warn">{MUSIC_APP_LABEL[settings.musicApp]} is closed</span>
          )}
          {desktop && track && state.spotifyApp?.running && !state.spotifyApp.exactPosition && (
            <span className="pill hide-mobile" title="This app doesn't share the song position, so timing starts when each song starts. Tap a lyric line to sync.">
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
            <span>{styleChoice === 'auto' ? `Auto · ${styleName(currentStyle)}` : styleName(styleChoice)}</span>
          </button>
          <button
            className={`icon-btn${settings.lyricsOnly ? ' on' : ''}`}
            onClick={() => updateSettings({ lyricsOnly: !settings.lyricsOnly })}
            aria-label="Lyrics only"
            title="Lyrics only (L)"
          >
            <LyricsIcon />
          </button>
          {track && (
            <button className="icon-btn" onClick={() => setPanel(panel === 'card' ? null : 'card')} aria-label="Lyric card" title="Lyric card to share (C)">
              <CardIcon />
            </button>
          )}
          <button className="icon-btn" onClick={() => setPanel(panel === 'settings' ? null : 'settings')} aria-label="Settings" title="Settings (S)">
            <SettingsIcon />
          </button>
          <button className="icon-btn" onClick={startRecording} aria-label="Record for TikTok" title="Recording view for TikTok, 9:16 (R)">
            <PortraitIcon />
          </button>
          <button className="icon-btn hide-mobile" onClick={toggleFullscreen} aria-label="Fullscreen" title="Fullscreen (F)">
            <ExpandIcon />
          </button>
        </header>
      )}

      {panel === 'search' && <SearchPanel engine={engine} onClose={() => setPanel(null)} />}
      {panel === 'card' && track && (
        <CardPanel track={track} lyrics={lyrics} appStyle={currentStyle} playingMs={engine.clock.now() + settings.offsetMs + nudgeMs} onClose={() => setPanel(null)} />
      )}
      {panel === 'settings' && (
        <SettingsPanel
          settings={settings}
          styleChoice={styleChoice}
          onPickStyle={pickStyle}
          songKey={track?.key ?? null}
          onForgetSong={() => track && forgetSong(track.key)}
          vibe={vibe}
          typicalBlendMs={state.typicalBlendMs}
          engineKind={engine.kind}
          onClose={() => setPanel(null)}
          onSignOut={onSignOut}
          onSignIn={onSignIn}
          timingHeader={timingHeader}
          songNudgeMs={nudgeMs}
          onNudge={nudgeLyrics}
          onResetNudge={resetNudge}
          onRecord={startRecording}
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
      {!recording && track && state.nextTrack && (
        <UpNext
          engine={engine}
          track={track}
          next={state.nextTrack}
          playing={state.isPlaying}
          // After an Automix blend the next handover is most likely a blend too, so no card then.
          blendExpected={change.transition.kind === 'blend'}
        />
      )}
      <SleepOverlay engine={engine} />
      <Toasts />
    </div>
  );
}

/** How long before the end of a song the "Up next" card shows. */
export const UP_NEXT_MS = 5000;

/** A small card in the bottom corner for the last 5 seconds of a song: the next song and its cover. Not for Automix. */
function UpNext({
  engine,
  track,
  next,
  playing,
  blendExpected,
}: {
  engine: Engine;
  track: TrackInfo;
  next: TrackInfo;
  playing: boolean;
  blendExpected: boolean;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (blendExpected || !playing || track.durationMs <= 0 || next.key === track.key) {
      setShow(false);
      return;
    }
    const tick = () => {
      const left = track.durationMs - engine.clock.now();
      setShow(left > 0 && left <= UP_NEXT_MS);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [engine, track.key, track.durationMs, next.key, playing, blendExpected]);
  if (!show) return null;
  return (
    <div className="up-next glass" role="status" key={next.key}>
      {next.artThumbUrl || next.artUrl ? <img src={next.artThumbUrl ?? next.artUrl ?? ''} alt="" /> : <span className="up-next-art" />}
      <div className="up-next-text">
        <div className="up-next-label">Up next</div>
        <div className="up-next-title">{next.name}</div>
        <div className="up-next-artist">{next.artists.join(', ')}</div>
      </div>
    </div>
  );
}

/**
 * The sleep timer: the screen dims over the last minute, then the music pauses and the screen goes dark until it is
 * touched. The timer itself lives in src/lib/sleepTimer.ts (it is started in Settings).
 */
function SleepOverlay({ engine }: { engine: Engine }) {
  const sleep = useSleepState();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (sleep.endsAt === null) return;
    let warned = false;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const left = (getSleepState().endsAt ?? Infinity) - t;
      if (left <= 0) {
        finishSleepTimer();
        if (engine.getState().isPlaying) void engine.togglePlay().catch(() => {});
      } else if (left <= SLEEP_FADE_MS && !warned) {
        warned = true;
        toast(`Sleep timer: the music pauses in ${formatLeft(left)}`);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sleep.endsAt, engine]);
  useEffect(() => {
    if (!sleep.done) return;
    const wake = () => wakeFromSleep();
    window.addEventListener('keydown', wake);
    return () => window.removeEventListener('keydown', wake);
  }, [sleep.done]);
  const dim = sleepDim(sleep.endsAt, sleep.done, now);
  if (dim <= 0) return null;
  return (
    <div className={`sleep-dim${sleep.done ? ' done' : ''}`} style={{ opacity: dim }} onPointerDown={sleep.done ? wakeFromSleep : undefined}>
      {sleep.done && <span>Good night. Tap anywhere to wake the screen.</span>}
    </div>
  );
}

/** What the desktop app shows while nothing is playing in the Spotify app. */
function DesktopIdle({
  musicApp,
  app,
  onDemo,
  onSignIn,
}: {
  musicApp: MusicApp;
  app: SpotifyAppStatus | null;
  onDemo?: () => void;
  onSignIn?: () => void;
}) {
  const name = MUSIC_APP_LABEL[musicApp];
  const open = () => void (musicApp === 'spotify' ? desktopApi()?.openSpotify() : desktopApi()?.openMusicApp(musicApp));
  let title = `Play something in ${name}`;
  let sub =
    musicApp === 'spotify'
      ? 'Your lyrics show up here as soon as a song starts. Turn on Automix in Spotify (Settings → Playback) and the lyrics blend right along with it.'
      : 'Your lyrics show up here as soon as a song starts.';
  if (app?.problem) {
    title = 'One more step';
    sub = app.problem;
  } else if (!app?.running) {
    title = `Open ${name} to start`;
    sub =
      musicApp === 'spotify'
        ? 'Log in to the Spotify app the usual way and play a song. Lyrics Stage follows along — no extra login needed.'
        : musicApp === 'apple'
          ? 'Play a song in the Apple Music app. Lyrics Stage follows along — no login needed.'
          : 'Play a song on music.youtube.com (in your browser, or in a YouTube Music app). Lyrics Stage follows whatever your computer shows as playing.';
  }
  return (
    <div className="msg idle">
      <div className="msg-title big">{title}</div>
      <div className="msg-sub">{sub}</div>
      <div className="msg-actions">
        <button className="btn primary" onClick={open}>
          Open {name}
        </button>
        {onSignIn && musicApp === 'spotify' && (
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
