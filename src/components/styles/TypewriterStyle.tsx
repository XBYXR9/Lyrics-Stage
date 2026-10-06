// Typewriter: the line types itself out letter by letter, with a blinking cursor, in a typewriter font.
import { Fragment, useRef } from 'react';
import { Dots, paintDots } from './Dots';
import { seekTarget, useLyricTimeline, wordByWord, type StyleProps } from './shared';
import type { LyricLine } from '../../lib/types';

/** How many letters of the line have been typed at time `t`: each word types out between its start and its end. */
export function typedCount(line: LyricLine, t: number): number {
  let n = 0;
  for (const w of line.words) {
    const len = Array.from(w.text.trimEnd()).length;
    if (t >= w.end) n += len;
    else if (t > w.start) n += Math.floor((len * (t - w.start)) / Math.max(1, w.end - w.start));
  }
  return n;
}

export function TypewriterStyle(props: StyleProps) {
  const { lyrics, offsetMs, sweep, interactive, onSeek, reduceMotion } = props;
  const lines = lyrics.lines;
  const perWord = wordByWord(lyrics, sweep);
  const lineEl = useRef<HTMLDivElement>(null);
  const shown = useRef(-2);

  const active = useLyricTimeline(props, (t, idx) => {
    const line = lines[idx];
    const el = lineEl.current;
    if (!line || !el) return;
    if (line.interlude) return paintDots(el.querySelector<HTMLElement>('.dots'), line, t);
    const chars = el.querySelectorAll<HTMLElement>('.tw-c');
    const count = perWord ? typedCount(line, t) : chars.length;
    if (shown.current === count) return;
    shown.current = count;
    chars.forEach((c, k) => {
      c.classList.toggle('on', k < count);
      c.classList.toggle('next', k === count);
      c.classList.toggle('end', k === chars.length - 1 && count >= chars.length);
    });
  });

  const line = lines[active];
  const before = lines[active - 1];
  const after = lines[active + 1];
  if (!line) return null;
  return (
    <div className={`tw${reduceMotion ? ' calm' : ''}`}>
      {before && !before.interlude && (
        <div className="tw-side tw-before" key={`b${before.id}`} dir={before.rtl ? 'rtl' : undefined}>
          {before.text}
        </div>
      )}
      <div
        key={line.id}
        ref={(el) => {
          lineEl.current = el;
          shown.current = -2;
        }}
        className="tw-line"
        dir={line.rtl ? 'rtl' : undefined}
        onClick={interactive && !line.interlude ? () => onSeek(seekTarget(line, offsetMs)) : undefined}
      >
        {line.interlude ? (
          <Dots className="tw-dots" />
        ) : (
          line.words.map((w, j) => (
            <Fragment key={j}>
              <span className={`tw-word${w.backing ? ' is-bg' : ''}`}>
                {Array.from(w.text.trimEnd()).map((ch, k) => (
                  <span key={k} className="tw-c">
                    {ch}
                  </span>
                ))}
              </span>
              {w.text !== w.text.trimEnd() ? ' ' : null}
            </Fragment>
          ))
        )}
      </div>
      {after && !after.interlude && (
        <div className="tw-side tw-after" key={`a${after.id}`} dir={after.rtl ? 'rtl' : undefined}>
          {after.text}
        </div>
      )}
    </div>
  );
}
