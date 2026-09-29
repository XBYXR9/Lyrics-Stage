// Karaoke: centered lines that fill with the song's color as they're sung,
// words bounce on the beat, and a little ball hops from word to word.
import { Fragment, useEffect, useRef, type CSSProperties } from 'react';
import { wordProgress } from '../../lib/lrc';
import { Dots, paintDots } from './Dots';
import { clamp01, seekTarget, useLyricTimeline, useStackOffsets, wordByWord, type StyleProps } from './shared';

const SCALE: Record<number, number> = { [-1]: 0.7, 0: 1, 1: 0.72, 2: 0.6 };

interface BallGeometry {
  line: number;
  centers: number[];
  tops: number[];
  hop: number;
}

export function KaraokeStyle(props: StyleProps) {
  const { lyrics, offsetMs, sweep, interactive, onSeek, reduceMotion } = props;
  const lines = lyrics.lines;
  const perWord = wordByWord(lyrics, sweep);
  const lineEls = useRef(new Map<number, HTMLElement>());
  const wordEls = useRef(new Map<number, (HTMLElement | null)[]>());
  const ballRef = useRef<HTMLSpanElement | null>(null);
  const geo = useRef<BallGeometry | null>(null);

  const active = useLyricTimeline(props, (t, idx) => {
    const line = lines[idx];
    if (!line) return;
    if (line.interlude) return paintDots(lineEls.current.get(idx)?.querySelector<HTMLElement>('.dots'), line, t);
    const els = wordEls.current.get(idx);
    if (!els) return;

    // Measure word positions once per line (before any style writes).
    if (geo.current?.line !== idx) {
      const lineEl = lineEls.current.get(idx);
      geo.current = {
        line: idx,
        centers: els.map((el) => (el ? el.offsetLeft + el.offsetWidth / 2 : 0)),
        tops: els.map((el) => (el ? el.offsetTop : 0)),
        hop: (lineEl ? parseFloat(getComputedStyle(lineEl).fontSize) : 48) * 0.55,
      };
    }

    line.words.forEach((w, j) => {
      const el = els[j];
      if (!el) return;
      const p = perWord ? wordProgress(w, t) : t >= line.start ? 1 : 0;
      el.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
      const b = perWord && !reduceMotion && p > 0 && p < 0.4 ? Math.sin((p / 0.4) * Math.PI) : 0;
      el.style.setProperty('--b', b.toFixed(3));
    });

    const ball = ballRef.current;
    const g = geo.current;
    if (!ball || !g || !perWord) return;
    const words = line.words;
    let k = -1;
    for (let j = 0; j < words.length; j++) if (words[j].start <= t) k = j;
    let x: number;
    let y: number;
    if (k < 0) {
      const f = clamp01(1 - (words[0].start - t) / 600);
      x = g.centers[0] - g.hop * 1.2 * (1 - f);
      y = g.tops[0] - Math.sin(f * Math.PI) * g.hop;
    } else if (k >= words.length - 1) {
      x = g.centers[words.length - 1];
      y = g.tops[words.length - 1];
    } else {
      const f = clamp01((t - words[k].start) / Math.max(1, words[k + 1].start - words[k].start));
      x = g.centers[k] + (g.centers[k + 1] - g.centers[k]) * f;
      y = g.tops[k] + (g.tops[k + 1] - g.tops[k]) * f - Math.sin(f * Math.PI) * g.hop;
    }
    ball.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  });

  // Word positions change when the window is resized; measure again.
  useEffect(() => {
    const forget = () => (geo.current = null);
    window.addEventListener('resize', forget);
    return () => window.removeEventListener('resize', forget);
  }, []);

  // Previous line, current line, and the next two.
  const visible: number[] = [];
  for (let i = Math.max(0, active - 1); i <= Math.min(lines.length - 1, active + 2); i++) visible.push(i);
  const offsets = useStackOffsets(active, visible, lineEls.current, (slot) => SCALE[slot] ?? 0.6, 0.3);

  return (
    <div className="ko">
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
            className={`ko-line slot-${slot < 0 ? 'prev' : slot}`}
            style={{ transform: `translate(-50%, ${(offsets.get(i) ?? 0).toFixed(1)}px) scale(${SCALE[slot] ?? 0.6})` }}
            dir={line.rtl ? 'rtl' : undefined}
            onClick={interactive && !line.interlude ? () => onSeek(seekTarget(line, offsetMs)) : undefined}
          >
            {line.interlude ? (
              <Dots className="ko-dots" />
            ) : (
              <>
                {slot === 0 && perWord && <span className="ko-ball" ref={ballRef} />}
                {line.words.map((w, j) => (
                  <Fragment key={j}>
                    <span
                      className={`ko-w${w.backing ? ' is-bg' : ''}`}
                      style={{ '--p': slot < 0 ? '100%' : '0%' } as CSSProperties}
                      ref={(el) => {
                        if (!wordEls.current.has(i)) wordEls.current.set(i, []);
                        wordEls.current.get(i)![j] = el;
                      }}
                    >
                      {w.text.trimEnd()}
                    </span>
                    {w.text !== w.text.trimEnd() ? ' ' : null}
                  </Fragment>
                ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
