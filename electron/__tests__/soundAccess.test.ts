import { describe, expect, it } from 'vitest';
import { mayHearSound } from '../soundAccess';

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
