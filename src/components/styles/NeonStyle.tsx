// Neon: glowing tube-light words that flicker on as they're sung. The dark
// retro grid behind them is drawn by the Stage (see StyleDecor) so it can
// cover the whole screen and move with the song's energy.
import { Fragment, useRef } from 'react';
import { Dots, paintDots } from './Dots';
import { seekTarget, sungCount, useLyricTimeline, useStackOffsets, wordByWord, type StyleProps } from './shared';

const SCALE: Record<number, number> = { [-1]: 0.62, 0: 1, 1: 0.62 };

export function NeonStyle(props: StyleProps) {
  const { lyrics, offsetMs, sweep, interactive, onSeek, reduceMotion } = props;
  const lines = lyrics.lines;
  const perWord = wordByWord(lyrics, sweep);
  const lineEls = useRef(new Map<number, HTMLElement>());
  const lit = useRef({ line: -1, count: -1 });

  const active = useLyricTimeline(props, (t, idx) => {
    const line = lines[idx];
    if (!line) return;
    const el = lineEls.current.get(idx);
    if (!el) return;
    if (line.interlude) return paintDots(el.querySelector<HTMLElement>('.dots'), line, t);
    const count = perWord ? sungCount(line, t) : line.words.length;
    if (lit.current.line === idx && lit.current.count === count) return;
    lit.current = { line: idx, count };
    el.querySelectorAll<HTMLElement>('.ne-w').forEach((w, j) => w.classList.toggle('on', j < count));
  });

  const visible: number[] = [];
  for (let i = Math.max(0, active - 1); i <= Math.min(lines.length - 1, active + 1); i++) visible.push(i);
  const offsets = useStackOffsets(active, visible, lineEls.current, (slot) => SCALE[slot] ?? 0.62, 0.5);

  return (
    <div className={`ne${reduceMotion ? ' calm' : ''}`}>
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
            className={`ne-line slot-${slot < 0 ? 'prev' : slot}`}
            style={{ transform: `translate(-50%, ${(offsets.get(i) ?? 0).toFixed(1)}px) scale(${SCALE[slot] ?? 0.62})` }}
            dir={line.rtl ? 'rtl' : undefined}
            onClick={interactive && !line.interlude ? () => onSeek(seekTarget(line, offsetMs)) : undefined}
          >
            {line.interlude ? (
              <Dots className="ne-dots" />
            ) : (
              line.words.map((w, j) => (
                <Fragment key={j}>
                  <span className={`ne-w${slot < 0 ? ' on' : ''}${w.backing ? ' is-bg' : ''}`}>{w.text.trimEnd()}</span>
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
