// Apple Music-style lyrics:
//  • big bold lines, the current one bright, the rest dim and softly blurred
//  • words fill with light as they're sung (a soft gradient sweep)
//  • held notes glow and their letters ripple
//  • lines glide into place one after another (a staggered "wave" scroll)
//  • scroll/drag to look around, tap a line to jump there
import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { wordProgress } from '../../lib/lrc';
import { Dots, paintDots, resetDots } from './Dots';
import { clamp01, seekTarget, useLyricTimeline, wordByWord, type StyleProps } from './shared';

const LETTER_RE = /[\p{L}\p{N}]/gu;
const easeOut = (p: number) => 1 - (1 - p) ** 3;
/** Gradient stop for sweep progress p (0..1): starts fully dim, ends fully lit. */
const sweepPct = (p: number) => `${(p * 140 - 20).toFixed(1)}%`;

/** Writes a CSS variable only when it changes (keeps each frame cheap). */
const lastValues = new WeakMap<HTMLElement, Record<string, string>>();
function setVar(el: HTMLElement, name: string, value: string) {
  let rec = lastValues.get(el);
  if (!rec) lastValues.set(el, (rec = {}));
  if (rec[name] === value) return;
  rec[name] = value;
  el.style.setProperty(name, value);
}

interface Metrics {
  tops: number[];
  view: number;
}

