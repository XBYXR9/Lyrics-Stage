// The Spotify-style app: a menu on the left, the pages in the middle, the player at the bottom — and the Lyrics tab,
// which opens Lyrics Stage over everything with an animation. You sign in with Spotify; the music plays on any of your
// Spotify devices (or in this browser) and this app is the screen for browsing and the lyrics.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useEngineState, usePalette } from '../../hooks/hooks';
import { hasLibraryAccess } from '../../lib/auth';
import { catalogFor, type Profile } from '../../lib/catalog';
import type { Engine } from '../../lib/engine';
import { useSettings } from '../../lib/settings';
import { SleepOverlay, Stage, UpNext } from '../Stage';
import { Toasts } from '../Toasts';
import { AppContext, type AppContextValue } from './context';
import { LyricsOverlay, type OverlayPhase } from './LyricsOverlay';
import { routeKey, useRouter } from './nav';
import { PlayerBar } from './PlayerBar';
import { Sidebar } from './Sidebar';
import { HomeView } from './views/HomeView';
import { AlbumView, ArtistView, PlaylistView } from './views/DetailViews';
import { LibraryView, LikedView } from './views/LibraryViews';
import { QueueView } from './views/QueueView';
import { SearchView } from './views/SearchView';
import { SettingsView } from './views/SettingsView';

type Lyrics = { phase: OverlayPhase; origin: DOMRect | null } | null;

export function AppShell({ engine, onSignOut, reconnect }: { engine: Engine; onSignOut: () => void; reconnect: () => void }) {
  const catalog = useMemo(() => catalogFor(engine.isDemo), [engine]);
  const router = useRouter();
  const state = useEngineState(engine);
  const settings = useSettings();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lyrics, setLyrics] = useState<Lyrics>(null);
  const main = useRef<HTMLElement>(null);
  // The colors of the pages follow the cover of the song that plays.
  const { palette } = usePalette(state.track?.artUrl);

  useEffect(() => {
    let alive = true;
    catalog.profile().then((p) => alive && setProfile(p), () => {});
    return () => {
      alive = false;
    };
  }, [catalog]);

  // Every page starts at the top.
  const page = routeKey(router.route);
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [page]);

  const openLyrics = useCallback(() => {
    const cover = document.querySelector('.pb-cover');
    setLyrics((cur) => cur ?? { phase: 'open', origin: cover ? cover.getBoundingClientRect() : null });
  }, []);
  const closeLyrics = useCallback(() => {
    // The cover may have moved (a different window size): aim at where it is now.
    const cover = document.querySelector('.pb-cover');
    setLyrics((cur) => (cur ? { phase: 'closing', origin: cover ? cover.getBoundingClientRect() : cur.origin } : cur));
  }, []);

  // Space plays and pauses, L opens the lyrics (when not typing somewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (lyrics || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return;
      if (e.key === ' ' && el.tagName !== 'BUTTON') {
        e.preventDefault();
        void engine.togglePlay().catch(() => {});
      } else if (e.key.toLowerCase() === 'l') openLyrics();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, lyrics, openLyrics]);

  const ctx: AppContextValue = {
    engine,
    catalog,
    router,
    profile,
    openLyrics,
    onSignOut,
    reconnect,
    needsReconnect: !engine.isDemo && !hasLibraryAccess(),
  };
  const r = router.route;
  return (
    <AppContext.Provider value={ctx}>
      <div className={`shell${settings.reduceMotion ? ' calm-ui' : ''}`} style={{ '--accent': palette.accent, '--accent2': palette.accent2 } as CSSProperties}>
        <Sidebar />
        <main className="shell-main" ref={main}>
          {router.canBack && (
            <button className="btn small back-btn" onClick={router.back}>
              ‹ Back
            </button>
          )}
          {ctx.needsReconnect && r.view !== 'settings' && (
            <div className="banner">
              Sign in with Spotify again to see your playlists, liked songs and more (this login is from an older version).{' '}
              <button className="btn small" onClick={reconnect}>
                Sign in again
              </button>
            </div>
          )}
          {r.view === 'home' && <HomeView />}
          {r.view === 'search' && <SearchView key={routeKey(r)} initial={r.q} />}
          {r.view === 'library' && <LibraryView />}
          {r.view === 'liked' && <LikedView />}
          {r.view === 'queue' && <QueueView />}
          {r.view === 'settings' && <SettingsView />}
          {r.view === 'playlist' && <PlaylistView key={r.id} id={r.id} />}
          {r.view === 'album' && <AlbumView key={r.id} id={r.id} />}
          {r.view === 'artist' && <ArtistView key={r.id} id={r.id} />}
        </main>
        <PlayerBar />

        {!lyrics && state.track && state.nextTrack && (
          <UpNext engine={engine} track={state.track} next={state.nextTrack} playing={state.isPlaying} blendExpected={state.change.transition.kind === 'blend'} />
        )}

        {lyrics && (
          <LyricsOverlay phase={lyrics.phase} origin={lyrics.origin} reduceMotion={settings.reduceMotion} onExited={() => setLyrics(null)}>
            <Stage engine={engine} onSignOut={onSignOut} onBack={closeLyrics} inShell />
          </LyricsOverlay>
        )}
        <SleepOverlay engine={engine} />
        <Toasts />
      </div>
    </AppContext.Provider>
  );
}
