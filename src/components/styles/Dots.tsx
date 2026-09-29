import type { LyricLine } from '../../lib/types';
import { clamp01 } from './shared';

/** The three "•••" dots shown during instrumental breaks. */
export function Dots({ className = '' }: { className?: string }) {
  return (
    <span className={`dots ${className}`} aria-label="Instrumental break">
      <i />
      <i />
      <i />
    </span>
  );
}

/** Fills the dots one by one through the break, breathing, then shrinks them away. */
export function paintDots(el: HTMLElement | null | undefined, line: LyricLine, t: number) {
  if (!el) return;
  const dur = Math.max(1, line.end - line.start);
  const p = clamp01((t - line.start) / dur);
  for (let k = 0; k < 3; k++) el.style.setProperty(`--d${k}`, clamp01(p * 3 - k).toFixed(3));
  const breath = 1 + 0.07 * Math.sin(t / 380);
  const appear = Math.min(clamp01((line.end - t) / 350), clamp01((t - line.start) / 300));
  el.style.setProperty('--ds', (breath * appear).toFixed(3));
}

export function resetDots(el: HTMLElement | null | undefined) {
  el?.style.setProperty('--ds', '0');
}
