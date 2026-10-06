// Retro / VHS: old tape look, with scan lines, colored edges on the letters and a running time code in the corner.
import { Fragment, useRef } from 'react';
import { formatTime } from '../../hooks/hooks';
import { Dots, paintDots } from './Dots';
import { seekTarget, sungCount, useLyricTimeline, wordByWord, type StyleProps } from './shared';

export function RetroStyle(props: StyleProps) {
  const { lyrics, offsetMs, sweep, interactive, onSeek, reduceMotion } = props;
  const lines = lyrics.lines;
  const perWord = wordByWord(lyrics, sweep);
  const lineEl = useRef<HTMLDivElement>(null);
  const codeEl = useRef<HTMLSpanElement>(null);
  const state = useRef({ count: -2, sec: -1 });

  const active = useLyricTimeline(props, (t, idx) => {
    const sec = Math.floor(Math.max(0, t) / 1000);
    if (codeEl.current && state.current.sec !== sec) {
      state.current.sec = sec;
      codeEl.current.textContent = formatTime(sec * 1000);
    }
    const line = lines[idx];
    const el = lineEl.current;
    if (!line || !el) return;
    if (line.interlude) return paintDots(el.querySelector<HTMLElement>('.dots'), line, t);
    const count = perWord ? sungCount(line, t) : line.words.length;
    if (state.current.count === count) return;
    state.current.count = count;
    el.querySelectorAll<HTMLElement>('.rt-w').forEach((w, j) => w.classList.toggle('on', j < count));
  });

  const line = lines[active];
  return (
    <div className={`rt${reduceMotion ? ' calm' : ''}`}>
      <div className="rt-hud" aria-hidden>
        <span className="rt-play">▶ PLAY</span>
        <span className="rt-code" ref={codeEl}>
          0:00
        </span>
        <span className="rt-rec">● REC</span>
      </div>
      {line && (
        <div
          key={line.id}
          ref={(el) => {
            lineEl.current = el;
            state.current.count = -2;
          }}
          className="rt-line"
          dir={line.rtl ? 'rtl' : undefined}
          onClick={interactive && !line.interlude ? () => onSeek(seekTarget(line, offsetMs)) : undefined}
        >
          {line.interlude ? (
            <Dots className="rt-dots" />
          ) : (
            line.words.map((w, j) => (
              <Fragment key={j}>
                <span className={`rt-w${w.backing ? ' is-bg' : ''}`}>{w.text.trimEnd()}</span>
                {w.text !== w.text.trimEnd() ? ' ' : null}
              </Fragment>
            ))
          )}
        </div>
      )}
    </div>
  );
}
