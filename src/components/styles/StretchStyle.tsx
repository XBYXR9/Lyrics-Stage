// Stretch: centered lines where each word glows for as long as it is held, then settles back.
// When a singer holds a word ("youuuu", "daaaay"), the letter being held grows bigger and bigger until the note ends,
// then shrinks back. It makes the most of real word timings; estimated ones work too.
import { Fragment, useRef, type CSSProperties } from 'react';
import { heldLetterIndex } from '../../lib/heldLetter';
import { wordProgress } from '../../lib/lrc';
import { Dots, paintDots } from './Dots';
import { clamp01, seekTarget, useLyricTimeline, useStackOffsets, wordByWord, type StyleProps } from './shared';

const SCALE: Record<number, number> = { [-1]: 0.7, 0: 1, 1: 0.72, 2: 0.6 };
/** Words shorter than this stay almost still; the full stretch needs a note held about this much longer. */
const HOLD_FROM_MS = 450;
const HOLD_RANGE_MS = 1600;
/** How long a word takes to settle back after it ends. */
const SETTLE_MS = 380;
/** A word is "held" (its letter grows) when it is sung at least this long. Estimated timings need a longer one to be sure. */
const LETTER_HOLD_REAL_MS = 650;
const LETTER_HOLD_ESTIMATED_MS = 1100;
/** The grown letter is at its biggest this far into the note, then shrinks back so it is small again as the note ends. */
const LETTER_PEAK_AT = 0.8;
/** The shrinking finishes this long after the note ends at the latest. */
const LETTER_SETTLE_MS = 200;

/** 0 while a word has not started, rising as it is sung, falling back to 0 after it ends. */
export function swell(start: number, end: number, t: number): number {
  if (t <= start) return 0;
  if (t < end) return Math.pow(clamp01((t - start) / Math.max(1, end - start)), 0.65);
  return clamp01(1 - (t - end) / SETTLE_MS) ** 2;
}

/** 0..1: how big the held letter is right now. It grows steadily while the word is sung, peaks near the end of the note, and is small again by the time the note is over. */
export function letterGrowth(start: number, end: number, t: number): number {
  if (t <= start) return 0;
  const dur = Math.max(1, end - start);
  const peakAt = start + dur * LETTER_PEAK_AT;
  if (t < peakAt) return Math.pow(clamp01((t - start) / (peakAt - start)), 1.35);
  const back = clamp01((t - peakAt) / (end - peakAt + LETTER_SETTLE_MS));
  return 1 - back * back * (3 - 2 * back); // smooth back down to 0
}

/** How far the held letter can grow (1 = it doubles in height), by how long the note is: about 0.4 for a short hold up to 1.3 for a long one. */
export const letterReach = (durationMs: number) => 0.4 + 0.9 * clamp01((durationMs - LETTER_HOLD_REAL_MS) / 1800);

/**
 * A held word is drawn in three pieces (before the held letter, the letter, after it), each with its own fill, because some
 * browsers (Safari on iPhone) draw a stray copy of a letter when a transformed letter sits inside a word whose text is
 * filled with a gradient. This turns the word's progress into the progress of the first and last piece, where `before`
 * and `letter` are the shares of the word's characters in front of the held letter and the letter itself.
 */
export function pieceProgress(p: number, before: number, letter: number): { first: number; last: number } {
  const rest = Math.max(1e-6, 1 - before - letter);
  return { first: before <= 0 ? 1 : clamp01(p / before), last: clamp01((p - before - letter) / rest) };
}

/** 0..1: how much a word is "held" (1 = a long note). */
export const holdOf = (durationMs: number) => clamp01((durationMs - HOLD_FROM_MS) / HOLD_RANGE_MS);

