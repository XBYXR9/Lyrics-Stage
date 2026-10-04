import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, migrateSettings, settingsToStore } from '../settings';

describe('settings from an older version', () => {
  it('keeps the beat flash off for whoever turned it off in 0.5.0', () => {
    expect(migrateSettings({ beatFlash: false })).toEqual({ beatStyle: 'off' });
  });

  it('drops the old switch otherwise, so the new default applies', () => {
    expect(migrateSettings({ beatFlash: true, fontScale: 1.2 })).toEqual({ fontScale: 1.2 });
  });

  it('never overrides a style that was already chosen', () => {
    expect(migrateSettings({ beatFlash: false, beatStyle: 'edges' })).toEqual({ beatStyle: 'edges' });
  });

  it('keeps following the real sound for whoever turned it on in 0.5.0', () => {
    expect(migrateSettings({ reactToSound: true })).toEqual({ soundSync: 'on' });
    expect(migrateSettings({ reactToSound: false })).toEqual({});
    expect(migrateSettings({ reactToSound: true, soundSync: 'off' })).toEqual({ soundSync: 'off' });
  });

  it('carries the 0.5.2 "big beats while singing" switch over under its new name', () => {
    expect(migrateSettings({ flashOnBigBeats: false })).toEqual({ flashWhileSinging: false });
    expect(migrateSettings({ flashOnBigBeats: true })).toEqual({ flashWhileSinging: true });
    expect(migrateSettings({ flashOnBigBeats: true, flashWhileSinging: false })).toEqual({ flashWhileSinging: false });
  });
});

describe('Reduce motion that only follows the computer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('is left out of what is saved until somebody chooses it', () => {
    expect('reduceMotion' in settingsToStore({ ...DEFAULT_SETTINGS, reduceMotion: true }, false)).toBe(false);
    expect(settingsToStore({ ...DEFAULT_SETTINGS, reduceMotion: true, fontScale: 1.2 }, false).fontScale).toBe(1.2);
    expect(settingsToStore({ ...DEFAULT_SETTINGS, reduceMotion: false }, true).reduceMotion).toBe(false);
  });

  /** The settings module, loaded fresh with what the browser had saved and what the computer asks for. */
  async function load(saved: Record<string, unknown> | null, systemReduces: boolean) {
    const store = new Map<string, string>();
    if (saved) store.set('ls.settings.v1', JSON.stringify(saved));
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: systemReduces }) });
    vi.resetModules();
    const mod = await import('../settings');
    return { ...mod, saved: () => JSON.parse(store.get('ls.settings.v1') ?? '{}') as Record<string, unknown> };
  }

  it('does not get stuck on because some other setting was changed while the computer asked for less motion', async () => {
    const first = await load(null, true);
    expect(first.getSettings().reduceMotion).toBe(true); // the computer asks for it, so it starts on
    first.updateSettings({ fontScale: 1.3 });
    expect('reduceMotion' in first.saved()).toBe(false);
    // The computer stops asking (Windows animations back on): the next run follows it.
    const later = await load(first.saved(), false);
    expect(later.getSettings().fontScale).toBe(1.3);
    expect(later.getSettings().reduceMotion).toBe(false);
  });

  it('keeps what somebody chose, either way, and what an older version saved', async () => {
    const chose = await load(null, true);
    chose.updateSettings({ reduceMotion: false });
    expect(chose.saved().reduceMotion).toBe(false);
    expect((await load(chose.saved(), true)).getSettings().reduceMotion).toBe(false);
    expect((await load({ reduceMotion: true }, false)).getSettings().reduceMotion).toBe(true); // saved by an older version
  });

  it('tells apart "on because the computer asks" from "chosen here"', async () => {
    const auto = await load(null, true);
    expect(auto.reduceMotionIsSystemDefault()).toBe(true);
    auto.updateSettings({ reduceMotion: true });
    expect(auto.reduceMotionIsSystemDefault()).toBe(false);
  });
});
