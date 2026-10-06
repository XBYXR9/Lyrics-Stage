// Translation of the lyric lines into the language the user prefers.
//
// The lines are sent (a few hundred characters at a time) to Google Translate's public web endpoint, which needs no key.
// It is not an official, supported API, so a failure is normal and just means no translation for that song.
// Translations are kept in this browser, so a song is only sent once per language.
import type { LyricLine } from './types';

/** Languages to translate into: the code the service wants, and the name shown in Settings. */
export const TRANSLATE_LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ar', name: 'العربية (Arabic)' },
  { code: 'es', name: 'Español (Spanish)' },
  { code: 'fr', name: 'Français (French)' },
  { code: 'de', name: 'Deutsch (German)' },
  { code: 'it', name: 'Italiano (Italian)' },
  { code: 'pt', name: 'Português (Portuguese)' },
  { code: 'ru', name: 'Русский (Russian)' },
  { code: 'tr', name: 'Türkçe (Turkish)' },
  { code: 'fa', name: 'فارسی (Persian)' },
  { code: 'ur', name: 'اردو (Urdu)' },
  { code: 'hi', name: 'हिन्दी (Hindi)' },
  { code: 'bn', name: 'বাংলা (Bengali)' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ja', name: '日本語 (Japanese)' },
  { code: 'ko', name: '한국어 (Korean)' },
  { code: 'zh-CN', name: '简体中文 (Chinese)' },
  { code: 'zh-TW', name: '繁體中文 (Chinese)' },
  { code: 'nl', name: 'Nederlands (Dutch)' },
  { code: 'pl', name: 'Polski (Polish)' },
  { code: 'sv', name: 'Svenska (Swedish)' },
  { code: 'he', name: 'עברית (Hebrew)' },
];

export const isTranslateLanguage = (code: string) => TRANSLATE_LANGUAGES.some((l) => l.code === code);

/** The most characters sent in one request. */
const CHUNK_CHARS = 1500;
const STORE_KEY = 'ls.translations.v1';
const MAX_STORED = 40;

export interface Translation {
  /** One entry per lyric line ('' where there is nothing to show). */
  lines: string[];
  /** The language the song was found to be in. */
  from: string;
}

/** Cuts the texts into groups whose joined length stays within `max` characters. Exported for tests. */
export function chunkTexts(texts: string[], max = CHUNK_CHARS): string[][] {
  const groups: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  for (const t of texts) {
    if (cur.length && size + t.length + 1 > max) {
      groups.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(t);
    size += t.length + 1;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

/** Reads the answer of the translate endpoint: the translated text, and the language it was translated from. */
export function parseAnswer(data: unknown): { text: string; from: string } | null {
  if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
  const text = (data[0] as unknown[])
    .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
    .join('');
  return { text, from: typeof data[2] === 'string' ? data[2] : '' };
}

async function request(text: string, to: string, signal?: AbortSignal) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`translate ${res.status}`);
  const parsed = parseAnswer(await res.json());
  if (!parsed) throw new Error('translate: unexpected answer');
  return parsed;
}

/** Translates a group of lines: in one request when the answer keeps the line breaks, otherwise line by line. */
async function translateGroup(texts: string[], to: string, signal?: AbortSignal): Promise<{ lines: string[]; from: string }> {
  const joined = await request(texts.join('\n'), to, signal);
  const split = joined.text.split('\n');
  if (split.length === texts.length) return { lines: split.map((l) => l.trim()), from: joined.from };
  const lines: string[] = [];
  let from = joined.from;
  for (const t of texts) {
    const one = await request(t, to, signal);
    lines.push(one.text.trim());
    from ||= one.from;
  }
  return { lines, from };
}

/** Translates the sung lines of a song. Lines without words (the "•••" breaks) stay empty. */
export async function translateLines(lines: LyricLine[], to: string, signal?: AbortSignal): Promise<Translation> {
  const wanted = lines.map((l) => (l.interlude ? '' : l.text.replace(/\s+/g, ' ').trim()));
  const indexes = wanted.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
  const out = wanted.map(() => '');
  let from = '';
  let at = 0;
  for (const group of chunkTexts(indexes.map((i) => wanted[i]))) {
    const done = await translateGroup(group, to, signal);
    from ||= done.from;
    done.lines.forEach((text, k) => (out[indexes[at + k]] = text));
    at += group.length;
  }
  // A line that came back the same as it went in has nothing to add.
  out.forEach((text, i) => {
    if (text.toLowerCase() === wanted[i].toLowerCase()) out[i] = '';
  });
  return { lines: out, from };
}

// ---- Remembering translations --------------------------------------------------------------------------------

const memory = new Map<string, Translation>();

const storeKey = (songKey: string, to: string) => `${to}|${songKey}`;

function readStore(): Record<string, Translation & { at: number }> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, Translation & { at: number }>) : {};
  } catch {
    return {};
  }
}

/** A translation made earlier, if there is one for these lines. */
export function cachedTranslation(songKey: string, to: string, lineCount: number): Translation | null {
  const k = storeKey(songKey, to);
  const hit = memory.get(k) ?? readStore()[k];
  return hit && hit.lines.length === lineCount ? hit : null;
}

function remember(songKey: string, to: string, t: Translation) {
  const k = storeKey(songKey, to);
  memory.set(k, t);
  try {
    const all = readStore();
    all[k] = { ...t, at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > MAX_STORED) {
      keys
        .sort((a, b) => (all[b].at ?? 0) - (all[a].at ?? 0))
        .slice(MAX_STORED)
        .forEach((old) => delete all[old]);
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* not kept */
  }
}

/** The translation of a song's lines: from this browser's memory, or asked for now (and then remembered). */
export async function getTranslation(songKey: string, lines: LyricLine[], to: string, signal?: AbortSignal): Promise<Translation> {
  const hit = cachedTranslation(songKey, to, lines.length);
  if (hit) return hit;
  const made = await translateLines(lines, to, signal);
  remember(songKey, to, made);
  return made;
}
