import { describe, expect, it } from 'vitest';
import { cleanTitle } from '../lyrics';
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
  ])('%s → %s', (input, expected) => {
    expect(cleanTitle(input)).toBe(expected);
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
