import { useEffect, useMemo, useState } from 'react';
import { AppShell } from './components/app/AppShell';
import { Setup } from './components/Setup';
import { Stage } from './components/Stage';
import { toast, Toasts } from './components/Toasts';
import { finishLaunchLogin, handleRedirect, isLoggedIn, loginStaysInApp, logout, startLogin } from './lib/auth';
import { clearCatalogCache } from './lib/catalog';
import { DemoEngine } from './lib/demo';
import { DesktopEngine } from './lib/desktopEngine';
import { desktopApi } from './lib/desktopTypes';
import { SpotifyEngine, type Engine } from './lib/engine';
import { isNativeApp } from './lib/nativeApp';
import { getSettings, useSettings } from './lib/settings';
import { friendlyError } from './lib/spotify';

// "desktop": the desktop app, following the music app on this computer (no login; the plain lyrics screen).
// "spotify": signed in to Spotify, using the Spotify Web API (needs a developer
//            app): the Spotify-style app (home, library, search, player and the
//            Lyrics tab). The web version and the Android app always work this
//            way; the desktop app starts with the sign-in and does too.
type Mode = 'loading' | 'setup' | 'spotify' | 'desktop' | 'demo';

const DEMO_KEY = 'ls.demo';
/** Desktop app: "account" after signing in with Spotify, otherwise follow the Spotify app on this computer. */
const SOURCE_KEY = 'ls.desktopSource';

function signedInOnDesktop(): boolean {
  try {
    return localStorage.getItem(SOURCE_KEY) === 'account' && isLoggedIn();
  } catch {
    return false;
  }
}

function setDesktopSource(source: 'account' | 'app' | null) {
  try {
    if (source) localStorage.setItem(SOURCE_KEY, source);
    else localStorage.removeItem(SOURCE_KEY);
  } catch {
    /* ignore */
  }
}

/** Desktop app: has the person chosen to follow the app on this computer instead of signing in? */
function followsAppOnDesktop(): boolean {
  try {
    return localStorage.getItem(SOURCE_KEY) === 'app';
  } catch {
    return false;
  }
}

function initialMode(): Mode {
  const params = new URLSearchParams(window.location.search);
  let demo = params.has('demo');
  try {
    demo ||= sessionStorage.getItem(DEMO_KEY) === '1';
  } catch {
    /* ignore */
  }
  if (demo) return 'demo';
  if (desktopApi()) {
    // Apple Music and YouTube Music are followed on this computer. For Spotify the app starts with the sign-in,
    // unless the person chose to follow the Spotify app instead.
    if (getSettings().musicApp !== 'spotify') return 'desktop';
    if (signedInOnDesktop()) return 'spotify';
    return followsAppOnDesktop() ? 'desktop' : 'setup';
  }
  if (window.location.pathname === '/callback') return 'loading';
  if (isLoggedIn()) return 'spotify';
  return 'setup';
}

function setDemoFlag(on: boolean) {
  try {
    if (on) sessionStorage.setItem(DEMO_KEY, '1');
    else sessionStorage.removeItem(DEMO_KEY);
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [error, setError] = useState<string | null>(null);

  // Android app: if Spotify's answer opened the app from scratch (Android had closed it while the browser was in
  // front), finish that login now.
  useEffect(() => {
    if (!isNativeApp()) return;
    void finishLaunchLogin().then((result) => {
      if (result === null) return;
      setError(result || null);
      if (!result && isLoggedIn()) setMode('spotify');
    });
  }, []);

  // Web version: finish the Spotify login if we just came back from it.
  useEffect(() => {
    if (mode !== 'loading') return;
    void handleRedirect().then((err) => {
      setError(err);
      setMode(!err && isLoggedIn() ? 'spotify' : 'setup');
    });
  }, [mode]);

  // Desktop app: tell it which music app to follow (and again whenever that is changed in Settings).
  const { musicApp } = useSettings();
  useEffect(() => {
    void desktopApi()?.setMusicApp(musicApp);
    // Signed in to Spotify's own data only makes sense for Spotify: other apps are followed on this computer.
    if (musicApp !== 'spotify' && desktopApi()) setMode((m) => (m === 'spotify' ? 'desktop' : m));
  }, [musicApp]);

  // Only the follow-the-app mode cares which music app it is; changing it must not restart a signed-in session.
  const followedApp = mode === 'desktop' ? musicApp : 'spotify';
  const engine: Engine | null = useMemo(() => {
    // The music plays in the app's own player (Spotify's Web Playback SDK). The desktop app and the phone app check that
    // copy protection (DRM) is available before they try (see src/lib/drm.ts).
    if (mode === 'spotify') return new SpotifyEngine({ browserPlayer: true });
    if (mode === 'demo') return new DemoEngine();
    const api = desktopApi();
    if (mode === 'desktop' && api) return new DesktopEngine(api, undefined, followedApp);
    return null;
  }, [mode, followedApp]);

  useEffect(() => {
    if (!engine) return;
    engine.start();
    return () => engine.stop();
  }, [engine]);

  const startDemo = () => {
    setDemoFlag(true);
    setMode('demo');
  };

  const signOut = () => {
    setDemoFlag(false);
    if (mode === 'spotify') {
      logout();
      clearCatalogCache();
      if (desktopApi()) setDesktopSource(null);
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('demo');
    window.history.replaceState({}, '', url);
    // Signed out (or left the demo): back to the sign-in. Whoever follows the Spotify app on this computer keeps that.
    setMode(desktopApi() && followsAppOnDesktop() ? 'desktop' : 'setup');
  };

  // Desktop app: "Sign in with Spotify" opens the setup screen; skipping it goes back to the Spotify app on this computer.
  const desktopSignIn = desktopApi()
    ? {
        onSignedIn: () => {
          setDesktopSource('account');
          setMode('spotify');
        },
        onBack: () => {
          setDesktopSource('app');
          setMode('desktop');
        },
      }
    : undefined;

  // Signing in again (to give the app the permissions the library needs): the web version leaves the page for
  // Spotify's login; the desktop app and the phone app log in through the browser and then start over.
  const reconnectSpotify = async () => {
    try {
      const err = await startLogin();
      if (!loginStaysInApp()) return;
      if (err) toast(err, 'error');
      else window.location.reload();
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  if (mode === 'loading') return <div className="boot" />;
  if (!engine) {
    return (
      <>
        <Setup error={error} onDemo={startDemo} desktop={desktopSignIn} onSignedIn={() => setMode('spotify')} />
        <Toasts />
      </>
    );
  }
  // Signed in with Spotify (or in the demo): the Spotify-style app. Following the Spotify app on this computer
  // without signing in stays the plain lyrics screen.
  if (mode === 'spotify' || mode === 'demo') {
    return <AppShell key={mode} engine={engine} onSignOut={signOut} reconnect={reconnectSpotify} />;
  }
  return (
    <Stage
      key={mode}
      engine={engine}
      onSignOut={signOut}
      onDemo={mode === 'desktop' ? startDemo : undefined}
      onSignIn={mode === 'desktop' ? () => setMode('setup') : undefined}
    />
  );
}
