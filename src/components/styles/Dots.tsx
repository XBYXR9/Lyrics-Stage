import { createContext, useContext } from 'react';
import { readAudioLevels } from '../../lib/audioLevels';
import { BAR_COUNT, estimatedBars } from '../../lib/pulse';
import type { LyricLine } from '../../lib/types';
import { clamp01 } from './shared';

/** What to show during instrumental breaks, set once per song layer (see LyricsStage). */
export interface BreakVisual {
  /** "bars": a visualizer in the album's colors. "dots": the three "•••". */
  mode: 'bars' | 'dots';
  /** 0..1, how energetic the song feels: sets the speed of the estimated rhythm. */
  energy: number;
  /** Reduce motion: slower, smaller movement. */
  calm: boolean;
}

export const BreakVisualContext = createContext<BreakVisual>({ mode: 'dots', energy: 0.5, calm: false });

/** The break visual: moving bars with a progress line, or the three "•••" dots. */
export function Dots({ className = '' }: { className?: string }) {
  const v = useContext(BreakVisualContext);
  const bars = v.mode === 'bars';
  return (
    <span
      className={`dots${bars ? ' is-bars' : ''} ${className}`}
      data-mode={v.mode}
      data-energy={v.energy.toFixed(2)}
      data-calm={v.calm ? '1' : undefined}
      aria-label="Instrumental break"
    >
      {bars ? (
        <>
          <span className="viz">
            {Array.from({ length: BAR_COUNT }, (_, i) => (
              <u key={i} />
            ))}
          </span>
          <span className="viz-line">
            <span className="viz-fill" />
          </span>
        </>
      ) : (
        <>
          <i />
          <i />
          <i />
        </>
      )}
    </span>
  );
}

const barEls = new WeakMap<HTMLElement, HTMLElement[]>();
const levels = new Float32Array(BAR_COUNT);

/** Moves the bars for this frame: real sound when available (Windows, opt-in), otherwise the estimated rhythm. */
function paintBars(el: HTMLElement, t: number) {
  let bars = barEls.get(el);
  if (!bars) {
    bars = Array.from(el.querySelectorAll<HTMLElement>('.viz u'));
    barEls.set(el, bars);
  }
  const energy = Number(el.dataset.energy) || 0.5;
  if (el.dataset.calm === '1') {
    // Reduce motion: half the speed and about a third of the swing.
    estimatedBars(levels, t * 0.5, energy * 0.5);
    for (let i = 0; i < bars.length; i++) bars[i].style.transform = `scaleY(${(0.1 + levels[i] * 0.35).toFixed(3)})`;
    return;
  }
  if (!readAudioLevels(levels)) estimatedBars(levels, t, energy);
  for (let i = 0; i < bars.length; i++) bars[i].style.transform = `scaleY(${(0.06 + levels[i] * 0.94).toFixed(3)})`;
}

/**
 * Paints the break visual for this frame. The dots fill one by one through the
 * break, breathing, then shrink away. The bars move to the music and a thin
 * line fills across the break, so you can see when the singing comes back.
 */
export function paintDots(el: HTMLElement | null | undefined, line: LyricLine, t: number) {
  if (!el) return;
  const dur = Math.max(1, line.end - line.start);
  const p = clamp01((t - line.start) / dur);
  const appear = Math.min(clamp01((line.end - t) / 350), clamp01((t - line.start) / 300));
  if (el.dataset.mode === 'bars') {
    paintBars(el, t);
    el.style.setProperty('--bp', p.toFixed(3));
    el.style.setProperty('--ds', appear.toFixed(3));
    return;
  }
  for (let k = 0; k < 3; k++) el.style.setProperty(`--d${k}`, clamp01(p * 3 - k).toFixed(3));
  const breath = 1 + 0.07 * Math.sin(t / 380);
  el.style.setProperty('--ds', (breath * appear).toFixed(3));
}

export function resetDots(el: HTMLElement | null | undefined) {
  el?.style.setProperty('--ds', '0');
}
