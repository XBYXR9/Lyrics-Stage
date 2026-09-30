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
// "spotify": the web version, using the Spotify Web API (needs a developer app).
type Mode = 'loading' | 'setup' | 'spotify' | 'desktop' | 'demo';

const DEMO_KEY = 'ls.demo';

function initialMode(): Mode {
  const params = new URLSearchParams(window.location.search);
  let demo = params.has('demo');
  try {
    demo ||= sessionStorage.getItem(DEMO_KEY) === '1';
  } catch {
    /* ignore */
  }
  if (demo) return 'demo';
  if (desktopApi()) return 'desktop';
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
    if (mode === 'spotify') return new SpotifyEngine();
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
    if (mode === 'spotify') logout();
    const url = new URL(window.location.href);
    url.searchParams.delete('demo');
    window.history.replaceState({}, '', url);
    setMode(desktopApi() ? 'desktop' : 'setup');
  };

  if (mode === 'loading') return <div className="boot" />;
  if (!engine) {
    return (
      <>
        <Setup error={error} onDemo={startDemo} />
        <Toasts />
      </>
    );
  }
  return (
    <Stage key={mode} engine={engine} onSignOut={signOut} onDemo={mode === 'desktop' ? startDemo : undefined} />
  );
}
