// First screen: explains how to connect Spotify in a few simple steps, or try the demo.
import { useState } from 'react';
import { getClientId, redirectUri, setClientId, startLogin } from '../lib/auth';

export function Setup({ error, onDemo }: { error: string | null; onDemo: () => void }) {
  const [clientId, setId] = useState(getClientId());
  const [editing, setEditing] = useState(!getClientId());
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(error);
  const uri = redirectUri();

  const connect = async () => {
    const id = clientId.trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) {
      setProblem('That doesn’t look like a Client ID (it should be 32 letters and numbers).');
      return;
    }
    setClientId(id);
    try {
      await startLogin();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the text is selectable anyway */
    }
  };

  return (
    <main className="setup">
      <div className="setup-card glass">
        <div className="logo" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <h1>Lyrics Stage</h1>
        <p className="tagline">Apple Music–style lyrics for whatever you play on Spotify — with styles that match each song.</p>

        {problem && <div className="alert">{problem}</div>}

        {editing ? (
          <>
            <ol className="steps">
              <li>
                Open the{' '}
                <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
                  Spotify Developer Dashboard
                </a>{' '}
                and click <b>Create app</b> (any name and description).
              </li>
              <li>
                Add this <b>Redirect URI</b>:
                <div className="copy-row">
                  <code>{uri}</code>
                  <button className="btn small" onClick={copy}>
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                Tick <b>Web API</b> and <b>Web Playback SDK</b>, then save.
              </li>
              <li>
                Open the app’s <b>Settings</b>, copy the <b>Client ID</b> and paste it here:
                <input
                  className="text-input"
                  value={clientId}
                  onChange={(e) => setId(e.target.value)}
                  placeholder="e.g. 1a2b3c4d5e6f..."
                  spellCheck={false}
                  onKeyDown={(e) => e.key === 'Enter' && connect()}
                />
              </li>
            </ol>
            <p className="fine">
              New Spotify apps start in “Development mode”: add your Spotify account’s email under <b>User Management</b>{' '}
              in the dashboard. Controlling playback needs Spotify Premium.
            </p>
            <button className="btn primary wide" onClick={connect}>
              Connect Spotify
            </button>
          </>
        ) : (
          <>
            <button className="btn primary wide" onClick={connect}>
              Connect Spotify
            </button>
            <button className="link" onClick={() => setEditing(true)}>
              Use a different Client ID
            </button>
          </>
        )}

        <div className="divider">
          <span>or</span>
        </div>
        <button className="btn ghost wide" onClick={onDemo}>
          Try the demo — no Spotify needed
        </button>
        <p className="fine center">
          Runs only on your computer. Lyrics from{' '}
          <a href="https://lrclib.net" target="_blank" rel="noreferrer">
            LRCLIB
          </a>
          . Not affiliated with Spotify or Apple.
        </p>
      </div>
    </main>
  );
}
