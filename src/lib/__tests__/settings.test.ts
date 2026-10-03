import { describe, expect, it } from 'vitest';
import { migrateSettings } from '../settings';

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
});
