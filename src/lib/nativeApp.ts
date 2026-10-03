// The Android app (Capacitor): the same page, inside a native shell.
//
// Differences from the website: Spotify's login opens in the phone's browser
// (a Chrome Custom Tab) and comes back through a link of its own
// ("lyricsstage://callback?code=..."), since a page inside the app has no
// address Spotify can send people back to. Music can't play inside the page
// either (Spotify's web player doesn't run in Android's web view), so the
// Spotify app plays and this app shows the lyrics, like the desktop app does.
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import type { SpotifyLoginResult } from './desktopTypes';

/** Spotify sends people back here after the login. It must be added as a Redirect URI in the Spotify developer app. */
export const ANDROID_REDIRECT_URI = 'lyricsstage://callback';

/** Are we running inside the Android app (not in a web browser or the desktop app)? */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Reads Spotify's answer out of the link the browser opened the app with. Returns
 * null for any other link, so nothing else can pose as a login answer.
 */
export function parseLoginCallback(url: string | undefined | null): SpotifyLoginResult | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'lyricsstage:' || u.host !== 'callback') return null;
  const p = u.searchParams;
  return {
    code: p.get('code') ?? undefined,
    state: p.get('state') ?? undefined,
    error: p.get('error') ?? undefined,
  };
}

/** How long the login may take before we stop waiting. */
const LOGIN_TIMEOUT_MS = 5 * 60_000;
/** After the browser window closes, how long to wait for the answer link before calling it cancelled. */
const CLOSED_GRACE_MS = 1500;

let pending: ((r: SpotifyLoginResult) => void) | null = null;
let listening = false;
/** An answer that arrived while nobody was waiting for it (the app was restarted in the meantime). */
let lateAnswer: SpotifyLoginResult | null = null;

function listen() {
  if (listening) return;
  listening = true;
  // A plugin that can't start must never throw into the page: the login would just not complete.
  void App.addListener('appUrlOpen', (event) => {
    const answer = parseLoginCallback(event.url);
    if (!answer) return;
    void Browser.close().catch(() => {});
    if (pending) pending(answer);
    else lateAnswer = answer;
  }).catch(() => {});
  void Browser.addListener('browserFinished', () => {
    // The window was closed. The answer link may still be on its way, so give it a moment.
    setTimeout(() => pending?.({ error: 'cancelled' }), CLOSED_GRACE_MS);
  }).catch(() => {});
}

/** Opens Spotify's login page in the phone's browser and waits for the answer. */
export function signInWithNativeBrowser(authUrl: string): Promise<SpotifyLoginResult> {
  listen();
  cancelNativeSignIn();
  lateAnswer = null;
  return new Promise((resolve) => {
    const finish = (r: SpotifyLoginResult) => {
      clearTimeout(timer);
      if (pending === finish) pending = null;
      resolve(r);
    };
    const timer = setTimeout(() => finish({ error: 'timeout' }), LOGIN_TIMEOUT_MS);
    pending = finish;
    Browser.open({ url: authUrl }).catch(() => finish({ error: 'browser_failed' }));
  });
}

/** Stops waiting for a login started with signInWithNativeBrowser. */
export function cancelNativeSignIn() {
  pending?.({ error: 'cancelled' });
}

/**
 * If the app was opened by the answer link while it wasn't running (Android can
 * close the app while the browser is in front), returns that answer.
 */
export async function takeLaunchLoginAnswer(): Promise<SpotifyLoginResult | null> {
  listen();
  const early = lateAnswer;
  lateAnswer = null;
  if (early) return early;
  try {
    return parseLoginCallback((await App.getLaunchUrl())?.url);
  } catch {
    return null;
  }
}

/** The Android back button: `handler` returns true when it dealt with it (closed a panel); otherwise the app goes to the background. */
export function onNativeBack(handler: () => boolean): () => void {
  let remove: (() => void) | null = null;
  let gone = false;
  void App.addListener('backButton', () => {
    if (!handler()) void App.minimizeApp().catch(() => {});
  })
    .then((h) => {
      if (gone) void h.remove();
      else remove = () => void h.remove();
    })
    .catch(() => {});
  return () => {
    gone = true;
    remove?.();
  };
}
