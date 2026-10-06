// The user's own background picture ("Background: My picture"). It is shrunk and kept in this browser only.
import { useSyncExternalStore } from 'react';

const KEY = 'ls.wallpaper.v1';
/** The longest side of the saved picture, in pixels. */
const MAX_SIDE = 1600;

let current: string | null = (() => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
})();
const listeners = new Set<() => void>();

export const getWallpaper = () => current;

function set(value: string | null) {
  current = value;
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* too big to keep: it stays for this visit only */
  }
  listeners.forEach((l) => l());
}

export function clearWallpaper() {
  set(null);
}

/** The size a picture is shrunk to (never enlarged). Exported for tests. */
export function fitSize(width: number, height: number, max = MAX_SIDE): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

/** Shrinks the chosen picture and keeps it as the background. Rejects with a plain-language message. */
export async function setWallpaperFromFile(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) throw new Error('Pick a picture file (JPG, PNG, WebP…).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That picture couldn’t be opened.'));
      el.src = url;
    });
    const { w, h } = fitSize(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    set(canvas.toDataURL('image/jpeg', 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useWallpaper(): string | null {
  return useSyncExternalStore(subscribe, getWallpaper);
}
