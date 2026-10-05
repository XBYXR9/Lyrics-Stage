// The lyric card: a picture of a few lyric lines in the album's colors, with the cover and the song's name,
// made to be posted or sent (a story or TikTok photo, an Instagram post, a square picture).
//
// The pieces that decide what goes where (which lines, how the text wraps and how big it can be) are plain
// functions that take a "measure" for text width, so they can be tested without a screen. drawCard paints it all.

import type { LyricLine, Palette } from './types';

export type CardFormat = 'story' | 'post' | 'square';
export type CardLook = 'cover' | 'gradient';

export interface FormatSpec {
  id: CardFormat;
  label: string;
  ratio: string;
  w: number;
  h: number;
  /**
   * Room kept free on each side, in pixels. For the 9:16 story that is where TikTok and Instagram put their own
   * buttons and caption, so nothing important sits under them.
   */
  top: number;
  bottom: number;
  side: number;
}

export const CARD_FORMATS: FormatSpec[] = [
  { id: 'story', label: 'Story', ratio: '9:16', w: 1080, h: 1920, top: 230, bottom: 420, side: 96 },
  { id: 'post', label: 'Post', ratio: '4:5', w: 1080, h: 1350, top: 110, bottom: 110, side: 96 },
  { id: 'square', label: 'Square', ratio: '1:1', w: 1080, h: 1080, top: 96, bottom: 96, side: 96 },
];

export const formatOf = (id: CardFormat): FormatSpec => CARD_FORMATS.find((f) => f.id === id) ?? CARD_FORMATS[0];

/** At most this many lines go on one card (more would be too small to read anyway). */
export const MAX_CARD_LINES = 10;

/** Text width in pixels for the given text at the given font size. */
export type Measure = (text: string, sizePx: number) => number;

export interface CardLine {
  text: string;
  rtl?: boolean;
}

/** The lines of a song that can go on a card: sung lines with some text, in song order (not the "•••" pauses). */
export function cardLines(lines: LyricLine[]): LyricLine[] {
  return lines.filter((l) => !l.interlude && l.text.trim().length > 0);
}

/**
 * The lines selected when the card opens: the line being sung at `timeMs` and the next one (or the one before it,
 * when it is the last). Without a time (plain lyrics) the first two. Returns line ids.
 */
