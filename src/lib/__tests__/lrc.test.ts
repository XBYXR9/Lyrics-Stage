import { describe, expect, it } from 'vitest';
import { estimateWords, findLineIndex, INTERLUDE_MIN_MS, parseLrc, parseLyricsfile, plainLyrics, singingPace, wordProgress } from '../lrc';

describe('parseLrc', () => {
  it('parses timestamps, skips metadata and marks the first gap as an interlude', () => {
    const lyrics = parseLrc('[ar:Someone]\n[00:10.00] Hello there\n[00:12.50]General Kenobi\n');
    const sung = lyrics.lines.filter((l) => !l.interlude);
    expect(lyrics.kind).toBe('synced');
    expect(lyrics.wordSynced).toBe(false);
    expect(sung.map((l) => [l.start, l.text])).toEqual([
      [10000, 'Hello there'],
      [12500, 'General Kenobi'],
    ]);
    expect(lyrics.lines[0].interlude).toBe(true);
    expect(lyrics.lines[0].end).toBeLessThan(10000);
  });

  it('supports mm:ss, 3-digit milliseconds and repeated timestamps', () => {
    const lyrics = parseLrc('[00:01] One\n[00:02.123][00:04.5]Chorus');
    const sung = lyrics.lines.filter((l) => !l.interlude);
    expect(sung.map((l) => l.start)).toEqual([1000, 2123, 4500]);
    expect(sung[2].text).toBe('Chorus');
  });

  it('applies the [offset] tag (positive = earlier)', () => {
    const lyrics = parseLrc('[offset:+500]\n[00:10.00]Line');
    expect(lyrics.lines.find((l) => !l.interlude)!.start).toBe(9500);
  });

  it('uses empty lines to end the previous line (instrumental breaks)', () => {
    const lyrics = parseLrc('[00:01.00]Sing\n[00:03.00]\n[00:20.00]Again');
    const sing = lyrics.lines.find((l) => l.text === 'Sing')!;
    expect(sing.end).toBeLessThanOrEqual(3000);
    const breakLine = lyrics.lines.find((l) => l.interlude && l.start > 1000)!;
    expect(breakLine).toBeDefined();
    expect(breakLine.end).toBeLessThan(20000);
  });

  it('reads enhanced LRC word timings', () => {
    const lyrics = parseLrc('[00:05.00]<00:05.00>Word <00:05.50>by <00:06.00>word<00:07.00>');
    const line = lyrics.lines.find((l) => !l.interlude)!;
    expect(lyrics.wordSynced).toBe(true);
    expect(line.words.map((w) => [w.text.trim(), w.start, w.end])).toEqual([
      ['Word', 5000, 5500],
      ['by', 5500, 6000],
      ['word', 6000, 7000],
    ]);
    expect(line.end).toBe(7000);
  });

  it('marks backing vocals in parentheses and detects right-to-left text', () => {
    const lyrics = parseLrc('[00:01.00](Oh oh) here we go\n[00:03.00]يا قمر الليل');
    const [first, second] = lyrics.lines.filter((l) => !l.interlude);
    expect(first.words.map((w) => !!w.backing)).toEqual([true, true, false, false, false]);
    expect(second.rtl).toBe(true);
    expect(first.rtl).toBe(false);
  });

  it('treats "♪" lines as instrumental breaks', () => {
    const lyrics = parseLrc('[00:01.00]Sing\n[00:03.00]♪\n[00:20.00]Again');
    expect(lyrics.lines.some((l) => l.text === '♪')).toBe(false);
    expect(lyrics.lines.filter((l) => l.interlude).length).toBeGreaterThanOrEqual(1);
  });

  it('returns kind "none" for text without timestamps', () => {
    expect(parseLrc('just words').kind).toBe('none');
  });
});

describe('estimateWords', () => {
  it('covers the whole span, in order, giving longer words more time', () => {
    const words = estimateWords('a wonderful day', 1000, 4000);
    expect(words[0].start).toBe(1000);
    expect(words[words.length - 1].end).toBe(4000);
    for (let i = 1; i < words.length; i++) expect(words[i].start).toBe(words[i - 1].end);
    const dur = words.map((w) => w.end - w.start);
    expect(dur[1]).toBeGreaterThan(dur[0]);
  });
});

describe('estimated word timing', () => {
  const at = (ms: number) => {
    const s = ms / 1000;
    return `[${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}]`;
  };
  // Ten lines sung back to back, 2 s each, then a short line followed by a 5 s pause.
  const dense = Array.from({ length: 10 }, (_, i) => `${at(10_000 + i * 2000)}Running through the city lights`);
  const lyrics = parseLrc([...dense, `${at(30_000)}Running through the city lights`, `${at(35_000)}Again`].join('\n'));

  it("measures the song's pace from lines sung back to back", () => {
    const pace = singingPace(dense.map((_, i) => ({ text: 'Running through the city lights', gapMs: i < 9 ? 2000 : 5000 })));
    expect(pace).toBeGreaterThan(60);
    expect(pace).toBeLessThan(90);
  });

  it("doesn't stretch a line over the pause after it", () => {
    const beforePause = lyrics.lines.find((l) => l.start === 30_000)!;
    const lastWord = beforePause.words[beforePause.words.length - 1];
    // Sung at the same pace as the others (about 2 s), not spread over 4.5 s.
    expect(lastWord.end - beforePause.start).toBeLessThan(2600);
    const dense0 = lyrics.lines.find((l) => l.start === 10_000)!;
    expect(dense0.words[dense0.words.length - 1].end - dense0.start).toBeGreaterThan(1500);
  });
});

describe('parseLyricsfile', () => {
  it('reads word timings from LRCLIB YAML', () => {
    const yaml = [
      'lines:',
      '- text: Hello world',
      '  start_ms: 1000',
      '  end_ms: 2000',
      '  words:',
      '  - text: "Hello "',
      '    start_ms: 1000',
      '    end_ms: 1400',
      '  - text: world',
      '    start_ms: 1400',
      '    end_ms: 2000',
    ].join('\n');
    const lyrics = parseLyricsfile(yaml)!;
    expect(lyrics.wordSynced).toBe(true);
    const line = lyrics.lines.find((l) => !l.interlude)!;
    expect(line.words.map((w) => [w.text, w.start, w.end])).toEqual([
      ['Hello ', 1000, 1400],
      ['world', 1400, 2000],
    ]);
  });

  it('returns null for broken YAML', () => {
    expect(parseLyricsfile('lines: [')).toBeNull();
  });
});

describe('timeline helpers', () => {
  const lyrics = parseLrc(`[00:${String(INTERLUDE_MIN_MS / 1000 + 1).padStart(2, '0')}.00]A\n[00:08.00]B\n[00:09.00]C`);
  it('finds the current line with binary search', () => {
    const idx = (t: number) => lyrics.lines[findLineIndex(lyrics.lines, t)]?.text ?? null;
    expect(findLineIndex(lyrics.lines, 0)).toBe(-1);
    expect(idx(8500)).toBe('B');
    expect(idx(60000)).toBe('C');
  });

  it('computes word progress', () => {
    const w = { text: 'x', start: 1000, end: 2000 };
    expect(wordProgress(w, 500)).toBe(0);
    expect(wordProgress(w, 1500)).toBe(0.5);
    expect(wordProgress(w, 2500)).toBe(1);
  });

  it('plain lyrics keep blank lines', () => {
    const p = plainLyrics('a\n\nb', 'test');
    expect(p.kind).toBe('plain');
    expect(p.lines.map((l) => l.text)).toEqual(['a', '', 'b']);
  });
});
