// Stretch: centered lines where each word swells and glows for as long as it is held, then settles back.
// Short words barely move; a long held note grows wide, with a bar underneath that fills as the note runs.
// It makes the most of real word timings, but the improved estimates look good too.
import { Fragment, useRef, type CSSProperties } from 'react';
import { wordProgress } from '../../lib/lrc';
import { Dots, paintDots } from './Dots';
import { clamp01, seekTarget, useLyricTimeline, useStackOffsets, wordByWord, type StyleProps } from './shared';

const SCALE: Record<number, number> = { [-1]: 0.7, 0: 1, 1: 0.72, 2: 0.6 };
/** Words shorter than this stay almost still; the full stretch needs a note held about this much longer. */
const HOLD_FROM_MS = 450;
const HOLD_RANGE_MS = 1600;
/** How long a word takes to settle back after it ends. */
const SETTLE_MS = 380;

/** 0 while a word has not started, rising as it is sung, falling back to 0 after it ends. */
export function swell(start: number, end: number, t: number): number {
  if (t <= start) return 0;
  if (t < end) return Math.pow(clamp01((t - start) / Math.max(1, end - start)), 0.65);
  return clamp01(1 - (t - end) / SETTLE_MS) ** 2;
}

/** 0..1: how much a word is "held" (1 = a long note). */
export const holdOf = (durationMs: number) => clamp01((durationMs - HOLD_FROM_MS) / HOLD_RANGE_MS);

export function StretchStyle(props: StyleProps) {
  const { lyrics, offsetMs, sweep, interactive, onSeek, reduceMotion } = props;
  const lines = lyrics.lines;
  const perWord = wordByWord(lyrics, sweep);
  const lineEls = useRef(new Map<number, HTMLElement>());
  const wordEls = useRef(new Map<number, (HTMLElement | null)[]>());

  const active = useLyricTimeline(props, (t, idx) => {
    const line = lines[idx];
    if (!line) return;
    if (line.interlude) return paintDots(lineEls.current.get(idx)?.querySelector<HTMLElement>('.dots'), line, t);
    // The line that has just ended is still settling while the next one starts.
    for (const i of [idx - 1, idx]) {
      const l = lines[i];
      const els = wordEls.current.get(i);
      if (!l || !els || l.interlude) continue;
      l.words.forEach((w, j) => {
        const el = els[j];
        if (!el) return;
        const p = perWord ? wordProgress(w, t) : t >= l.start ? 1 : 0;
        el.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
        const s = perWord && !reduceMotion ? swell(w.start, w.end, t) : 0;
        el.style.setProperty('--s', s.toFixed(3));
      });
    }
  });

  const visible: number[] = [];
  for (let i = Math.max(0, active - 1); i <= Math.min(lines.length - 1, active + 2); i++) visible.push(i);
  const offsets = useStackOffsets(active, visible, lineEls.current, (slot) => SCALE[slot] ?? 0.6, 0.3);

  return (
    <div className="st">
      {visible.map((i) => {
        const line = lines[i];
        const slot = i - active;
        return (
          <div
            key={line.id}
            ref={(el) => {
              if (el) lineEls.current.set(i, el);
              else lineEls.current.delete(i);
            }}
            className={`st-line slot-${slot < 0 ? 'prev' : slot}`}
            style={{ transform: `translate(-50%, ${(offsets.get(i) ?? 0).toFixed(1)}px) scale(${SCALE[slot] ?? 0.6})` }}
            dir={line.rtl ? 'rtl' : undefined}
            onClick={interactive && !line.interlude ? () => onSeek(seekTarget(line, offsetMs)) : undefined}
          >
            {line.interlude ? (
              <Dots className="st-dots" />
            ) : (
              line.words.map((w, j) => (
                <Fragment key={j}>
                  <span
                    className={`st-w${w.backing ? ' is-bg' : ''}`}
                    style={{ '--p': slot < 0 ? '100%' : '0%', '--s': 0, '--h': holdOf(w.end - w.start).toFixed(3) } as CSSProperties}
                    ref={(el) => {
                      if (!wordEls.current.has(i)) wordEls.current.set(i, []);
                      wordEls.current.get(i)![j] = el;
                    }}
                  >
                    {w.text.trimEnd()}
                  </span>
                  {w.text !== w.text.trimEnd() ? ' ' : null}
                </Fragment>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}
