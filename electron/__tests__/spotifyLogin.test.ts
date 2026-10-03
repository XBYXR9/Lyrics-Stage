import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { DESKTOP_REDIRECT_PORT, DESKTOP_REDIRECT_URI } from '../../src/lib/desktopTypes';
import { cancelSpotifyLogin, isSpotifyLoginUrl, readCallback, signInWithSpotify } from '../spotifyLogin';

const authUrl = (redirect = DESKTOP_REDIRECT_URI) =>
  `https://accounts.spotify.com/authorize?${new URLSearchParams({ client_id: 'abc', response_type: 'code', redirect_uri: redirect })}`;

/** Plays the browser: visits the callback address the way Spotify's redirect would. */
const visit = (query: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    http
      .get(`${DESKTOP_REDIRECT_URI}?${query}`, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on('error', reject);
  });

describe('Sign in with Spotify (desktop)', () => {
  it("only opens Spotify's own login page, sending people back to the app", () => {
    expect(isSpotifyLoginUrl(authUrl())).toBe(true);
    expect(isSpotifyLoginUrl(authUrl('https://evil.example/callback'))).toBe(false);
    expect(isSpotifyLoginUrl(authUrl().replace('accounts.spotify.com', 'accounts.spotify.com.evil.example'))).toBe(false);
    expect(isSpotifyLoginUrl(authUrl().replace('https:', 'http:'))).toBe(false);
    expect(isSpotifyLoginUrl('file:///etc/passwd')).toBe(false);
    expect(isSpotifyLoginUrl(42)).toBe(false);
  });

  it("reads Spotify's answer", () => {
    expect(readCallback('/callback?code=C0DE&state=S')).toEqual({ code: 'C0DE', state: 'S', error: undefined });
    expect(readCallback('/callback?error=access_denied&state=S')).toMatchObject({ error: 'access_denied' });
    expect(readCallback('/callback')).toMatchObject({ error: 'no_code' });
    expect(readCallback('/favicon.ico')).toBeNull();
  });

  it('opens the browser, catches the redirect and shows a "go back to the app" page', async () => {
    let page: Promise<{ status: number; body: string }> | null = null;
    const result = await signInWithSpotify(authUrl(), async () => {
      page = visit('code=C0DE&state=S');
    });
    expect(result).toEqual({ code: 'C0DE', state: 'S', error: undefined });
    const shown = await page!;
    expect(shown.status).toBe(200);
    expect(shown.body).toContain('You’re signed in');
    // The listener is gone afterwards.
    await expect(visit('code=again')).rejects.toThrow();
  });

  it('can be cancelled, and refuses other addresses', async () => {
    const waiting = signInWithSpotify(authUrl(), async () => cancelSpotifyLogin());
    expect(await waiting).toEqual({ error: 'cancelled' });
    expect(await signInWithSpotify('https://evil.example/', async () => {})).toEqual({ error: 'invalid_request' });
  });

  it('says so when another program already uses the port', async () => {
    const blocker = http.createServer();
    await new Promise<void>((r) => blocker.listen(DESKTOP_REDIRECT_PORT, '127.0.0.1', r));
    try {
      expect(await signInWithSpotify(authUrl(), async () => {})).toEqual({ error: 'port_in_use' });
    } finally {
      await new Promise((r) => blocker.close(r));
    }
  });
});
