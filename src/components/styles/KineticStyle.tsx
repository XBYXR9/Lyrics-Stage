// Kinetic: poster-style typography. Each word pops onto the screen the moment
// it's sung, tilted and sized for punch — great for rap and fast pop. The whole
// block kicks on every word, harder for high-energy songs.
import { Fragment, useRef, type CSSProperties } from 'react';
import { Dots, paintDots } from './Dots';
import { jitter, seekTarget, sungCount, useLyricTimeline, wordByWord, type StyleProps } from './shared';

export function KineticStyle(props: StyleProps) {
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
    const prev = state.current;
    if (prev.line === idx && prev.count === count) return;
    const grew = prev.line === idx && count > prev.count;
    state.current = { line: idx, count };
    el.querySelectorAll<HTMLElement>('.kn-w').forEach((w, j) => w.classList.toggle('on', j < count));
    if (grew && !reduceMotion) {
      const kick = 1 + 0.015 + vibe.energy * 0.03;
      el.querySelector<HTMLElement>('.kn-inner')?.animate(
        [{ transform: `scale(${kick})` }, { transform: 'scale(1)' }],
        { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
  });

  const visible = [active - 1, active].filter((i) => i >= 0 && i < lines.length);
  if (active < 0 && lines.length) visible.push(0);
  const tilt = 1.5 + vibe.energy * 5;

  return (
    <div className={`kn${reduceMotion ? ' calm' : ''}`}>
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
            className={`kn-line slot-${slot < 0 ? 'prev' : slot}`}
            dir={line.rtl ? 'rtl' : undefined}
            onClick={interactive && !line.interlude ? () => onSeek(seekTarget(line, offsetMs)) : undefined}
          >
            <div className="kn-inner">
              {line.interlude ? (
                <Dots className="kn-dots" />
              ) : (
                line.words.map((w, j) => {
                  const long = w.end - w.start >= 650 || j === line.words.length - 1;
                  const seed = line.id * 31 + j;
                  const style = {
                    '--r': `${(jitter(seed) * tilt).toFixed(2)}deg`,
                    '--s': (long ? 1.22 : 1 + jitter(seed + 7) * 0.12).toFixed(3),
                  } as CSSProperties;
                  return (
                    <Fragment key={j}>
                      <span className={`kn-w${long ? ' em' : ''}${slot < 0 ? ' on' : ''}${w.backing ? ' is-bg' : ''}`} style={style}>
                        {w.text.trimEnd()}
                      </span>
                      {w.text !== w.text.trimEnd() ? ' ' : null}
                    </Fragment>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
