// Things every lyric style shares.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFrame, useLatest } from '../../hooks/hooks';
import type { Clock } from '../../lib/clock';
import { findLineIndex } from '../../lib/lrc';
import type { WordSweep } from '../../lib/settings';
import type { LyricLine, Lyrics, Palette, Vibe } from '../../lib/types';

export interface StyleProps {
  lyrics: Lyrics;
  clock: Clock;
  vibe: Vibe;
  palette: Palette;
  offsetMs: number;
  sweep: WordSweep;
  reduceMotion: boolean;
  /** False while this layer is fading out (no clicking/scrolling). */
  interactive: boolean;
  onSeek: (positionMs: number) => void;
}

/** Should words light up one by one for these lyrics? */
export function wordByWord(lyrics: Lyrics, sweep: WordSweep): boolean {
  if (sweep === 'off') return false;
  if (sweep === 'real-only') return lyrics.wordSynced;
  return true;
}

/**
 * Runs the frame loop for a style: works out the current line (re-rendering
 * only when it changes) and hands every frame to `paint` for the fine-grained
 * word animation, which touches the DOM directly for smoothness.
 */
export function useLyricTimeline(
  props: Pick<StyleProps, 'lyrics' | 'clock' | 'offsetMs'>,
  paint?: (t: number, active: number, lines: LyricLine[]) => void,
): number {
  const [active, setActive] = useState(-1);
  const activeRef = useRef(-1);
  const p = useLatest(props);
  useFrame((now) => {
    const { lyrics, clock, offsetMs } = p.current;
    const t = clock.now(now) + offsetMs;
    const idx = findLineIndex(lyrics.lines, t);
    if (idx !== activeRef.current) {
      activeRef.current = idx;
      setActive(idx);
    }
    paint?.(t, idx, lyrics.lines);
  });
  return active;
}

/** Number of words in a line whose start time has passed. */
export function sungCount(line: LyricLine, t: number): number {
  let n = 0;
  for (const w of line.words) if (w.start <= t) n++;
  return n;
}

/** Seek target so that line `line` is shown right when it starts. */
export const seekTarget = (line: LyricLine, offsetMs: number) => Math.max(0, line.start - offsetMs - 30);

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Small, stable pseudo-random number in [-1, 1] for a given seed. */
export function jitter(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Stacks a few lines (previous / current / next…) vertically around the
 * middle of the screen, measuring each line so wrapped lines never overlap.
 * Returns each visible line's vertical offset in px (from the anchor point).
 * `scaleOf(slot)` is the visual scale used for that slot (slot 0 = current).
 */
export function useStackOffsets(
  active: number,
  visible: number[],
  els: Map<number, HTMLElement>,
  scaleOf: (slot: number) => number,
  gapEm = 0.35,
): Map<number, number> {
  const [heights, setHeights] = useState<Record<number, number>>({});
  const [fontPx, setFontPx] = useState(48);
  const [, setResizeTick] = useState(0);

  // Runs after every render (renders only happen when the line changes or
  // settings like text size change); only stores new values when they differ.
  useLayoutEffect(() => {
    const next: Record<number, number> = {};
    let changed = false;
    for (const i of visible) {
      const el = els.get(i);
      if (!el) continue;
      next[i] = el.offsetHeight;
      if (heights[i] !== next[i]) changed = true;
    }
    if (changed) setHeights((h) => ({ ...h, ...next }));
    const first = els.get(visible[0]);
    if (first) {
      const px = parseFloat(getComputedStyle(first).fontSize);
      if (px && px !== fontPx) setFontPx(px);
    }
  });

  useEffect(() => {
    const onResize = () => setResizeTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const gap = fontPx * gapEm;
  const h = (i: number) => heights[i] ?? fontPx * 1.3;
  const offsets = new Map<number, number>();
  const hasCurrent = visible.includes(active);
  if (hasCurrent) offsets.set(active, -h(active) / 2);
  let down = hasCurrent ? h(active) / 2 + gap : 0;
  for (const i of visible.filter((v) => v > active)) {
    offsets.set(i, down);
    down += h(i) * scaleOf(i - active) + gap;
  }
  let up = hasCurrent ? -h(active) / 2 - gap : 0;
  for (const i of visible.filter((v) => v < active).reverse()) {
    up -= h(i) * scaleOf(i - active);
    offsets.set(i, up);
    up -= gap;
  }
  return offsets;
}
