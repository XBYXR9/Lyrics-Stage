import { describe, expect, it } from 'vitest';
import { isRefusal, loadProbeMemory, ProbeMemory, type ProbeMemorySaved } from '../silentProbes';

describe('ProbeMemory', () => {
  it('offers the quiet ways one after the other, and the one that works first', () => {
    const m = new ProbeMemory();
    expect(m.pick(['volume', 'repeat'])).toBe('volume');
    m.markFailed('volume');
    expect(m.pick(['volume', 'repeat'])).toBe('repeat');
    m.markWorks('repeat');
    expect(m.pick(['volume', 'repeat'])).toBe('repeat');
    expect(m.pick(['volume'])).toBeNull(); // the one that works isn't available now, and the other one failed
  });

  it('offers nothing when every quiet way has failed', () => {
    const m = new ProbeMemory({ works: null, failed: ['volume', 'repeat'] });
    expect(m.pick(['volume', 'repeat'])).toBeNull();
    expect(m.pick([])).toBeNull();
  });

  it('stops offering a quiet way that keeps showing nothing, for now (not for good)', () => {
    const m = new ProbeMemory();
    m.noteTried('volume');
    expect(m.pick(['volume'])).toBe('volume');
    m.noteTried('volume');
    expect(m.pick(['volume'])).toBeNull();
    expect(m.failed).toEqual([]); // not written off: a later run of the app tries it again
  });

  it('forgets a failure when the way is later seen to work, and a way that stops working', () => {
    const m = new ProbeMemory({ works: null, failed: ['volume'] });
    m.markWorks('volume');
    expect(m.failed).toEqual([]);
    m.markFailed('volume');
    expect(m.works).toBeNull();
    expect(m.failed).toEqual(['volume']);
  });

  it('tells the app when what it knows changes', () => {
    const seen: ProbeMemorySaved[] = [];
    const m = new ProbeMemory(undefined, (s) => seen.push(s));
    m.markFailed('volume');
    m.markWorks('repeat');
    expect(seen).toEqual([
      { works: null, failed: ['volume'] },
      { works: 'repeat', failed: ['volume'] },
    ]);
    expect(m.describe()).toContain('works=repeat');
  });

  it('survives a browser without storage', () => {
    expect(loadProbeMemory()).toEqual({ works: null, failed: [] });
  });
});

describe('isRefusal', () => {
  it('is Spotify saying no, not a network problem', () => {
    expect(isRefusal({ status: 403 })).toBe(true);
    expect(isRefusal({ status: 404 })).toBe(true);
    expect(isRefusal({ status: 400 })).toBe(true);
    expect(isRefusal({ status: 429 })).toBe(false);
    expect(isRefusal({ status: 500 })).toBe(false);
    expect(isRefusal(new Error('Failed to fetch'))).toBe(false);
  });
});
