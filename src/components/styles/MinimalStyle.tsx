// Minimal: one small, calm line near the bottom, like film subtitles.
import { Fragment, useRef } from 'react';
import { Dots, paintDots } from './Dots';
import { seekTarget, sungCount, useLyricTimeline, wordByWord, type StyleProps } from './shared';

export function MinimalStyle(props: StyleProps) {
  const { lyrics, offsetMs, sweep, interactive, onSeek, reduceMotion } = props;
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
    el.querySelectorAll<HTMLElement>('.mn-w').forEach((w, j) => w.classList.toggle('on', j < count));
  });

  const line = lines[active];
  const after = lines[active + 1];
  if (!line) return null;
  return (
    <div className={`mn${reduceMotion ? ' calm' : ''}`}>
      <div
        key={line.id}
        ref={(el) => {
          lineEl.current = el;
          state.current = -2;
        }}
        className="mn-line"
        dir={line.rtl ? 'rtl' : undefined}
        onClick={interactive && !line.interlude ? () => onSeek(seekTarget(line, offsetMs)) : undefined}
      >
        {line.interlude ? (
          <Dots className="mn-dots" />
        ) : (
          line.words.map((w, j) => (
            <Fragment key={j}>
              <span className={`mn-w${w.backing ? ' is-bg' : ''}`}>{w.text.trimEnd()}</span>
              {w.text !== w.text.trimEnd() ? ' ' : null}
            </Fragment>
          ))
        )}
      </div>
      {after && !after.interlude && (
        <div className="mn-next" key={`n${after.id}`} dir={after.rtl ? 'rtl' : undefined}>
          {after.text}
        </div>
      )}
    </div>
  );
}
