import { afterEach, describe, expect, it, vi } from 'vitest';
import { motionHintText } from '../motionHint';

describe('the note about why the covers do not merge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('says what to switch, and mentions the computer when it is the computer that asks', () => {
    const plain = motionHintText('reduce-motion', false)!;
    expect(plain).toMatch(/Reduce motion is on/);
    expect(plain).toMatch(/Turn it off in Settings/);
    expect(plain).not.toMatch(/Windows/);
    expect(motionHintText('reduce-motion', true)).toMatch(/Windows has animations turned off/);
    expect(motionHintText('blend-off', false)).toMatch(/Settings → Song transitions/);
  });

  it('stays quiet when it is not down to a setting', () => {
    expect(motionHintText(null, true)).toBeNull();
    expect(motionHintText('not-a-blend', true)).toBeNull();
    expect(motionHintText('no-cover', true)).toBeNull();
  });

  it('is shown once per run and only the first three times ever', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    const shownInRun = async () => {
      vi.resetModules();
      const { takeMotionHint } = await import('../motionHint');
      return [takeMotionHint(), takeMotionHint()];
    };
    expect(await shownInRun()).toEqual([true, false]);
    expect(await shownInRun()).toEqual([true, false]);
    expect(await shownInRun()).toEqual([true, false]);
    expect(await shownInRun()).toEqual([false, false]);
  });
});
