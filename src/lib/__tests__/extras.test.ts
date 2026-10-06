import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyColorTheme, COLOR_THEMES, hexToHsl, isHexColor, themeAccent } from '../colorTheme';
import { FALLBACK_PALETTE } from '../palette';
import { formatLeft, SLEEP_FADE_MS, sleepDim } from '../sleepTimer';
import { forgetAllSongs, getSongPrefs, MAX_REMEMBERED_SONGS, rememberSong, trimMemory } from '../songMemory';
import { chunkTexts, parseAnswer, translateLines } from '../translate';
import { fitSize } from '../wallpaper';
import { CARD_TEXT_STYLES } from '../lyricCard';
import { STYLES } from '../../components/styles';
import { typedCount } from '../../components/styles/TypewriterStyle';
import type { LyricLine } from '../types';

describe('color themes', () => {
  it('keeps the album colors for "album" and for a broken custom color', () => {
    expect(applyColorTheme(FALLBACK_PALETTE, 'album', '#ff0000')).toBe(FALLBACK_PALETTE);
    expect(applyColorTheme(FALLBACK_PALETTE, 'custom', 'red')).toBe(FALLBACK_PALETTE);
    expect(themeAccent('nonsense', '#ff0000')).toBeNull();
  });

  it('builds a whole palette from one color', () => {
    const p = applyColorTheme(FALLBACK_PALETTE, 'custom', '#3da5ff');
    expect(p.accent).toMatch(/^hsl\(/);
    expect(p.colors).toHaveLength(5);
    expect(p.base).not.toBe(FALLBACK_PALETTE.base);
    // hue stays blue
    expect(hexToHsl('#3da5ff').h).toBeGreaterThan(190);
    expect(hexToHsl('#3da5ff').h).toBeLessThan(220);
  });

  it('checks hex colors and lists a ready-made theme for every id', () => {
    expect(isHexColor('#a1B2c3')).toBe(true);
    expect(isHexColor('#abc')).toBe(false);
    for (const t of COLOR_THEMES.filter((t) => t.id !== 'album' && t.id !== 'custom')) expect(themeAccent(t.id, '#000000')).toBe(t.accent);
  });
});

describe('remembering songs', () => {
  afterEach(() => forgetAllSongs());

  it('keeps a style and a nudge per song, and forgets a nudge of 0', () => {
    rememberSong('a', { style: 'neon' });
    rememberSong('a', { nudgeMs: 500 });
    expect(getSongPrefs('a')).toMatchObject({ style: 'neon', nudgeMs: 500 });
    rememberSong('a', { nudgeMs: 0 });
    expect(getSongPrefs('a')?.nudgeMs).toBeUndefined();
    expect(getSongPrefs('a')?.style).toBe('neon');
  });

  it('forgets a song with nothing left to remember', () => {
    rememberSong('b', { nudgeMs: 300 });
    rememberSong('b', { nudgeMs: 0 });
    expect(getSongPrefs('b')).toBeNull();
  });

  it('keeps only the newest songs', () => {
    const m = Object.fromEntries(Array.from({ length: MAX_REMEMBERED_SONGS + 5 }, (_, i) => [`s${i}`, { nudgeMs: 1, at: i }]));
    const kept = trimMemory(m);
    expect(Object.keys(kept)).toHaveLength(MAX_REMEMBERED_SONGS);
    expect(kept.s0).toBeUndefined();
    expect(kept[`s${MAX_REMEMBERED_SONGS + 4}`]).toBeDefined();
  });
});

describe('translation', () => {
  const line = (id: number, text: string, over: Partial<LyricLine> = {}): LyricLine => ({ id, start: id * 1000, end: id * 1000 + 900, text, words: [], ...over });

  afterEach(() => vi.unstubAllGlobals());

  it('cuts texts into groups of limited size', () => {
    const groups = chunkTexts(['aaaa', 'bbbb', 'cccc'], 10);
    expect(groups).toEqual([['aaaa', 'bbbb'], ['cccc']]);
    expect(chunkTexts([], 10)).toEqual([]);
  });

  it('reads the answer of the translate service', () => {
    expect(parseAnswer([[['Hello\n', 'Hola\n'], ['World', 'Mundo']], null, 'es'])).toEqual({ text: 'Hello\nWorld', from: 'es' });
    expect(parseAnswer({})).toBeNull();
  });

  it('translates the sung lines, skipping breaks and lines that did not change', async () => {
    const answer = [[['Hello\nSame\nBye', '']], null, 'es'];
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => answer }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await translateLines([line(0, 'Hola'), line(1, '•••', { interlude: true }), line(2, 'Same'), line(3, 'Adiós')], 'en');
    expect(out.from).toBe('es');
    expect(out.lines).toEqual(['Hello', '', '', 'Bye']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('tl=en');
  });

  it('asks line by line when the answer lost the line breaks', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [[['all in one line', '']], null, 'fr'] })
      .mockResolvedValue({ ok: true, json: async () => [[['one', '']], null, 'fr'] });
    vi.stubGlobal('fetch', fetchMock);
    const out = await translateLines([line(0, 'un'), line(1, 'deux')], 'en');
    expect(out.lines).toEqual(['one', 'one']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('sleep timer', () => {
  it('stays bright until the last minute, then dims, and is dark when done', () => {
    const end = 1_000_000;
    expect(sleepDim(null, false, 0)).toBe(0);
    expect(sleepDim(end, false, end - SLEEP_FADE_MS - 1)).toBe(0);
    const half = sleepDim(end, false, end - SLEEP_FADE_MS / 2);
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.6);
    expect(sleepDim(end, false, end)).toBeCloseTo(0.92);
    expect(sleepDim(null, true, 0)).toBeGreaterThan(0.95);
  });

  it('shows the time left', () => {
    expect(formatLeft(45_000)).toBe('45s');
    expect(formatLeft(125_000)).toBe('2:05');
    expect(formatLeft(-5)).toBe('0s');
  });
});

describe('background picture', () => {
  it('shrinks big pictures but never enlarges small ones', () => {
    expect(fitSize(3200, 1600, 1600)).toEqual({ w: 1600, h: 800 });
    expect(fitSize(800, 600, 1600)).toEqual({ w: 800, h: 600 });
  });
});

describe('lyric styles', () => {
  it('every style has a name, a blurb and a way to be written on a card', () => {
    expect(STYLES.map((s) => s.id)).toEqual(expect.arrayContaining(['typewriter', 'flow', 'retro', 'minimal', 'depth']));
    for (const s of STYLES) {
      expect(s.name).toBeTruthy();
      expect(s.blurb).toBeTruthy();
      expect(CARD_TEXT_STYLES[s.id]).toBeDefined();
    }
  });

  it('types a word out between its start and its end', () => {
    const l: LyricLine = {
      id: 0,
      start: 0,
      end: 2000,
      text: 'abcd ef',
      words: [
        { text: 'abcd ', start: 0, end: 1000 },
        { text: 'ef', start: 1000, end: 2000 },
      ],
    };
    expect(typedCount(l, -1)).toBe(0);
    expect(typedCount(l, 500)).toBe(2);
    expect(typedCount(l, 1000)).toBe(4);
    expect(typedCount(l, 1500)).toBe(5);
    expect(typedCount(l, 5000)).toBe(6);
  });
});
