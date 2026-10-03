// "Sign in with Spotify" for the desktop app.
//
// Spotify's login runs in the person's normal browser (where they may already be
// logged in, and where "Continue with Google/Apple" works). When they agree,
// Spotify sends the browser to http://127.0.0.1:<port>/callback. A tiny web
// server listens there only while a login is in progress, answers with a
// "you can go back to the app" page, and hands the result to the lyrics page,
// which swaps the code for tokens (PKCE, no client secret).
import http from 'node:http';
import type { SpotifyLoginResult } from '../src/lib/desktopTypes';
import { DESKTOP_REDIRECT_PORT, DESKTOP_REDIRECT_URI } from '../src/lib/desktopTypes';

/** Give up waiting after this long (the person can always try again). */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** Only Spotify's own login page, sending the person back to our listener. Exported for tests. */
export function isSpotifyLoginUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' &&
      url.host === 'accounts.spotify.com' &&
      url.pathname === '/authorize' &&
      url.searchParams.get('redirect_uri') === DESKTOP_REDIRECT_URI
    );
  } catch {
    return false;
  }
}

/** Reads Spotify's answer from the callback address. Exported for tests. */
export function readCallback(path: string): SpotifyLoginResult | null {
  const url = new URL(path, DESKTOP_REDIRECT_URI);
  if (url.pathname !== '/callback') return null;
  const pick = (k: string) => url.searchParams.get(k) ?? undefined;
  return { code: pick('code'), state: pick('state'), error: pick('error') ?? (pick('code') ? undefined : 'no_code') };
}

const page = (ok: boolean) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Lyrics Stage</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #14112b; color: #f4f2ff;
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 26rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.6rem; margin: 0 0 .5rem; }
  p { color: #b9b3d6; margin: 0; }
</style></head>
<body><main>
  <h1>${ok ? 'You’re signed in' : 'Sign-in didn’t finish'}</h1>
  <p>${ok ? 'You can close this tab and go back to Lyrics Stage.' : 'Go back to Lyrics Stage to see what happened and try again.'}</p>
</main></body></html>`;

let cancelPending: (() => void) | null = null;

/**
 * Opens Spotify's login page with `openBrowser` and waits for Spotify to send
 * the person back. Resolves with the code (or an error) once; never rejects.
 */
export function signInWithSpotify(authUrl: unknown, openBrowser: (url: string) => Promise<void>): Promise<SpotifyLoginResult> {
  if (!isSpotifyLoginUrl(authUrl)) return Promise.resolve({ error: 'invalid_request' });
  cancelPending?.(); // a second click replaces the first attempt

  return new Promise((resolve) => {
    let done = false;
    const server = http.createServer((req, res) => {
      const result = readCallback(req.url ?? '/');
      if (!result || done) {
        res.writeHead(404, { Connection: 'close' }).end();
        return;
      }
      // "Connection: close" so the browser can't keep talking to us after the login.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
      res.end(page(!result.error));
      finish(result);
    });
    const timer = setTimeout(() => finish({ error: 'timeout' }), LOGIN_TIMEOUT_MS);
    const finish = (result: SpotifyLoginResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cancelPending = null;
      server.close();
      server.closeIdleConnections();
      resolve(result);
    };
    cancelPending = () => finish({ error: 'cancelled' });
    server.on('error', (err: NodeJS.ErrnoException) => finish({ error: err.code === 'EADDRINUSE' ? 'port_in_use' : 'server_error' }));
    // Listen on the loopback address only: nothing outside this computer can reach it.
    server.listen(DESKTOP_REDIRECT_PORT, '127.0.0.1', () => {
      openBrowser(authUrl).catch(() => finish({ error: 'browser_failed' }));
    });
  });
}

/** Stops waiting (e.g. the person pressed Cancel in the app). */
export function cancelSpotifyLogin() {
  cancelPending?.();
}
