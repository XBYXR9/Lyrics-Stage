// Turns lyric files into timed lines and words.
//
// Supported inputs:
//  • LRC:            [00:12.34] A line of lyrics
//  • Enhanced LRC:   [00:12.34]<00:12.34>Word <00:12.80>by <00:13.10>word
//  • LRCLIB "Lyricsfile" YAML with real word timings
//  • Plain text (no timings)
//
// When only line timings exist, word timings are *estimated* by spreading the
// line's singing time across its words (longer words get more time). That's
// what makes the Apple Music-style word sweep possible for most songs.

import { parse as parseYaml } from 'yaml';
import type { LyricLine, LyricWord, Lyrics } from './types';

interface RawWord {
  text: string;
  start: number;
  end?: number;
}

interface RawLine {
  start: number;
  end?: number;
  text: string;
  words?: RawWord[];
}

/** Gaps at least this long (with nothing sung) get the "•••" interlude. */
export const INTERLUDE_MIN_MS = 4500;

const MUSIC_ONLY_RE = /^[♪♫♩♬🎵🎶\s.…·•*-]+$/u;
const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LETTER_RE = /[\p{L}\p{N}]/gu;

export const isRtl = (text: string) => RTL_RE.test(text);

function parseTimestamp(tag: string): number | null {
  // mm:ss, mm:ss.xx, mm:ss.xxx, mm:ss:xx
  const m = /^(\d+):(\d{1,2})(?:[.:](\d{1,3}))?$/.exec(tag.trim());
  if (!m) return null;
  const frac = m[3] ? Number(m[3].padEnd(3, '0')) : 0;
  return Number(m[1]) * 60000 + Number(m[2]) * 1000 + frac;
}

/** How long a word "weighs" when spreading line time across words. */
function wordWeight(word: string): number {
  const letters = word.match(LETTER_RE)?.length ?? 0;
  const pause = /[,.;:!?،؛…]\s*$/.test(word) ? 1.5 : 0;
  return Math.max(1, letters) + 0.8 + pause;
}

