// First screen: explains how to connect Spotify in a few simple steps, or try the demo.
// The desktop app shows it too, when you choose "Sign in with Spotify".
import { useState } from 'react';
import { getClientId, loginStaysInApp, redirectUri, setClientId, startLogin, usesBuiltInClientId } from '../lib/auth';
import { desktopApi } from '../lib/desktopTypes';
import { cancelNativeSignIn, isNativeApp } from '../lib/nativeApp';

/** Desktop app: what to do after signing in, or to go back to following the Spotify app on this computer. */
export interface DesktopSignIn {
  onSignedIn: () => void;
  onBack: () => void;
}

export function Setup({
  error,
  onDemo,
  desktop,
  onSignedIn,
}: {
  error: string | null;
  onDemo: () => void;
  desktop?: DesktopSignIn;
  /** Android app: what to do after signing in (the login happens in the phone's browser). */
  onSignedIn?: () => void;
}) {
  const phone = isNativeApp();
  const [clientId, setId] = useState(getClientId());
  const [editing, setEditing] = useState(!getClientId());
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(error);
  const [waiting, setWaiting] = useState(false);
  const uri = redirectUri();

  const connect = async () => {
    const id = clientId.trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) {
      setProblem('That doesn’t look like a Client ID (it should be 32 letters and numbers).');
      return;
    }
    setClientId(id);
    setProblem(null);
    setWaiting(loginStaysInApp());
    try {
      // The web version leaves the page here; the desktop app and the Android app wait for the browser.
      const err = await startLogin();
      if (!loginStaysInApp()) return;
      if (err) setProblem(err);
      else (desktop?.onSignedIn ?? onSignedIn)?.();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setWaiting(false);
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

        {(desktop || phone) && !waiting && (
          <p className="tagline">
            {phone
              ? 'Sign in with Spotify and the lyrics follow whatever you play in the Spotify app on this phone, or on any other device.'
              : 'Sign in to use Spotify’s own data: exact timing and covers, and lyrics for whatever you play on your phone or speakers too.'}
          </p>
        )}

        {problem && <div className="alert">{problem}</div>}

        {waiting ? (
          <div className="waiting">
            <p>
              <b>Finish signing in in your web browser.</b> {phone ? 'It brings you back here by itself.' : 'When it says you’re signed in, come back here.'}
            </p>
            <p className="fine">
              If Spotify says <b>INVALID_CLIENT: Invalid redirect URI</b>, add <code>{uri}</code> to your Spotify app’s
              Redirect URIs and try again.
            </p>
            <button className="btn ghost wide" onClick={() => void (phone ? cancelNativeSignIn() : desktopApi()?.cancelSpotifyLogin())}>
              Cancel
            </button>
          </div>
        ) : editing ? (
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
                {desktop || phone ? (
                  <>
                    Tick <b>Web API</b>, then save.
                  </>
                ) : (
                  <>
                    Tick <b>Web API</b> and <b>Web Playback SDK</b>, then save.
                  </>
                )}
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
              {desktop || phone ? 'Sign in with Spotify' : 'Connect Spotify'}
            </button>
          </>
        ) : (
          <>
            <button className="btn primary wide" onClick={connect}>
              {desktop || phone ? 'Sign in with Spotify' : 'Connect Spotify'}
            </button>
            {usesBuiltInClientId() && (
              <p className="fine">
                This version signs in with the app publisher’s Spotify app, which only has room for a few accounts. If
                Spotify says your account isn’t on the list, use a Client ID of your own (it’s free).
              </p>
            )}
            <button className="link" onClick={() => setEditing(true)}>
              Use a different Client ID
            </button>
          </>
        )}

        <div className="divider">
          <span>or</span>
        </div>
        {desktop ? (
          <button className="btn ghost wide" onClick={desktop.onBack}>
            Skip — follow the Spotify app on this computer
          </button>
        ) : (
          <button className="btn ghost wide" onClick={onDemo}>
            Try the demo — no Spotify needed
          </button>
        )}
        <p className="fine center">
          Runs only on {phone ? 'your phone' : 'your computer'}. Lyrics from{' '}
          <a href="https://lrclib.net" target="_blank" rel="noreferrer">
            LRCLIB
          </a>
          . Not affiliated with Spotify or Apple.
        </p>
      </div>
    </main>
  );
}
