import { afterEach, describe, expect, it, vi } from 'vitest';
import { setClientId, usesBuiltInClientId } from '../auth';
import { friendlyError, SpotifyError } from '../spotify';

const BUILT_IN = 'a'.repeat(32);
const OWN = 'b'.repeat(32);

/** A pretend browser storage. */
function storage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
}

const notOnTheList = new SpotifyError(403, 'User not registered in the Developer Dashboard');

describe('the Client ID built into the app', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('is only "built in" when this version has one and it is the one in use', () => {
    storage();
    expect(usesBuiltInClientId()).toBe(false); // this version has none
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', BUILT_IN);
    expect(usesBuiltInClientId()).toBe(true);
    // The start screen saves the Client ID it shows when you sign in: that is still the built-in one
    setClientId(BUILT_IN);
    expect(usesBuiltInClientId()).toBe(true);
    // A Client ID of your own is not
    setClientId(OWN);
    expect(usesBuiltInClientId()).toBe(false);
  });

  it('tells someone who is not on the list of the built-in Spotify app what to do about it', () => {
    storage();
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', BUILT_IN);
    const text = friendlyError(notOnTheList);
    expect(text).toMatch(/built into this version/);
    expect(text).toMatch(/Use a different Client ID/);
    expect(text).not.toMatch(/Add its email under User Management/);
  });

  it('still tells the owner of a Spotify app to add the account, when the app is their own', () => {
    storage();
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', BUILT_IN);
    setClientId(OWN);
    expect(friendlyError(notOnTheList)).toMatch(/Add its email under User Management/);
  });

  it('says the same as before when this version has no Client ID built in', () => {
    storage();
    expect(friendlyError(notOnTheList)).toMatch(/Add its email under User Management/);
  });
});
