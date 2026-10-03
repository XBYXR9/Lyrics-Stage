import { describe, expect, it } from 'vitest';
import { loopbackAddress } from '../devAddress';

describe('loopbackAddress', () => {
  it('moves the web version from localhost to 127.0.0.1, keeping everything else', () => {
    expect(loopbackAddress('http://localhost:5173/', false)).toBe('http://127.0.0.1:5173/');
    expect(loopbackAddress('http://localhost:5173/callback?code=abc&state=x#top', false)).toBe(
      'http://127.0.0.1:5173/callback?code=abc&state=x#top',
    );
  });

  it('leaves 127.0.0.1 and real websites alone', () => {
    expect(loopbackAddress('http://127.0.0.1:5173/', false)).toBeNull();
    expect(loopbackAddress('https://lyrics.example.com/', false)).toBeNull();
    expect(loopbackAddress('http://localhost.example.com/', false)).toBeNull();
  });

  // The Android app's page lives at https://localhost; moving to 127.0.0.1 there is a blank page (version 0.6.0).
  it('never moves the Android app, which is served from https://localhost', () => {
    expect(loopbackAddress('https://localhost/', true)).toBeNull();
    expect(loopbackAddress('https://localhost/index.html', true)).toBeNull();
    expect(loopbackAddress('http://localhost/', true)).toBeNull();
  });

  it('does not touch an https://localhost page even outside the app', () => {
    expect(loopbackAddress('https://localhost/', false)).toBeNull();
  });

  it('survives an address it cannot read', () => {
    expect(loopbackAddress('not a link', false)).toBeNull();
  });
});
