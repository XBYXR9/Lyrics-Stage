import { useEffect, useMemo, useState } from 'react';
import { Setup } from './components/Setup';
import { Stage } from './components/Stage';
import { Toasts } from './components/Toasts';
import { handleRedirect, isLoggedIn, logout } from './lib/auth';
import { DemoEngine } from './lib/demo';
import { DesktopEngine } from './lib/desktopEngine';
import { desktopApi } from './lib/desktopTypes';
import { SpotifyEngine, type Engine } from './lib/engine';

// "desktop": the desktop app, following the Spotify app on this computer.
// "spotify": signed in to Spotify, using the Spotify Web API (needs a developer
//            app). The web version always works this way; the desktop app does
//            when you choose "Sign in with Spotify".
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

function setDesktopSource(source: 'account' | 'app') {
  try {
    localStorage.setItem(SOURCE_KEY, source);
  } catch {
    /* ignore */
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
  if (desktopApi()) return signedInOnDesktop() ? 'spotify' : 'desktop';
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

  // Web version: finish the Spotify login if we just came back from it.
  useEffect(() => {
    if (mode !== 'loading') return;
    void handleRedirect().then((err) => {
      setError(err);
      setMode(!err && isLoggedIn() ? 'spotify' : 'setup');
    });
  }, [mode]);

  const engine: Engine | null = useMemo(() => {
    if (mode === 'spotify') return new SpotifyEngine({ browserPlayer: !desktopApi() });
    if (mode === 'demo') return new DemoEngine();
    const api = desktopApi();
    if (mode === 'desktop' && api) return new DesktopEngine(api);
    return null;
  }, [mode]);

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
      if (desktopApi()) setDesktopSource('app');
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('demo');
    window.history.replaceState({}, '', url);
    setMode(desktopApi() ? 'desktop' : 'setup');
  };

  // Desktop app: "Sign in with Spotify" opens the setup screen; skipping it goes back to the Spotify app on this computer.
  const desktopSignIn = desktopApi()
    ? {
        onSignedIn: () => {
          setDesktopSource('account');
          setMode('spotify');
        },
        onBack: () => setMode('desktop'),
      }
    : undefined;

  if (mode === 'loading') return <div className="boot" />;
  if (!engine) {
    return (
      <>
        <Setup error={error} onDemo={startDemo} desktop={desktopSignIn} />
        <Toasts />
      </>
    );
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
