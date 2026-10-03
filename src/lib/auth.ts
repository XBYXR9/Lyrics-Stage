// Spotify login using "Authorization Code with PKCE".
// PKCE lets a website log in without a client secret, so everything can run
// in the browser on your own computer. The desktop app uses the same login:
// Spotify's page opens in the person's browser and sends the answer back to a
// small listener in the app (electron/spotifyLogin.ts) instead of to a website.

import { desktopApi, DESKTOP_REDIRECT_URI, type SpotifyLoginResult } from './desktopTypes';
import { ANDROID_REDIRECT_URI, isNativeApp, signInWithNativeBrowser, takeLaunchLoginAnswer } from './nativeApp';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

export const SCOPES = [
  'streaming', // Web Playback SDK (play inside this page)
  'user-read-email', // required by the Web Playback SDK
  'user-read-private', // required by the Web Playback SDK
  'user-read-playback-state', // see what's playing + devices + queue
  'user-modify-playback-state', // play / pause / skip / seek
  'user-read-currently-playing',
].join(' ');

const KEY_CLIENT_ID = 'ls.clientId';
const KEY_TOKEN = 'ls.token';
const KEY_VERIFIER = 'ls.pkceVerifier';
const KEY_STATE = 'ls.pkceState';

interface StoredToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked — the session just won't persist */
  }
}

export function redirectUri(): string {
  if (desktopApi()) return DESKTOP_REDIRECT_URI;
  if (isNativeApp()) return ANDROID_REDIRECT_URI;
  return `${window.location.origin}/callback`;
}

/** Does the login finish without leaving the page (the desktop app and the Android app wait for the browser)? */
export const loginStaysInApp = () => !!desktopApi() || isNativeApp();

export function getClientId(): string {
  const fromEnv = (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim();
  return read(KEY_CLIENT_ID) || fromEnv || '';
}

export function setClientId(id: string) {
  write(KEY_CLIENT_ID, id.trim() || null);
}

function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Starts the Spotify login. The web version leaves the page for Spotify's login
 * and comes back to /callback (see handleRedirect). The desktop app and the
 * Android app wait for the login to finish in the browser and return an error
 * message, or null when signed in.
 */
export async function startLogin(): Promise<string | null> {
  const clientId = getClientId();
  if (!clientId) throw new Error('Add your Spotify Client ID first.');
  const verifier = randomString(64);
  const state = randomString(16);
  write(KEY_VERIFIER, verifier);
  write(KEY_STATE, state);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await sha256Base64Url(verifier),
    scope: SCOPES,
    state,
  });
  const desktop = desktopApi();
  if (desktop) return completeLogin(await desktop.signInWithSpotify(`${AUTH_URL}?${params}`));
  if (isNativeApp()) return completeLogin(await signInWithNativeBrowser(`${AUTH_URL}?${params}`));
  window.location.assign(`${AUTH_URL}?${params}`);
  return null;
}

/**
 * Android app: if the app was opened by Spotify's answer link while it wasn't
 * running, finish that login now. Returns null when there is nothing to finish,
 * else an error message or "" when signed in.
 */
export async function finishLaunchLogin(): Promise<string | null> {
  const answer = await takeLaunchLoginAnswer();
  if (!answer) return null;
  return (await completeLogin(answer)) ?? '';
}

/** Plain-language messages for the desktop sign-in's own errors. */
const DESKTOP_ERRORS: Record<string, string> = {
  cancelled: 'Sign-in was cancelled.',
  timeout: 'Spotify didn’t answer in time. Please try again.',
  port_in_use: `Another program is using port ${new URL(DESKTOP_REDIRECT_URI).port}, which the sign-in needs. Close it and try again.`,
  browser_failed: 'Couldn’t open your web browser for the Spotify login.',
};

function saveToken(json: { access_token: string; refresh_token?: string; expires_in: number }) {
  const previous = loadToken();
  const token: StoredToken = {
    accessToken: json.access_token,
    // Spotify may or may not rotate the refresh token.
    refreshToken: json.refresh_token ?? previous?.refreshToken ?? '',
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  write(KEY_TOKEN, JSON.stringify(token));
  return token;
}

function loadToken(): StoredToken | null {
  const raw = read(KEY_TOKEN);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredToken;
  } catch {
    return null;
  }
}

let redirectResult: Promise<string | null> | null = null;

/**
 * If the page was opened by Spotify's redirect (/callback?code=...), swap the
 * code for tokens. Returns an error message for the user, or null.
 * Safe to call more than once (React may run effects twice in development).
 */
export function handleRedirect(): Promise<string | null> {
  redirectResult ??= finishLogin();
  return redirectResult;
}

async function finishLogin(): Promise<string | null> {
  if (window.location.pathname !== '/callback') return null;
  const params = new URLSearchParams(window.location.search);
  window.history.replaceState({}, '', '/');
  return completeLogin({
    code: params.get('code') ?? undefined,
    state: params.get('state') ?? undefined,
    error: params.get('error') ?? undefined,
  });
}

/** Checks Spotify's answer and swaps the code for tokens. Returns an error message, or null when signed in. */
async function completeLogin({ code, state, error }: SpotifyLoginResult): Promise<string | null> {
  const expectedState = read(KEY_STATE);
  const verifier = read(KEY_VERIFIER);
  write(KEY_STATE, null);
  write(KEY_VERIFIER, null);

  if (error && DESKTOP_ERRORS[error]) return DESKTOP_ERRORS[error];
  if (error) return error === 'access_denied' ? 'Login was cancelled.' : `Spotify said: ${error}`;
  if (!code || !verifier || state !== expectedState) return 'Login failed — please try again.';

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: getClientId(),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return `Login failed: ${body.error_description || body.error || res.status}`;
  }
  saveToken(await res.json());
  return null;
}

let refreshing: Promise<StoredToken | null> | null = null;

async function refresh(token: StoredToken): Promise<StoredToken | null> {
  if (!token.refreshToken) return null;
  refreshing ??= (async () => {
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: token.refreshToken,
          client_id: getClientId(),
        }),
      });
      if (!res.ok) {
        // A 400 means the refresh token is dead; anything else may be temporary.
        if (res.status === 400) write(KEY_TOKEN, null);
        return null;
      }
      return saveToken(await res.json());
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export function isLoggedIn(): boolean {
  return loadToken() !== null;
}

/** Returns a fresh access token (refreshing it if needed), or null if logged out. */
export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  const token = loadToken();
  if (!token) return null;
  if (!forceRefresh && token.expiresAt - Date.now() > 60_000) return token.accessToken;
  const fresh = await refresh(token);
  return fresh?.accessToken ?? null;
}

export function logout() {
  write(KEY_TOKEN, null);
}
