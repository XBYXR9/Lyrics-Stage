import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cardFileName,
  cardLines,
  CARD_FORMATS,
  defaultSelection,
  fitText,
  formatOf,
  layoutLyrics,
  MAX_CARD_LINES,
  wrapBalanced,
  wrapLine,
  type Measure,
} from '../lyricCard';
import type { LyricLine } from '../types';

// Every character is half as wide as the font is high.
const measure: Measure = (text, size) => text.length * size * 0.5;
const line = (id: number, text: string, start = id * 4000, over: Partial<LyricLine> = {}): LyricLine => ({ id, start, end: start + 3000, text, words: [], ...over });

describe('which lines can go on a card', () => {
  it('leaves out the pauses and empty lines, and keeps the song order', () => {
    const lines = [line(0, 'First'), line(1, '•••', 4000, { interlude: true }), line(2, '   '), line(3, 'Second')];
    expect(cardLines(lines).map((l) => l.id)).toEqual([0, 3]);
  });

  it('starts with the line being sung and the next one', () => {
    const lines = Array.from({ length: 6 }, (_, i) => line(i, `Line ${i}`)); // lines start at 0, 4, 8, 12... s
    expect(defaultSelection(lines, 9000)).toEqual([2, 3]);
    expect(defaultSelection(lines, 0)).toEqual([0, 1]);
    expect(defaultSelection(lines, 3000)).toEqual([0, 1]);
  });

  it('takes the last two when the last line is being sung, and the first two when there is no timing', () => {
    const lines = Array.from({ length: 6 }, (_, i) => line(i, `Line ${i}`));
    expect(defaultSelection(lines, 99_000)).toEqual([4, 5]);
    expect(defaultSelection(lines, null)).toEqual([0, 1]);
    expect(defaultSelection([line(0, 'Only')], 1000)).toEqual([0]);
    expect(defaultSelection([], 1000)).toEqual([]);
  });
});

describe('wrapping a lyric line', () => {
  it('breaks at spaces so that no row is wider than the box', () => {
    // 10 characters of a 20 px font are 100 px
    const rows = wrapLine('one two three four five six', 100, 20, measure);
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) expect(measure(r, 20)).toBeLessThanOrEqual(100);
    expect(rows.join(' ')).toBe('one two three four five six');
  });

  it('keeps a line that fits on one row, and collapses stray spaces', () => {
    expect(wrapLine('  hello   world ', 1000, 20, measure)).toEqual(['hello world']);
    expect(wrapLine('', 1000, 20, measure)).toEqual([]);
  });

  it('cuts a word that is wider than the whole row, between characters', () => {
    const rows = wrapLine('abcdefghijklmnopqrstuvwxyz', 100, 20, measure);
    expect(rows.length).toBeGreaterThan(2);
    for (const r of rows) expect(measure(r, 20)).toBeLessThanOrEqual(100);
    expect(rows.join('')).toBe('abcdefghijklmnopqrstuvwxyz');
  });

  it('breaks text without spaces (Japanese, Chinese) between characters', () => {
    const text = '夜に駆ける君と僕の物語がはじまる';
    const rows = wrapLine(text, 100, 20, measure);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.join('')).toBe(text);
  });

  it('balances the rows, so the last one is not a single orphan word', () => {
    const text = 'We could dance until the morning comes again';
    const plain = wrapLine(text, 330, 20, measure);
    const balanced = wrapBalanced(text, 330, 20, measure);
    expect(balanced).toHaveLength(plain.length); // never more rows than before
    const shortest = (rows: string[]) => Math.min(...rows.map((r) => r.length));
    expect(shortest(balanced)).toBeGreaterThanOrEqual(shortest(plain));
    expect(balanced.join(' ')).toBe(text);
    for (const r of balanced) expect(measure(r, 20)).toBeLessThanOrEqual(330);
  });
});