export function AppleStyle(props: StyleProps) {
  const { lyrics, vibe, offsetMs, sweep, reduceMotion, interactive, onSeek } = props;
  const lines = lyrics.lines;
  const perWord = wordByWord(lyrics, sweep);

  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lineEls = useRef<(HTMLElement | null)[]>([]);
  const wordEls = useRef<(HTMLElement | null)[][]>([]);
  const charEls = useRef<(HTMLElement | null)[][][]>([]);
  const painted = useRef(-1);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [manual, setManual] = useState<number | null>(null);
  const manualTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const touchY = useRef<number | null>(null);

  const resetLine = (i: number) => {
    const line = lines[i];
    if (!line) return;
    if (line.interlude) return resetDots(lineEls.current[i]?.querySelector<HTMLElement>('.dots'));
    wordEls.current[i]?.forEach((el, j) => {
      if (!el) return;
      setVar(el, '--p', sweepPct(0));
      setVar(el, '--lift', '0');
      setVar(el, '--glow', '0');
      charEls.current[i]?.[j]?.forEach((c) => {
        if (!c) return;
        setVar(c, '--p', sweepPct(0));
        setVar(c, '--lift', '0');
      });
    });
  };

  const active = useLyricTimeline(props, (t, idx) => {
    if (painted.current !== idx) {
      resetLine(painted.current);
      painted.current = idx;
    }
    const line = lines[idx];
    if (!line) return;
    if (line.interlude) return paintDots(lineEls.current[idx]?.querySelector<HTMLElement>('.dots'), line, t);

    line.words.forEach((w, j) => {
      const el = wordEls.current[idx]?.[j];
      if (!el) return;
      if (!perWord) {
        setVar(el, '--p', sweepPct(1));
        return;
      }
      const p = wordProgress(w, t);
      const chars = charEls.current[idx]?.[j];
      if (chars?.length) {
        // Held note: letters light up one by one with a little ripple, and the word glows.
        const n = chars.length;
        chars.forEach((c, k) => {
          if (!c) return;
          setVar(c, '--p', sweepPct(clamp01(p * n - k)));
          const ripple = p > 0 && p < 1 ? Math.exp(-((p * n - k - 0.5) ** 2) / 1.6) : 0;
          setVar(c, '--lift', ripple.toFixed(3));
        });
        setVar(el, '--glow', (p > 0 && p < 1 ? Math.sin(p * Math.PI) : 0).toFixed(3));
      } else {
        setVar(el, '--p', sweepPct(p));
      }
      setVar(el, '--lift', easeOut(p).toFixed(3));
    });
  });

  // Measure where each line sits so we can scroll the current one into place.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const list = listRef.current;
    if (!wrap || !list) return;
    const measure = () =>
      setMetrics({ tops: lines.map((_, i) => lineEls.current[i]?.offsetTop ?? 0), view: wrap.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    ro.observe(list);
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [lines]);

  const focus = Math.max(0, active);
  const anchor = metrics ? metrics.view * (metrics.view < 600 ? 0.26 : 0.32) : 0;
  const baseShift = metrics ? anchor - (metrics.tops[focus] ?? 0) : 0;
  const scrolling = manual !== null;
  const shift = baseShift + (manual ?? 0);

  const nudge = (dy: number) => {
    if (!interactive || !metrics) return;
    const lo = anchor - (metrics.tops[metrics.tops.length - 1] ?? 0) - baseShift;
    const hi = anchor - (metrics.tops[0] ?? 0) - baseShift;
    setManual((m) => Math.min(hi, Math.max(lo, (m ?? 0) + dy)));
    clearTimeout(manualTimer.current);
    manualTimer.current = setTimeout(() => setManual(null), 2800);
  };

  return (
    <div
      ref={wrapRef}
      className={`am${scrolling ? ' is-scrolling' : ''}${perWord ? '' : ' line-mode'}`}
      style={{ '--scroll-ms': `${reduceMotion ? 250 : vibe.scrollMs}ms` } as CSSProperties}
      onWheel={(e) => nudge(-e.deltaY)}
      onPointerDown={(e) => {
        if (e.pointerType === 'touch') touchY.current = e.clientY;
      }}
      onPointerMove={(e) => {
        if (touchY.current === null) return;
        nudge(e.clientY - touchY.current);
        touchY.current = e.clientY;
      }}
      onPointerUp={() => (touchY.current = null)}
      onPointerCancel={() => (touchY.current = null)}
    >
      <div ref={listRef} className="am-lines">
        {lines.map((line, i) => {
          const d = i - focus;
          const delay = scrolling || reduceMotion ? 0 : Math.max(0, Math.min(d + 1, 8)) * vibe.staggerMs;
          const blur = scrolling || reduceMotion || active < 0 ? 0 : Math.min(Math.abs(d) * 1.1, 5);
          const style: CSSProperties = {
            transform: `translate3d(0, ${shift.toFixed(1)}px, 0)`,
            transitionDelay: `${delay}ms`,
            filter: blur ? `blur(${blur.toFixed(1)}px)` : undefined,
          };
          const cls = ['am-line', i === active && 'is-active', line.interlude && 'am-interlude', i < active && 'is-past']
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={line.id}
              ref={(el) => {
                lineEls.current[i] = el;
              }}
              className={cls}
              dir={line.rtl ? 'rtl' : undefined}
              style={style}
              aria-current={i === active ? 'true' : undefined}
              onClick={interactive && !line.interlude ? () => onSeek(seekTarget(line, offsetMs)) : undefined}
            >
              {line.interlude ? (
                <Dots />
              ) : (
                <span className="am-text">
                  {line.words.map((w, j) => {
                    const trimmed = w.text.trimEnd();
                    const letters = trimmed.match(LETTER_RE)?.length ?? 0;
                    const held =
                      perWord && lyrics.wordSynced && !line.rtl && w.end - w.start >= 1000 && letters > 0 && letters <= 14;
                    return (
                      <Fragment key={j}>
                        <span
                          ref={(el) => {
                            (wordEls.current[i] ??= [])[j] = el;
                          }}
                          className={`am-w${w.backing ? ' is-bg' : ''}${held ? ' is-held' : ''}`}
                        >
                          {held
                            ? [...trimmed].map((ch, k) => (
                                <span
                                  key={k}
                                  className="am-c"
                                  ref={(el) => {
                                    ((charEls.current[i] ??= [])[j] ??= [])[k] = el;
                                  }}
                                >
                                  {ch}
                                </span>
                              ))
                            : trimmed}
                        </span>
                        {w.text !== trimmed ? ' ' : null}
                      </Fragment>
                    );
                  })}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
