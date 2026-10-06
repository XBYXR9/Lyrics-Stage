// 3D depth: the line being sung is in front; the lines before and after it sink back into the distance.
import { Fragment, useRef, type CSSProperties } from 'react';
import { Dots, paintDots } from './Dots';
import { seekTarget, sungCount, useLyricTimeline, useStackOffsets, wordByWord, type StyleProps } from './shared';

/** How far back each line sits (px), its tilt (degrees) and its brightness, by distance from the line being sung. */
const DEPTH: Record<number, { z: number; tilt: number; opacity: number }> = {
  [-2]: { z: -420, tilt: 30, opacity: 0 },
  [-1]: { z: -200, tilt: 22, opacity: 0.22 },
  0: { z: 0, tilt: 0, opacity: 1 },
  1: { z: -200, tilt: -18, opacity: 0.5 },
  2: { z: -420, tilt: -28, opacity: 0.24 },
  3: { z: -640, tilt: -34, opacity: 0 },
};
/** What perspective makes of the distance, roughly: lines further back look smaller. */
const apparent = (slot: number) => 1 / (1 + (-(DEPTH[slot]?.z ?? -640)) / 1100);

export function DepthStyle(props: StyleProps) {
  const { lyrics, vibe, offsetMs, sweep, interactive, onSeek, reduceMotion } = props;
  const lines = lyrics.lines;
  const perWord = wordByWord(lyrics, sweep);
  const lineEls = useRef(new Map<number, HTMLElement>());
  const state = useRef({ line: -1, count: -1 });

  const active = useLyricTimeline(props, (t, idx) => {
    const line = lines[idx];
    const el = lineEls.current.get(idx);
    if (!line || !el) return;
    if (line.interlude) return paintDots(el.querySelector<HTMLElement>('.dots'), line, t);
    const count = perWord ? sungCount(line, t) : line.words.length;
    if (state.current.line === idx && state.current.count === count) return;
    state.current = { line: idx, count };
    el.querySelectorAll<HTMLElement>('.dp-w').forEach((w, j) => w.classList.toggle('on', j < count));
  });

  const visible: number[] = [];
  for (let i = Math.max(0, active - 2); i <= Math.min(lines.length - 1, active + 3); i++) visible.push(i);
  const offsets = useStackOffsets(active, visible, lineEls.current, apparent, 0.7);

  return (
    <div className={`dp${reduceMotion ? ' calm' : ''}`} style={{ '--dp-ms': `${reduceMotion ? 250 : Math.round(vibe.scrollMs * 1.1)}ms` } as CSSProperties}>
      {visible.map((i) => {
        const line = lines[i];
        const slot = i - active;
        const d = DEPTH[slot] ?? DEPTH[3];
        // Perspective pulls a line back toward the middle by the same amount it shrinks, so move it out by that much first.
        const y = (offsets.get(i) ?? 0) / apparent(slot);
        return (
          <div
            key={line.id}
            ref={(el) => {
              if (el) lineEls.current.set(i, el);
              else lineEls.current.delete(i);
            }}
            className={`dp-line slot-${slot < 0 ? 'prev' : slot}`}
            style={{
              opacity: d.opacity,
              transform: `translate(-50%, ${y.toFixed(1)}px) translateZ(${d.z}px) rotateX(${reduceMotion ? 0 : d.tilt}deg)`,
            }}
            dir={line.rtl ? 'rtl' : undefined}
            onClick={interactive && !line.interlude ? () => onSeek(seekTarget(line, offsetMs)) : undefined}
          >
            {line.interlude ? (
              <Dots className="dp-dots" />
            ) : (
              line.words.map((w, j) => (
                <Fragment key={j}>
                  <span className={`dp-w${slot !== 0 ? ' on' : ''}${w.backing ? ' is-bg' : ''}`}>{w.text.trimEnd()}</span>
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