describe('laying the lyrics out in the space there is', () => {
  const text = (...t: string[]) => t.map((x) => ({ text: x }));

  it('makes a short line as big as allowed, and a longer one smaller to fit', () => {
    const short = layoutLyrics(text('Hold on'), 900, 900, measure);
    const long = layoutLyrics(text('Every light was calling out my name tonight and forever'), 900, 500, measure);
    expect(short.size).toBe(112);
    expect(long.size).toBeLessThan(short.size);
    expect(long.height).toBeLessThanOrEqual(500);
    expect(long.shown).toBe(long.total);
  });

  it('puts the rows of each lyric line together and marks where a new line starts', () => {
    const layout = layoutLyrics(text('one two three four five six seven', 'eight nine'), 600, 900, measure);
    expect(layout.rows.filter((r) => r.lineStart)).toHaveLength(2);
    expect(layout.rows[0].lineStart).toBe(true);
  });

  it('leaves the last lines off, instead of making the text unreadable, when they do not fit', () => {
    const many = text(...Array.from({ length: 10 }, (_, i) => `This is a fairly long lyric line number ${i} that takes room`));
    const layout = layoutLyrics(many, 800, 700, measure);
    expect(layout.size).toBe(44);
    expect(layout.total).toBe(10);
    expect(layout.shown).toBeLessThan(10);
    expect(layout.shown).toBeGreaterThanOrEqual(1);
    expect(layout.height).toBeLessThanOrEqual(700);
  });

  it('says there is nothing to show for no lines, and keeps right-to-left lines marked', () => {
    expect(layoutLyrics([], 800, 700, measure)).toMatchObject({ rows: [], shown: 0, total: 0 });
    const rtl = layoutLyrics([{ text: 'مرحبا بالعالم', rtl: true }], 800, 700, measure);
    expect(rtl.rows.every((r) => r.rtl)).toBe(true);
  });
});

describe('the rest of the card', () => {
  it('cuts a long title with an ellipsis, and leaves a short one alone', () => {
    expect(fitText('Short', 500, 40, measure)).toBe('Short');
    const cut = fitText('A really quite long song title that cannot fit', 300, 40, measure);
    expect(cut.endsWith('…')).toBe(true);
    expect(measure(cut, 40)).toBeLessThanOrEqual(300);
  });

  it('names the file after the song, without characters Windows does not allow', () => {
    expect(cardFileName('Song B', 'The Artist')).toBe('Lyrics Stage - Song B - The Artist.png');
    expect(cardFileName('AC/DC: Back in "Black"?', 'x')).toBe('Lyrics Stage - AC DC Back in Black - x.png');
    expect(cardFileName('', '')).toBe('Lyrics Stage - lyric card.png');
    expect(cardFileName('x'.repeat(200), '').length).toBeLessThan(110);
  });

  it('has a story, a post and a square, and keeps the story clear of the buttons and the caption', () => {
    expect(CARD_FORMATS.map((f) => f.id)).toEqual(['story', 'post', 'square']);
    const story = formatOf('story');
    expect([story.w, story.h]).toEqual([1080, 1920]);
    expect(story.bottom).toBeGreaterThan(story.top); // the caption takes more room than the top
    expect(formatOf('square')).toMatchObject({ w: 1080, h: 1080 });
    expect(formatOf('post')).toMatchObject({ w: 1080, h: 1350 });
    expect(MAX_CARD_LINES).toBeGreaterThanOrEqual(6);
  });
});

describe('getting the picture out', () => {
  afterEach(() => {
    vi.doUnmock('../nativeApp');
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const load = async (native: boolean) => {
    vi.resetModules();
    vi.doMock('../nativeApp', () => ({ isNativeApp: () => native }));
    return import('../shareCard');
  };

  it('can only share in the Android app (its web view cannot download or copy pictures)', async () => {
    const { shareAbilities } = await load(true);
    expect(shareAbilities()).toEqual({ save: false, copy: false, share: true });
  });

  it('can save in the desktop app and a browser, and copy where the clipboard takes pictures', async () => {
    vi.stubGlobal('navigator', { clipboard: { write: () => Promise.resolve() } });
    vi.stubGlobal('ClipboardItem', class {});
    const { shareAbilities } = await load(false);
    expect(shareAbilities()).toMatchObject({ save: true, copy: true, share: false });
    vi.stubGlobal('navigator', {});
    expect(shareAbilities()).toMatchObject({ save: true, copy: false, share: false });
  });

  it('is not an error when the share sheet is closed without sharing', async () => {
    vi.stubGlobal('navigator', {
      share: () => Promise.reject(Object.assign(new Error('Share canceled'), { name: 'AbortError' })),
    });
    const { shareBlob } = await load(false);
    expect(await shareBlob(new Blob(['x']), 'card.png', 'text')).toBe(false);
    vi.stubGlobal('navigator', { share: () => Promise.reject(new Error('The sky fell')) });
    await expect(shareBlob(new Blob(['x']), 'card.png', 'text')).rejects.toThrow('The sky fell');
    vi.stubGlobal('navigator', { share: () => Promise.resolve() });
    expect(await shareBlob(new Blob(['x']), 'card.png', 'text')).toBe(true);
  });
});
