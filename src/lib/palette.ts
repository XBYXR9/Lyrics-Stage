// Pulls a color palette out of the album cover so the whole screen takes on
// the song's colors (like Apple Music's full-screen player).

import type { Palette } from './types';

type RGB = [number, number, number];
interface HSL {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

export const FALLBACK_PALETTE: Palette = {
  base: 'hsl(250 30% 12%)',
  accent: 'hsl(330 90% 68%)',
  accent2: 'hsl(265 85% 72%)',
  colors: ['hsl(330 70% 45%)', 'hsl(265 60% 40%)', 'hsl(210 70% 40%)', 'hsl(290 50% 30%)'],
  saturation: 0.6,
  brightness: 0.4,
};

function rgbToHsl([r, g, b]: RGB): HSL {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

const css = ({ h, s, l }: HSL) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** Simple k-means over the cover's pixels. Returns clusters, biggest first. */
function kmeans(pixels: RGB[], k: number): { color: RGB; share: number }[] {
  if (!pixels.length) return [];
  // Start from brightness quantiles so results are stable (no randomness).
  const byLum = [...pixels].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let centers: RGB[] = Array.from({ length: k }, (_, i) => [...byLum[Math.floor(((i + 0.5) / k) * byLum.length)]] as RGB);
  let assign = new Array<number>(pixels.length).fill(0);
  for (let iter = 0; iter < 8; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    assign = pixels.map((p) => {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, i) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      const s = sums[best];
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3]++;
      return best;
    });
    centers = centers.map((c, i) => {
      const s = sums[i];
      return s[3] ? ([s[0] / s[3], s[1] / s[3], s[2] / s[3]] as RGB) : c;
    });
  }
  const counts = centers.map(() => 0);
  assign.forEach((a) => counts[a]++);
  return centers
    .map((color, i) => ({ color, share: counts[i] / pixels.length }))
    .filter((c) => c.share > 0)
    .sort((a, b) => b.share - a.share);
}

export function paletteFromPixels(data: Uint8ClampedArray): Palette {
  const pixels: RGB[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  const clusters = kmeans(pixels, 8).map((c) => ({ ...c, hsl: rgbToHsl(c.color) }));
  if (!clusters.length) return FALLBACK_PALETTE;

  const saturation = clusters.reduce((a, c) => a + c.hsl.s * c.share * (1 - Math.abs(c.hsl.l - 0.5)), 0);
  const brightness = clusters.reduce((a, c) => a + c.hsl.l * c.share, 0);

  // Accent: the most colorful cluster that isn't too dark/light or a tiny speck.
  const vividness = (c: (typeof clusters)[number]) =>
    c.hsl.s ** 1.5 * Math.max(0.05, 1 - Math.abs(c.hsl.l - 0.55) * 1.4) * c.share ** 0.3;
  const vivid = [...clusters].sort((a, b) => vividness(b) - vividness(a));
  const grayscale = vivid[0].hsl.s < 0.12;
  const a1 = vivid[0].hsl;
  const a2src = vivid.find((c) => hueGap(c.hsl.h, a1.h) > 35 && c.hsl.s > 0.2)?.hsl;
  const accent: HSL = grayscale
    ? { h: a1.h, s: 0.05, l: 0.92 }
    : { h: a1.h, s: clamp(a1.s * 1.15, 0.6, 1), l: clamp(a1.l, 0.66, 0.78) };
  const accent2: HSL = grayscale
    ? { h: a1.h, s: 0.05, l: 0.75 }
    : a2src
      ? { h: a2src.h, s: clamp(a2src.s * 1.1, 0.5, 1), l: clamp(a2src.l, 0.62, 0.76) }
      : { h: (a1.h + 40) % 360, s: accent.s, l: accent.l };

  const dom = clusters[0].hsl;
  const base: HSL = { h: dom.h, s: clamp(dom.s, 0, 0.55), l: clamp(dom.l * 0.45, 0.07, 0.17) };

  const colors = clusters.slice(0, 5).map(({ hsl }) => css({ h: hsl.h, s: clamp(hsl.s * 1.25, 0, 0.95), l: clamp(hsl.l, 0.22, 0.58) }));
  while (colors.length < 4) colors.push(css({ h: (a1.h + colors.length * 50) % 360, s: 0.5, l: 0.35 }));

  return {
    base: css(base),
    accent: css(accent),
    accent2: css(accent2),
    colors,
    saturation: clamp(saturation * 1.6, 0, 1),
    brightness: clamp(brightness, 0, 1),
  };
}

const cache = new Map<string, Promise<Palette>>();

export function getPalette(url: string | null | undefined): Promise<Palette> {
  if (!url) return Promise.resolve(FALLBACK_PALETTE);
  let p = cache.get(url);
  if (!p) {
    p = loadImage(url)
      .then((img) => {
        const size = 40;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, size, size);
        return paletteFromPixels(ctx.getImageData(0, 0, size, size).data);
      })
      .catch(() => FALLBACK_PALETTE);
    cache.set(url, p);
  }
  return p;
}

const images = new Map<string, Promise<HTMLImageElement>>();

/** Loads a cover image with CORS enabled so we can read its pixels. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => {
        images.delete(url);
        reject(new Error('image failed'));
      };
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}
