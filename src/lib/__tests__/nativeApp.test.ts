import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A pretend Android shell: the plugins keep their listeners so the test can "fire" events like the system would.
const shell = vi.hoisted(() => {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  return {
    listeners,
    fire: (name: string, event?: unknown) => (listeners[name] ?? []).forEach((l) => l(event)),
    launchUrl: null as string | null,
    openFails: false,
  };
});

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (name: string, cb: (e: unknown) => void) => {
      (shell.listeners[name] ??= []).push(cb);
      return { remove: async () => {} };
    }),
    getLaunchUrl: vi.fn(async () => (shell.launchUrl ? { url: shell.launchUrl } : undefined)),
    minimizeApp: vi.fn(async () => {}),
  },
}));
vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: vi.fn(async () => {
      if (shell.openFails) throw new Error('no browser');
    }),
    close: vi.fn(async () => {}),
    addListener: vi.fn(async (name: string, cb: (e: unknown) => void) => {
      (shell.listeners[name] ??= []).push(cb);
      return { remove: async () => {} };
    }),
  },
}));

const load = async () => {
  vi.resetModules();
  for (const k of Object.keys(shell.listeners)) delete shell.listeners[k];
  return import('../nativeApp');
};

describe('the Android login answer', () => {
  it('reads Spotify’s answer from the link the browser opens the app with', async () => {
    const { parseLoginCallback } = await load();
    expect(parseLoginCallback('lyricsstage://callback?code=abc123&state=xyz')).toEqual({ code: 'abc123', state: 'xyz', error: undefined });
    expect(parseLoginCallback('lyricsstage://callback?error=access_denied&state=xyz')).toEqual({
      code: undefined,
      state: 'xyz',
      error: 'access_denied',
    });
  });

  it('ignores every other link, so nothing else can pose as an answer', async () => {
    const { parseLoginCallback } = await load();
    expect(parseLoginCallback('https://evil.example/callback?code=abc&state=x')).toBeNull();
    expect(parseLoginCallback('lyricsstage://elsewhere?code=abc&state=x')).toBeNull();
    expect(parseLoginCallback('otherapp://callback?code=abc')).toBeNull();
    expect(parseLoginCallback('not a link')).toBeNull();
    expect(parseLoginCallback('')).toBeNull();
    expect(parseLoginCallback(null)).toBeNull();
    expect(parseLoginCallback(undefined)).toBeNull();
  });

  it('knows its own address for the Spotify developer app', async () => {
    const { ANDROID_REDIRECT_URI, parseLoginCallback } = await load();
    expect(ANDROID_REDIRECT_URI).toBe('lyricsstage://callback');
    expect(parseLoginCallback(`${ANDROID_REDIRECT_URI}?code=1`)?.code).toBe('1');
  });
});

