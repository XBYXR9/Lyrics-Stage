import { useEffect, useMemo, useState } from 'react';
import { Stage } from './components/Stage';
import { Setup } from './components/Setup';
import { Toasts } from './components/Toasts';
import { handleRedirect, isLoggedIn, logout } from './lib/auth';
import { DemoEngine } from './lib/demo';
import { SpotifyEngine, type Engine } from './lib/engine';

type Mode = 'loading' | 'setup' | 'spotify' | 'demo';

const DEMO_KEY = 'ls.demo';

function initialMode(): Mode {
  if (window.location.pathname === '/callback') return 'loading';
  if (new URLSearchParams(window.location.search).has('demo')) return 'demo';
  if (isLoggedIn()) return 'spotify';
  try {
    if (sessionStorage.getItem(DEMO_KEY) === '1') return 'demo';
  } catch {
    /* ignore */
  }
  return 'setup';
}

export default function App() {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [error, setError] = useState<string | null>(null);

  // Finish the Spotify login if we just came back from it.
  useEffect(() => {
    if (mode !== 'loading') return;
    void handleRedirect().then((err) => {
      setError(err);
      setMode(!err && isLoggedIn() ? 'spotify' : 'setup');
    });
  }, [mode]);

  const engine: Engine | null = useMemo(
    () => (mode === 'spotify' ? new SpotifyEngine() : mode === 'demo' ? new DemoEngine() : null),
    [mode],
  );

  useEffect(() => {
    if (!engine) return;
    engine.start();
    return () => engine.stop();
  }, [engine]);

  const signOut = () => {
    try {
      sessionStorage.removeItem(DEMO_KEY);
    } catch {
      /* ignore */
    }
    if (mode === 'spotify') logout();
    const url = new URL(window.location.href);
    url.searchParams.delete('demo');
    window.history.replaceState({}, '', url);
    setMode('setup');
  };

  if (mode === 'loading') return <div className="boot" />;
  if (!engine) {
    return (
      <>
        <Setup
          error={error}
          onDemo={() => {
            try {
              sessionStorage.setItem(DEMO_KEY, '1');
            } catch {
              /* ignore */
            }
            setMode('demo');
          }}
        />
        <Toasts />
      </>
    );
  }
  return <Stage key={mode} engine={engine} onSignOut={signOut} />;
}