export function defaultSelection(candidates: LyricLine[], timeMs: number | null, count = 2): number[] {
  if (!candidates.length) return [];
  let at = 0;
  if (timeMs !== null) {
    for (let i = 0; i < candidates.length; i++) if (candidates[i].start <= timeMs) at = i;
  }
  const from = Math.max(0, Math.min(at, candidates.length - count));
  return candidates.slice(from, from + count).map((l) => l.id);
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Breaks one lyric line into rows no wider than `maxWidth`, at spaces (or between characters, for text without spaces). */
export function wrapLine(text: string, maxWidth: number, size: number, measure: Measure): string[] {
  const t = clean(text);
  if (!t) return [];
  const spaced = /\s/.test(t);
  const tokens = spaced ? t.split(' ') : Array.from(t);
  const join = spaced ? ' ' : '';
  const rows: string[] = [];
  let row = '';
  // One word wider than the whole row (a long word, a url): cut it between characters.
  const place = (token: string) => {
    if (measure(token, size) <= maxWidth) {
      row = token;
      return;
    }
    let piece = '';
    for (const ch of Array.from(token)) {
      if (piece && measure(piece + ch, size) > maxWidth) {
        rows.push(piece);
        piece = '';
      }
      piece += ch;
    }
    row = piece;
  };
  for (const token of tokens) {
    if (!row) place(token);
    else if (measure(row + join + token, size) <= maxWidth) row += join + token;
    else {
      rows.push(row);
      row = '';
      place(token);
    }
  }
  if (row) rows.push(row);
  return rows;
}

export interface LyricRow {
  text: string;
  rtl: boolean;
  /** The first row of a lyric line (a little more space goes above it). */
  lineStart: boolean;
}

export interface LyricLayout {
  /** Font size in pixels. */
  size: number;
  /** Row height as a multiple of the font size. */
  leading: number;
  /** Extra space between two lyric lines, as a multiple of the font size. */
  lineGap: number;
  rows: LyricRow[];
  /** Height of all the rows, in pixels. */
  height: number;
  /** How many of the lines fit (fewer than `total` when the rest had to be left off). */
  shown: number;
  total: number;
}

const MAX_SIZE = 112;
const MIN_SIZE = 44;
const LEADING = 1.2;
const LINE_GAP = 0.5;

/**
 * Like wrapLine, but with the rows about the same length: the narrowest width that still gives the same number of
 * rows (what CSS calls text-wrap: balance), so a line doesn't end with one word on a row of its own.
 */
export function wrapBalanced(text: string, maxWidth: number, size: number, measure: Measure): string[] {
  const rows = wrapLine(text, maxWidth, size, measure);
  if (rows.length < 2) return rows;
  let lo = maxWidth * 0.4;
  let hi = maxWidth;
  while (hi - lo > 3) {
    const mid = (lo + hi) / 2;
    if (wrapLine(text, mid, size, measure).length <= rows.length) hi = mid;
    else lo = mid;
  }
  return wrapLine(text, hi, size, measure);
}

function rowsAt(lines: CardLine[], width: number, size: number, measure: Measure): LyricRow[] {
  const rows: LyricRow[] = [];
  for (const line of lines) {
    wrapBalanced(line.text, width, size, measure).forEach((text, k) => rows.push({ text, rtl: !!line.rtl, lineStart: k === 0 }));
  }
  return rows;
}

const heightOf = (rows: LyricRow[], size: number) =>
  rows.length * size * LEADING + rows.filter((r) => r.lineStart).slice(1).length * size * LINE_GAP;

/**
 * Finds the biggest text size at which all the lines fit in the box. If they don't even fit at the smallest size
 * (too many, or too long), the last lines are left off rather than made unreadable: `shown` says how many fit.
 */
export function layoutLyrics(lines: CardLine[], width: number, height: number, measure: Measure): LyricLayout {
  const total = lines.length;
  const done = (size: number, rows: LyricRow[], shown: number): LyricLayout => ({
    size,
    leading: LEADING,
    lineGap: LINE_GAP,
    rows,
    height: heightOf(rows, size),
    shown,
    total,
  });
  if (!total) return done(MAX_SIZE, [], 0);
  for (let size = MAX_SIZE; size >= MIN_SIZE; size -= 2) {
    const rows = rowsAt(lines, width, size, measure);
    if (heightOf(rows, size) <= height) return done(size, rows, total);
  }
  for (let n = total - 1; n >= 1; n--) {
    const rows = rowsAt(lines.slice(0, n), width, MIN_SIZE, measure);
    if (heightOf(rows, MIN_SIZE) <= height) return done(MIN_SIZE, rows, n);
  }
  // Even one line is too long: as many of its rows as fit.
  let rows = rowsAt(lines.slice(0, 1), width, MIN_SIZE, measure);
  while (rows.length > 1 && heightOf(rows, MIN_SIZE) > height) rows = rows.slice(0, -1);
  return done(MIN_SIZE, rows, 1);
}

/** Cuts text to fit a width, with "…" at the end when something had to go. */
export function fitText(text: string, maxWidth: number, size: number, measure: Measure): string {
  const t = clean(text);
  if (measure(t, size) <= maxWidth) return t;
  const chars = Array.from(t);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(chars.slice(0, mid).join('').trimEnd() + '…', size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join('').trimEnd() + '…';
}

/** A file name for the picture: "Lyrics Stage - Song - Artist.png", without characters Windows doesn't allow. */
export function cardFileName(title: string, artist: string): string {
  const part = (s: string) =>
    s
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const name = [part(title), part(artist)].filter(Boolean).join(' - ');
  return `Lyrics Stage - ${(name || 'lyric card').slice(0, 80).trim()}.png`;
}

// ---- Painting ---------------------------------------------------------------------------------------------

export interface CardOptions {
  format: CardFormat;
  look: CardLook;
  lines: CardLine[];
  title: string;
  artist: string;
  /** The cover, if it could be loaded (a picture from another site that doesn't allow it can't be used). */
  cover: HTMLImageElement | null;
  palette: Palette;
  showInfo: boolean;
  mark: boolean;
  /** CSS font-family list for the text. */
  family: string;
}

const COVER = 168;

/** The text font from the page's own style (the one the Apple Music look uses), with plain fallbacks. */
export function cardFontFamily(): string {
  const fallback = `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans Arabic', system-ui, sans-serif`;
  try {
    return getComputedStyle(document.documentElement).getPropertyValue('--font-apple').trim() || fallback;
  } catch {
    return fallback;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The cover, scaled up to fill and softened by shrinking it, blurring it a little and stretching it back. */
function paintCoverBackground(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number, palette: Palette) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const stage = (width: number) => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.max(1, Math.round((width * h) / w));
    return c;
  };
  const small = stage(72);
  const sctx = small.getContext('2d')!;
  const scale = Math.max(small.width / iw, small.height / ih) * 1.3;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(img, (small.width - iw * scale) / 2, (small.height - ih * scale) / 2, iw * scale, ih * scale);
  const mid = stage(270);
  const mctx = mid.getContext('2d')!;
  mctx.imageSmoothingQuality = 'high';
  if (typeof (mctx as { filter?: unknown }).filter === 'string') mctx.filter = 'blur(5px) saturate(1.35)';
  mctx.drawImage(small, -8, -8, mid.width + 16, mid.height + 16);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mid, 0, 0, w, h);
  // Darker at the bottom, and darker still for bright covers, so white text stays easy to read.
  const dark = 0.26 + palette.brightness * 0.3;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(0,0,0,${(dark * 0.55).toFixed(3)})`);
  g.addColorStop(1, `rgba(0,0,0,${(dark + 0.28).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Soft blobs of the cover's colors on its dark base color. */
function paintGradientBackground(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette) {
  ctx.fillStyle = palette.base;
  ctx.fillRect(0, 0, w, h);
  const spots = [
    [0.12, 0.08],
    [0.95, 0.38],
    [0.1, 0.78],
    [0.9, 0.98],
    [0.5, 0.5],
  ];
  const reach = Math.max(w, h) * 0.85;
  palette.colors.slice(0, spots.length).forEach((color, k) => {
    const [fx, fy] = spots[k];
    const g = ctx.createRadialGradient(w * fx, h * fy, 0, w * fx, h * fy, reach);
    g.addColorStop(0, color);
    g.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(0, 0, w, h);
}

/**
 * Paints the card onto the canvas (sizing it first) and returns how the lyrics were laid out, so the caller can tell
 * when some of the lines didn't fit.
 */
export function drawCard(canvas: HTMLCanvasElement, o: CardOptions): LyricLayout {
  const spec = formatOf(o.format);
  canvas.width = spec.w;
  canvas.height = spec.h;
  const ctx = canvas.getContext('2d')!;
  const { w, h } = spec;

  if (o.look === 'cover' && o.cover) paintCoverBackground(ctx, o.cover, w, h, o.palette);
  else paintGradientBackground(ctx, w, h, o.palette);

  const x0 = spec.side;
  const x1 = w - spec.side;
  const y0 = spec.top;
  const y1 = h - spec.bottom;
  const font = (weight: number, size: number) => `${weight} ${size}px ${o.family}`;
  const measure: Measure = (text, size) => {
    ctx.font = font(800, size);
    return ctx.measureText(text).width;
  };
  const textWidth = (text: string, weight: number, size: number) => {
    ctx.font = font(weight, size);
    return ctx.measureText(text).width;
  };

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // Cover, song and artist at the top.
  let top = y0;
  if (o.showInfo) {
    const withCover = !!o.cover;
    const tx = withCover ? x0 + COVER + 40 : x0;
    if (o.cover) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 44;
      ctx.shadowOffsetY = 10;
      roundRect(ctx, x0, y0, COVER, COVER, 28);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();
      ctx.save();
      roundRect(ctx, x0, y0, COVER, COVER, 28);
      ctx.clip();
      ctx.drawImage(o.cover, x0, y0, COVER, COVER);
      ctx.restore();
    }
    const room = x1 - tx;
    const title = fitText(o.title, room, 48, (t, s) => textWidth(t, 800, s));
    const artist = fitText(o.artist, room, 38, (t, s) => textWidth(t, 600, s));
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(255,255,255,0.98)';
    ctx.font = font(800, 48);
    ctx.fillText(title, tx, y0 + (withCover ? COVER / 2 - 28 : 28));
    ctx.fillStyle = 'rgba(255,255,255,0.74)';
    ctx.font = font(600, 38);
    ctx.fillText(artist, tx, y0 + (withCover ? COVER / 2 + 28 : 84));
    ctx.restore();
    top = y0 + (withCover ? COVER : 112) + 72;
  }

  // The small "Lyrics Stage" mark at the bottom.
  let bottom = y1;
  if (o.mark) {
    ctx.save();
    ctx.font = font(700, 32);
    ctx.fillStyle = o.palette.accent;
    ctx.fillText('♪', x0, y1 - 18);
    const note = textWidth('♪', 700, 32);
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.fillText('Lyrics Stage', x0 + note + 14, y1 - 18);
    ctx.restore();
    bottom = y1 - 36 - 40;
  }

  // The lyrics, as big as they can be, in the middle of what is left.
  const areaH = Math.max(120, bottom - top);
  const layout = layoutLyrics(o.lines, x1 - x0, areaH, measure);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  ctx.font = font(800, layout.size);
  const rowH = layout.size * layout.leading;
  let y = top + Math.max(0, (areaH - layout.height) / 2);
  layout.rows.forEach((row, k) => {
    if (row.lineStart && k > 0) y += layout.size * layout.lineGap;
    ctx.direction = row.rtl ? 'rtl' : 'ltr';
    ctx.textAlign = row.rtl ? 'right' : 'left';
    ctx.fillText(row.text, row.rtl ? x1 : x0, y + rowH / 2);
    y += rowH;
  });
  ctx.restore();
  return layout;
}
