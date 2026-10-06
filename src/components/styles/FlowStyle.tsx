// Gradient flow: big words filled with the album's colors, slowly moving, one line in focus with its neighbours.
import { Fragment, useRef } from 'react';
import { Dots, paintDots } from './Dots';
import { seekTarget, sungCount, useLyricTimeline, wordByWord, type StyleProps } from './shared';

export function FlowStyle(props: StyleProps) {
  const { lyrics, vibe, offsetMs, sweep, interactive, onSeek, reduceMotion } = props;
  const lines = lyrics.lines;
  const perWord = wordByWord(lyrics, sweep);
  const lineEl = useRef<HTMLDivElement>(null);
  const state = useRef(-2);

  const active = useLyricTimeline(props, (t, idx) => {
    const line = lines[idx];
    const el = lineEl.current;
    if (!line || !el) return;
    if (line.interlude) return paintDots(el.querySelector<HTMLElement>('.dots'), line, t);
    const count = perWord ? sungCount(line, t) : line.words.length;
    if (state.current === count) return;
    state.current = count;
    el.querySelectorAll<HTMLElement>('.fl-w').forEach((w, j) => w.classList.toggle('on', j < count));
  });

  const slots = [-1, 0, 1].map((d) => ({ d, line: lines[active + d] })).filter((s) => s.line);
  return (
    <div className={`fl${reduceMotion ? ' calm' : ''}`} style={{ '--fl-speed': `${Math.round(14 / Math.max(0.4, vibe.motion))}s` } as React.CSSProperties}>
      {slots.map(({ d, line }) => (
        <div
          key={line.id}
          ref={
            d === 0
              ? (el) => {
                  lineEl.current = el;
                  state.current = -2;
                }
              : undefined
          }
          className={`fl-line slot-${d < 0 ? 'prev' : d}`}
          dir={line.rtl ? 'rtl' : undefined}
          onClick={interactive && !line.interlude ? () => onSeek(seekTarget(line, offsetMs)) : undefined}
        >
          {line.interlude ? (
            <Dots className="fl-dots" />
          ) : (
            line.words.map((w, j) => (
              <Fragment key={j}>
                <span className={`fl-w${d < 0 ? ' on' : ''}${w.backing ? ' is-bg' : ''}`}>{w.text.trimEnd()}</span>
                {w.text !== w.text.trimEnd() ? ' ' : null}
              </Fragment>
            ))
          )}
        </div>
      ))}
    </div>
  );
}