/** Split a line into words, keeping each word's trailing space. */
export function splitWords(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

const letterCount = (text: string) => text.match(LETTER_RE)?.length ?? 0;

/** Singing pace (ms per letter) when a song gives us nothing to measure. */
export const DEFAULT_PACE_MS = 95;

/**
 * How fast this song is sung, in ms per letter. Measured on lines that run
 * straight into the next one (short gaps), where the gap is roughly the
 * singing time: rap comes out around 50, ballads around 150.
 */
export function singingPace(lines: { text: string; gapMs: number }[]): number {
  const samples = lines
    .filter((l) => l.gapMs >= 800 && l.gapMs <= 6000 && letterCount(l.text) >= 4)
    .map((l) => (l.gapMs * 0.9) / letterCount(l.text))
    .sort((a, b) => a - b);
  if (samples.length < 4) return DEFAULT_PACE_MS;
  // Lines followed by a pause make the gap look slower than the singing, so lean towards the faster lines.
  const pace = samples[Math.floor(samples.length * 0.35)];
  return Math.min(200, Math.max(45, pace));
}

/**
 * Estimate how long a line is actually sung, given the gap until the next
 * line and the song's pace. A line is never sung longer than its gap, but a
 * short line before a pause is sung quickly, not stretched over the pause.
 */
export function estimateSingingMs(text: string, gapMs: number, paceMs = DEFAULT_PACE_MS): number {
  const natural = letterCount(text) * paceMs * 1.15 + 250;
  return Math.max(Math.min(300, gapMs), Math.min(gapMs * 0.9, Math.max(600, natural)));
}

export function estimateWords(text: string, start: number, end: number): LyricWord[] {
  const parts = splitWords(text);
  const weights = parts.map(wordWeight);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(1, end - start);
  let acc = 0;
  return parts.map((part, i) => {
    const s = start + (acc / total) * span;
    acc += weights[i];
    const e = start + (acc / total) * span;
    return { text: part, start: Math.round(s), end: Math.round(e) };
  });
}

function markBacking(words: LyricWord[]): LyricWord[] {
  let depth = 0;
  return words.map((w) => {
    const opens = (w.text.match(/\(/g) ?? []).length;
    const closes = (w.text.match(/\)/g) ?? []).length;
    const backing = depth > 0 || opens > 0;
    depth = Math.max(0, depth + opens - closes);
    return backing ? { ...w, backing: true } : w;
  });
}

/**
 * Shared builder: sorts raw timed lines, estimates missing word timings,
 * and inserts interludes for long instrumental gaps.
 */
export function buildSynced(raw: RawLine[], source: string, durationMs?: number): Lyrics {
  const sorted = [...raw].sort((a, b) => a.start - b.start);
  const hasRealWords = sorted.some((l) => l.words && l.words.length > 0);
  const lines: LyricLine[] = [];
  let id = 0;
  const pace = singingPace(sorted.map((l, i) => ({ text: l.text, gapMs: (sorted[i + 1]?.start ?? Infinity) - l.start })));

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const text = cur.text.replace(/\s+/g, ' ').trim();
    // Empty entries (or just "♪") only mark the end of the previous line;
    // long gaps get the animated interlude dots below.
    if (!text || MUSIC_ONLY_RE.test(text)) continue;
    // The last line has no "next line"; assume a long gap so its length is
    // estimated from its text instead.
    const nextStart = sorted[i + 1]?.start ?? cur.end ?? (durationMs ? Math.min(durationMs, cur.start + 8000) : cur.start + 8000);
    const gap = Math.max(200, nextStart - cur.start);

    let words: LyricWord[];
    if (cur.words && cur.words.length) {
      words = cur.words
        .filter((w) => w.text.length > 0)
        .map((w, j, arr) => ({
          text: w.text,
          start: w.start,
          end: w.end ?? arr[j + 1]?.start ?? cur.end ?? Math.min(nextStart, w.start + 1500),
        }));
    } else {
      const singEnd = cur.end && cur.end > cur.start ? cur.end : cur.start + estimateSingingMs(text, gap, pace);
      words = estimateWords(text, cur.start, singEnd);
    }
    words = markBacking(words);
    const end = Math.max(cur.start + 200, words[words.length - 1]?.end ?? cur.start + gap * 0.9);
    lines.push({ id: id++, start: cur.start, end, text, words, rtl: isRtl(text) });
  }

  // Interludes: before the first line and in long gaps between lines.
  const withBreaks: LyricLine[] = [];
  let prevEnd = 0;
  for (const line of lines) {
    const gapStart = withBreaks.length === 0 ? 0 : prevEnd;
    if (line.start - gapStart >= INTERLUDE_MIN_MS) {
      withBreaks.push({
        id: id++,
        start: gapStart + (withBreaks.length === 0 ? 300 : 400),
        end: line.start - 250,
        text: '',
        words: [],
        interlude: true,
      });
    }
    withBreaks.push(line);
    prevEnd = line.end;
  }

  return { kind: withBreaks.length ? 'synced' : 'none', lines: withBreaks, wordSynced: hasRealWords, source };
}

