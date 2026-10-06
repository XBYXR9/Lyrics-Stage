import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const load = async (requestMediaKeySystemAccess?: (system: string, config: unknown) => Promise<unknown>) => {
  vi.stubGlobal('navigator', { requestMediaKeySystemAccess });
  return (await import('../drm')).canPlayProtectedAudio;
};

describe('copy protection (DRM) check', () => {
  it('says yes when Widevine is there', async () => {
    const ask = vi.fn(async (_system: string) => ({}));
    expect(await (await load(ask))()).toBe(true);
    expect(ask.mock.calls[0][0]).toBe('com.widevine.alpha');
  });

  it('tries FairPlay too (Safari), and says yes if that one works', async () => {
    const ask = vi.fn(async (system: string) => {
      if (system.startsWith('com.apple.fps')) return {};
      throw new Error('no');
    });
    expect(await (await load(ask))()).toBe(true);
  });

  it('says no when none is there (an Electron without Widevine), and asks only once', async () => {
    const ask = vi.fn(async () => {
      throw new Error('no');
    });
    const check = await load(ask);
    expect(await check()).toBe(false);
    const calls = ask.mock.calls.length;
    expect(await check()).toBe(false);
    expect(ask.mock.calls.length).toBe(calls);
  });

  it('says no when the browser cannot be asked at all', async () => {
    expect(await (await load(undefined))()).toBe(false);
  });
});
