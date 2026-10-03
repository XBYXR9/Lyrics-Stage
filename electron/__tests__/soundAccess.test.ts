import { describe, expect, it } from 'vitest';
import { mayHearSound, parseSoundSource } from '../soundAccess';

const isApp = (url: string) => url.startsWith('file://');

describe('who may listen to the computer’s sound', () => {
  it('only the app’s own page, and only on Windows', () => {
    expect(mayHearSound('win32', 'file:///C:/app/dist/index.html', isApp)).toBe(true);
    expect(mayHearSound('win32', 'https://evil.example/', isApp)).toBe(false);
    expect(mayHearSound('win32', undefined, isApp)).toBe(false);
    expect(mayHearSound('darwin', 'file:///app/index.html', isApp)).toBe(false);
    expect(mayHearSound('linux', 'file:///app/index.html', isApp)).toBe(false);
  });
});

describe('how the sound is shared', () => {
  it('uses the app’s own page unless the screen way is asked for by name', () => {
    expect(parseSoundSource('screen')).toBe('screen');
    expect(parseSoundSource('frame')).toBe('frame');
    expect(parseSoundSource(undefined)).toBe('frame');
    expect(parseSoundSource({ evil: true })).toBe('frame');
    expect(parseSoundSource('window')).toBe('frame');
  });
});
