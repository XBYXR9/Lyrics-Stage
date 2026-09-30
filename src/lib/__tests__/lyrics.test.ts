import { describe, expect, it } from 'vitest';
import { cleanTitle, pickBest, primaryArtist, sameArtist, type LrclibRecord } from '../lyrics';
import { parseLrc } from '../lrc';
import { analyzeVibe, wordsPerSecond } from '../vibe';

describe('cleanTitle', () => {
  it.each([
    ['Yellow', 'Yellow'],
    ['Hey Jude - Remastered 2015', 'Hey Jude'],
    ['Stay (with Justin Bieber)', 'Stay'],
    ['Señorita (feat. Someone)', 'Señorita'],
    ['Song Name - Live at Wembley', 'Song Name'],
    ['Something - From "A Movie"', 'Something'],
    ['Cruel Summer (Taylor’s Version)', 'Cruel Summer (Taylor’s Version)'],
    ['All Too Well - Taylor\'s Version', 'All Too Well'],
    ['Track [Remastered]', 'Track'],
    ['Song (Radio Edit)', 'Song'],
    ['Song (Single Version)', 'Song'],
    ['Song (Sped Up)', 'Song'],
    ['Song (From "A Movie")', 'Song'],
    ['Song (2019 Mix)', 'Song'],
  ])('%s → %s', (input, expected) => {
    expect(cleanTitle(input)).toBe(expected);
  });
});

describe('primaryArtist', () => {
  it.each([
    ['Coldplay', 'Coldplay'],
    ['The Kid LAROI, Justin Bieber', 'The Kid LAROI'],
    ['Simon & Garfunkel', 'Simon & Garfunkel'],
    ['Charli xcx', 'Charli xcx'],
  ])('%s → %s', (input, expected) => expect(primaryArtist(input)).toBe(expected));
});

describe('sameArtist', () => {
  it.each([
    ['Beyoncé & JAY-Z', 'Beyonce, JAY Z', true],
    ['The Weeknd', 'The Weeknd, Daft Punk', true],
    ['Daft Punk', 'The Weeknd, Daft Punk', true],
    ['Coldplay', 'Coldplay feat. Rihanna', true],
    ['Some Cover Band', 'The Weeknd', false],
    ['', 'Anyone', false],
  ])('%s vs %s → %s', (theirs, ours, expected) => expect(sameArtist(theirs, ours)).toBe(expected));
});

describe('pickBest', () => {
  let id = 0;
  const rec = (over: Partial<LrclibRecord>): LrclibRecord => ({
    id: id++,
    trackName: 'Song',
    artistName: 'Artist',
    albumName: 'Album',
    duration: 200,
    instrumental: false,
    plainLyrics: 'words',
    syncedLyrics: '[00:01.00]words',
    ...over,
  });
  const ctx = { durationSec: 200, title: 'Song', artist: 'Artist', artistChecked: false };

  it('prefers the version with the same length', () => {
    const radioEdit = rec({ duration: 194 });
    const album = rec({ duration: 201 });
    expect(pickBest([radioEdit, album], ctx)).toBe(album);
  });

  it("leaves out other artists' versions (covers) unless the length matches closely", () => {
    const cover = rec({ artistName: 'Cover Band', duration: 205 });
    expect(pickBest([cover], ctx)).toBeNull();
    const translit = rec({ artistName: 'Артист', duration: 201 });
    expect(pickBest([translit], ctx)).toBe(translit);
  });

  it('still finds lyrics when the player gave no length, if the artist matches', () => {
    const right = rec({ duration: 250 });
    const other = rec({ artistName: 'Someone Else' });
    expect(pickBest([other, right], { ...ctx, durationSec: null })).toBe(right);
  });

  it('prefers synced lyrics over plain ones', () => {
    const plain = rec({ syncedLyrics: null });
    const synced = rec({ duration: 203 });
    expect(pickBest([plain, synced], ctx)).toBe(synced);
  });
});

describe('vibe', () => {
  const lrc = (lines: [number, string][]) =>
    parseLrc(lines.map(([s, t]) => `[00:${s.toFixed(2).padStart(5, '0')}]${t}`).join('\n'));

  it('measures words per second from line spacing', () => {
    const fast = lrc([
      [1, 'one two three four five six seven eight'],
      [3, 'one two three four five six seven eight'],
      [5, 'one two three four five six seven eight'],
      [7, 'end'],
    ]);
    const slow = lrc([
      [1, 'slow and low'],
      [7, 'slow and low'],
      [13, 'slow and low'],
      [19, 'end'],
    ]);
    expect(wordsPerSecond(fast)!).toBeGreaterThan(3);
    expect(wordsPerSecond(slow)!).toBeLessThan(1);
    expect(analyzeVibe(fast, null).autoStyle).toBe('kinetic');
    expect(analyzeVibe(slow, null).energy).toBeLessThan(analyzeVibe(fast, null).energy);
  });

  it('falls back to Apple Music style without synced lyrics', () => {
    expect(analyzeVibe(null, null).autoStyle).toBe('apple');
  });
});