describe('signing in through the phone’s browser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    shell.launchUrl = null;
    shell.openFails = false;
  });
  afterEach(() => vi.useRealTimers());

  it('opens Spotify’s page in the browser and returns the answer that comes back', async () => {
    const { signInWithNativeBrowser } = await load();
    const { Browser } = await import('@capacitor/browser');
    const wait = signInWithNativeBrowser('https://accounts.spotify.com/authorize?x=1');
    await vi.advanceTimersByTimeAsync(0);
    expect(Browser.open).toHaveBeenCalledWith({ url: 'https://accounts.spotify.com/authorize?x=1' });
    shell.fire('appUrlOpen', { url: 'lyricsstage://callback?code=abc&state=xyz' });
    await expect(wait).resolves.toEqual({ code: 'abc', state: 'xyz', error: undefined });
    expect(Browser.close).toHaveBeenCalled();
  });

  it('keeps waiting when an unrelated link opens the app', async () => {
    const { signInWithNativeBrowser } = await load();
    let done = false;
    void signInWithNativeBrowser('https://accounts.spotify.com/authorize').then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    shell.fire('appUrlOpen', { url: 'https://example.com/whatever' });
    await vi.advanceTimersByTimeAsync(50);
    expect(done).toBe(false);
  });

  it('can be cancelled', async () => {
    const { cancelNativeSignIn, signInWithNativeBrowser } = await load();
    const wait = signInWithNativeBrowser('https://accounts.spotify.com/authorize');
    await vi.advanceTimersByTimeAsync(0);
    cancelNativeSignIn();
    await expect(wait).resolves.toEqual({ error: 'cancelled' });
  });

  it('calls it cancelled when the browser window closes and no answer follows', async () => {
    const { signInWithNativeBrowser } = await load();
    const wait = signInWithNativeBrowser('https://accounts.spotify.com/authorize');
    await vi.advanceTimersByTimeAsync(0);
    shell.fire('browserFinished');
    await vi.advanceTimersByTimeAsync(2000);
    await expect(wait).resolves.toEqual({ error: 'cancelled' });
  });

  it('still takes the answer when it arrives just after the browser window closes', async () => {
    const { signInWithNativeBrowser } = await load();
    const wait = signInWithNativeBrowser('https://accounts.spotify.com/authorize');
    await vi.advanceTimersByTimeAsync(0);
    shell.fire('browserFinished');
    await vi.advanceTimersByTimeAsync(300);
    shell.fire('appUrlOpen', { url: 'lyricsstage://callback?code=late&state=s' });
    await expect(wait).resolves.toMatchObject({ code: 'late' });
    await vi.advanceTimersByTimeAsync(3000); // the grace timer must not turn it into a cancel afterwards
  });

  it('says so when the browser cannot be opened, and gives up after five minutes', async () => {
    const { signInWithNativeBrowser } = await load();
    shell.openFails = true;
    await expect(signInWithNativeBrowser('https://accounts.spotify.com/authorize')).resolves.toEqual({ error: 'browser_failed' });
    shell.openFails = false;
    const wait = signInWithNativeBrowser('https://accounts.spotify.com/authorize');
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 10);
    await expect(wait).resolves.toEqual({ error: 'timeout' });
  });

  it('finishes a login that opened the app from scratch (Android closed it while the browser was in front)', async () => {
    shell.launchUrl = 'lyricsstage://callback?code=cold&state=s1';
    const { takeLaunchLoginAnswer } = await load();
    await expect(takeLaunchLoginAnswer()).resolves.toMatchObject({ code: 'cold', state: 's1' });
  });

  it('has nothing to finish on a normal start, or after another link', async () => {
    const { takeLaunchLoginAnswer } = await load();
    await expect(takeLaunchLoginAnswer()).resolves.toBeNull();
    shell.launchUrl = 'https://example.com/';
    const again = await load();
    await expect(again.takeLaunchLoginAnswer()).resolves.toBeNull();
  });

  it('keeps an answer that arrives while nobody is waiting, for the next start-up check', async () => {
    const { takeLaunchLoginAnswer } = await load();
    await takeLaunchLoginAnswer(); // starts listening
    shell.fire('appUrlOpen', { url: 'lyricsstage://callback?code=early&state=s2' });
    await expect(takeLaunchLoginAnswer()).resolves.toMatchObject({ code: 'early' });
    await expect(takeLaunchLoginAnswer()).resolves.toBeNull(); // taken only once
  });
});

describe('the Android back button', () => {
  it('lets a panel close first, and sends the app to the background otherwise', async () => {
    const { onNativeBack } = await load();
    const { App } = await import('@capacitor/app');
    let panelOpen = true;
    onNativeBack(() => {
      if (!panelOpen) return false;
      panelOpen = false;
      return true;
    });
    await vi.advanceTimersByTimeAsync(0).catch(() => {});
    shell.fire('backButton');
    expect(App.minimizeApp).not.toHaveBeenCalled();
    shell.fire('backButton');
    expect(App.minimizeApp).toHaveBeenCalledTimes(1);
  });
});
