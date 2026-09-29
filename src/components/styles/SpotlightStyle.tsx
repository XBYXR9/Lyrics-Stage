// Spotlight: one line at a time in big elegant type. Words come into focus as
// they're sung; the line then melts away as the next one rises up.
import { Fragment, useRef, type CSSProperties } from 'react';
import { Dots, paintDots } from './Dots';
import { seekTarget, sungCount, useLyricTimeline, useStackOffsets, wordByWord, type StyleProps } from './shared';

const SCALE: Record<number, number> = { [-1]: 1.08, 0: 1, 1: 0.42 };

export function SpotlightStyle(props: StyleProps) {
  const { lyrics, vibe, offsetMs, sweep, interactive, onSeek, reduceMotion } = props;
  const lines = lyrics.lines;
  const perWord = wordByWord(lyrics, sweep);
  const lineEls = useRef(new Map<number, HTMLElement>());
  const state = useRef({ line: -1, count: -1 });

  const active = useLyricTimeline(props, (t, idx) => {
    const line = lines[idx];
    if (!line) return;
    const el = lineEls.current.get(idx);
    if (!el) return;
    if (line.interlude) return paintDots(el.querySelector<HTMLElement>('.dots'), line, t);
    const count = perWord ? sungCount(line, t) : line.words.length;
    if (state.current.line === idx && state.current.count === count) return;
    state.current = { line: idx, count };
    el.querySelectorAll<HTMLElement>('.sp-w').forEach((w, j) => {
      w.classList.toggle('on', j < count);
      w.classList.toggle('now', perWord && j === count - 1);
    });
  });

  const visible: number[] = [];
  for (let i = Math.max(0, active - 1); i <= Math.min(lines.length - 1, active + 1); i++) visible.push(i);
  const offsets = useStackOffsets(active, visible, lineEls.current, (slot) => SCALE[slot] ?? 0.42, 0.6);
  // The upcoming line sits low on the screen; the finished one floats away upward.
  const extra = (slot: number) => (slot > 0 ? window.innerHeight * 0.14 : slot < 0 ? -window.innerHeight * 0.08 : 0);

  return (
    <div
      className={`sp${reduceMotion ? ' calm' : ''}`}
      style={{ '--sp-ms': `${reduceMotion ? 250 : Math.round(vibe.scrollMs * 1.3)}ms` } as CSSProperties}
    >
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
            className={`sp-line slot-${slot < 0 ? 'prev' : slot}`}
            style={{
              transform: `translate(-50%, ${((offsets.get(i) ?? 0) + extra(slot)).toFixed(1)}px) scale(${SCALE[slot] ?? 0.42})`,
            }}
            dir={line.rtl ? 'rtl' : undefined}
            onClick={interactive && !line.interlude ? () => onSeek(seekTarget(line, offsetMs)) : undefined}
          >
            {line.interlude ? (
              <Dots className="sp-dots" />
            ) : (
              line.words.map((w, j) => (
                <Fragment key={j}>
                  <span className={`sp-w${slot < 0 ? ' on' : ''}${w.backing ? ' is-bg' : ''}`}>{w.text.trimEnd()}</span>
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
