// Color themes: ready-made colors (or one the user picks) to use instead of the colors of each album cover.
import type { Palette } from './types';

export interface ColorTheme {
  id: string;
  name: string;
  /** The highlight color. */
  accent: string;
}

/** "album" (the default) keeps the colors of each cover; "custom" uses the picked color. */
export const COLOR_THEMES: ColorTheme[] = [
  { id: 'album', name: 'Album colors', accent: '#ffffff' },
  { id: 'rose', name: 'Rose', accent: '#ff5a8a' },
  { id: 'sunset', name: 'Sunset', accent: '#ff8a3d' },
  { id: 'gold', name: 'Gold', accent: '#ffc83d' },
  { id: 'mint', name: 'Mint', accent: '#3ddc97' },
  { id: 'ocean', name: 'Ocean', accent: '#3da5ff' },
  { id: 'violet', name: 'Violet', accent: '#9b6bff' },
  { id: 'custom', name: 'Pick my own', accent: '#ff5a8a' },
];

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX.test(v);
}

interface HSL {
  h: number;
  s: number;
  l: number;
}

export function hexToHsl(hex: string): HSL {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

const hsl = (h: number, s: number, l: number) =>
  `hsl(${Math.round((h + 360) % 360)} ${Math.round(Math.min(1, Math.max(0, s)) * 100)}% ${Math.round(Math.min(1, Math.max(0, l)) * 100)}%)`;

/** The theme's highlight color, or null to keep the album's colors. */
export function themeAccent(themeId: string, customColor: string): string | null {
  if (themeId === 'album') return null;
  if (themeId === 'custom') return isHexColor(customColor) ? customColor : null;
  return COLOR_THEMES.find((t) => t.id === themeId)?.accent ?? null;
}

/**
 * The palette with the theme's colors on it. The highlight is the theme color (made bright enough to read), the
 * second highlight is a neighbour on the color wheel, and the background colors and dark base are built from the same hue.
 */
export function applyColorTheme(palette: Palette, themeId: string, customColor: string): Palette {
  const accent = themeAccent(themeId, customColor);
  if (!accent) return palette;
  const { h, s } = hexToHsl(accent);
  const sat = Math.max(0.55, s);
  return {
    ...palette,
    base: hsl(h, sat * 0.5, 0.07),
    accent: hsl(h, sat, 0.62),
    accent2: hsl(h + 40, sat, 0.66),
    colors: [hsl(h, sat, 0.45), hsl(h + 30, sat, 0.4), hsl(h - 30, sat, 0.4), hsl(h + 60, sat * 0.8, 0.35), hsl(h - 60, sat * 0.8, 0.3)],
    saturation: Math.max(palette.saturation, 0.6),
  };
}