export function StretchStyle(props: StyleProps) {
  const { lyrics, offsetMs, sweep, interactive, onSeek, reduceMotion } = props;
  const lines = lyrics.lines;
  const perWord = wordByWord(lyrics, sweep);
  const lineEls = useRef(new Map<number, HTMLElement>());
  const wordEls = useRef(new Map<number, (HTMLElement | null)[]>());

  const active = useLyricTimeline(props, (t, idx) => {
    const line = lines[idx];
    if (!line) return;
    if (line.interlude) return paintDots(lineEls.current.get(idx)?.querySelector<HTMLElement>('.dots'), line, t);
    // The line that has just ended is still settling while the next one starts.
    for (const i of [idx - 1, idx]) {
      const l = lines[i];
      const els = wordEls.current.get(i);
      if (!l || !els || l.interlude) continue;
      l.words.forEach((w, j) => {
        const el = els[j];
        if (!el) return;
        const p = perWord ? wordProgress(w, t) : t >= l.start ? 1 : 0;
        if (el.dataset.held) {
          const { first, last } = pieceProgress(p, Number(el.dataset.before), Number(el.dataset.letter));
          el.style.setProperty('--pa', `${(first * 100).toFixed(1)}%`);
          el.style.setProperty('--pb', `${(last * 100).toFixed(1)}%`);
        } else el.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
        const s = perWord && !reduceMotion ? swell(w.start, w.end, t) : 0;
        el.style.setProperty('--s', s.toFixed(3));
        el.style.setProperty('--on', t >= w.start || !perWord ? '1' : '0');
        if (el.dataset.held) el.style.setProperty('--g', perWord && !reduceMotion ? letterGrowth(w.start, w.end, t).toFixed(3) : '0');
      });
    }
  });

  const visible: number[] = [];
  for (let i = Math.max(0, active - 1); i <= Math.min(lines.length - 1, active + 2); i++) visible.push(i);
  const offsets = useStackOffsets(active, visible, lineEls.current, (slot) => SCALE[slot] ?? 0.6, 0.3);

  return (
    <div className="st">
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
            className={`st-line slot-${slot < 0 ? 'prev' : slot}`}
            style={{ transform: `translate(-50%, ${(offsets.get(i) ?? 0).toFixed(1)}px) scale(${SCALE[slot] ?? 0.6})` }}
            dir={line.rtl ? 'rtl' : undefined}
            onClick={interactive && !line.interlude ? () => onSeek(seekTarget(line, offsetMs)) : undefined}
          >
            {line.interlude ? (
              <Dots className="st-dots" />
            ) : (
              line.words.map((w, j) => {
                const shown = w.text.trimEnd();
                const dur = w.end - w.start;
                const heldAt = !line.rtl && dur >= (lyrics.wordSynced ? LETTER_HOLD_REAL_MS : LETTER_HOLD_ESTIMATED_MS) ? heldLetterIndex(shown) : -1;
                const letters = heldAt >= 0 ? Array.from(shown) : [];
                return (
                  <Fragment key={j}>
                    <span
                      className={`st-w${w.backing ? ' is-bg' : ''}${heldAt >= 0 ? ' has-held' : ''}`}
                      data-held={heldAt >= 0 ? '1' : undefined}
                      data-before={heldAt >= 0 ? (heldAt / letters.length).toFixed(4) : undefined}
                      data-letter={heldAt >= 0 ? (1 / letters.length).toFixed(4) : undefined}
                      style={
                        {
                          '--p': slot < 0 ? '100%' : '0%',
                          '--pa': slot < 0 ? '100%' : '0%',
                          '--pb': slot < 0 ? '100%' : '0%',
                          '--s': 0,
                          '--g': 0,
                          '--on': slot < 0 ? 1 : 0,
                          '--h': holdOf(dur).toFixed(3),
                          '--k': letterReach(dur).toFixed(2),
                        } as CSSProperties
                      }
                      ref={(el) => {
                        if (!wordEls.current.has(i)) wordEls.current.set(i, []);
                        wordEls.current.get(i)![j] = el;
                      }}
                    >
                      {heldAt >= 0 ? (
                        <>
                          <span className="st-seg st-seg-a">{letters.slice(0, heldAt).join('')}</span>
                          <span className="st-held">{letters[heldAt]}</span>
                          <span className="st-seg st-seg-b">{letters.slice(heldAt + 1).join('')}</span>
                        </>
                      ) : (
                        shown
                      )}
                    </span>
                    {w.text !== shown ? ' ' : null}
                  </Fragment>
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );
}