/** Parse LRC / enhanced LRC text. */
export function parseLrc(text: string, source = 'LRC', durationMs?: number): Lyrics {
  let offset = 0;
  const raw: RawLine[] = [];
  for (const rowRaw of text.split(/\r?\n/)) {
    const row = rowRaw.trim();
    if (!row) continue;
    const offsetTag = /^\[offset:\s*([+-]?\d+)\s*\]$/i.exec(row);
    if (offsetTag) {
      offset = Number(offsetTag[1]);
      continue;
    }
    // Collect all leading [time] tags (a line can repeat at several times).
    const times: number[] = [];
    let rest = row;
    for (;;) {
      const m = /^\[([^\]]*)\]/.exec(rest);
      if (!m) break;
      const t = parseTimestamp(m[1]);
      if (t === null) break; // metadata like [ar:Artist]
      times.push(t);
      rest = rest.slice(m[0].length);
    }
    if (!times.length) continue;

    // Enhanced LRC word tags: <mm:ss.xx>
    let words: RawWord[] | undefined;
    let lineEnd: number | undefined;
    if (/<\d+:\d+(?:[.:]\d+)?>/.test(rest)) {
      words = [];
      const prefix = rest.slice(0, rest.indexOf('<'));
      if (prefix.trim()) words.push({ text: prefix, start: times[0] });
      const re = /<(\d+:\d+(?:[.:]\d+)?)>([^<]*)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(rest))) {
        const t = parseTimestamp(m[1]);
        if (t === null) continue;
        if (m[2].length === 0 || !m[2].trim()) {
          // A trailing tag closes the previous word.
          if (words.length) words[words.length - 1].end = t;
          lineEnd = t;
          if (m[2].length && words.length) words[words.length - 1].text += m[2];
          continue;
        }
        words.push({ text: m[2], start: t });
      }
      for (let i = 0; i < words.length - 1; i++) words[i].end ??= words[i + 1].start;
      rest = words.map((w) => w.text).join('');
    }

    // LRC offset: positive = lyrics come sooner.
    for (const t of times) {
      const shift = (v: number) => Math.max(0, v - offset + (t - times[0]));
      raw.push({
        start: Math.max(0, t - offset),
        end: lineEnd !== undefined ? shift(lineEnd) : undefined,
        text: rest,
        words: words?.map((w) => ({ text: w.text, start: shift(w.start), end: w.end !== undefined ? shift(w.end) : undefined })),
      });
    }
  }
  return buildSynced(raw, source, durationMs);
}

interface LyricsfileDoc {
  lines?: {
    text?: string;
    start_ms?: number;
    end_ms?: number;
    words?: { text?: string; start_ms?: number; end_ms?: number }[];
  }[];
}

/** Parse LRCLIB's YAML "Lyricsfile" (used for word-by-word timing). */
export function parseLyricsfile(yamlText: string, source = 'LRCLIB', durationMs?: number): Lyrics | null {
  let doc: LyricsfileDoc;
  try {
    doc = parseYaml(yamlText) as LyricsfileDoc;
  } catch {
    return null;
  }
  if (!doc?.lines?.length) return null;
  const raw: RawLine[] = [];
  for (const l of doc.lines) {
    if (typeof l.start_ms !== 'number') continue;
    const words = (l.words ?? [])
      .filter((w) => typeof w.start_ms === 'number' && typeof w.text === 'string')
      .map((w) => ({ text: String(w.text), start: w.start_ms!, end: w.end_ms }));
    raw.push({
      start: l.start_ms,
      end: typeof l.end_ms === 'number' ? l.end_ms : undefined,
      text: String(l.text ?? words.map((w) => w.text).join('')),
      words: words.length ? words : undefined,
    });
  }
  const lyrics = buildSynced(raw, source, durationMs);
  return lyrics.lines.length ? lyrics : null;
}

/** Lyrics without timings: shown as a static, scrollable page. */
export function plainLyrics(text: string, source: string): Lyrics {
  const lines: LyricLine[] = text
    .split(/\r?\n/)
    .map((t) => t.trim())
    .map((t, i) => ({
      id: i,
      start: 0,
      end: 0,
      text: t,
      words: splitWords(t).map((w) => ({ text: w, start: 0, end: 0 })),
      rtl: isRtl(t),
    }));
  return { kind: 'plain', lines, wordSynced: false, source };
}

/** Index of the line that should be highlighted at time t (or -1 before the first). */
export function findLineIndex(lines: LyricLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** 0..1 progress through a word at time t. */
export function wordProgress(w: LyricWord, t: number): number {
  if (t <= w.start) return 0;
  if (t >= w.end) return 1;
  return (t - w.start) / Math.max(1, w.end - w.start);
}
