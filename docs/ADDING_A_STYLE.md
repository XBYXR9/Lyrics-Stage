# Adding a lyric style

A style is a React component that gets the song's timed lyrics and a clock, and draws them however it likes. You can
make a basic style in about 50 lines.

## 1. Create the component

Create `src/components/styles/MyStyle.tsx`:

```tsx
import { Fragment, useRef } from 'react';
import { Dots, paintDots } from './Dots';
import { seekTarget, sungCount, useLyricTimeline, wordByWord, type StyleProps } from './shared';

export function MyStyle(props: StyleProps) {
  const { lyrics, offsetMs, sweep, interactive, onSeek } = props;
  const lines = lyrics.lines;
  const perWord = wordByWord(lyrics, sweep); // respects the "Word-by-word highlight" setting
  const lineRef = useRef<HTMLDivElement>(null);

  // Runs every frame. `active` only changes (and re-renders) when the line changes.
  const active = useLyricTimeline(props, (t, idx) => {
    const line = lines[idx];
    const el = lineRef.current;
    if (!line || !el) return;
    if (line.interlude) return paintDots(el.querySelector('.dots'), line, t);
    // Light up the words that have started. Touch the DOM directly — no React state per frame.
    const count = perWord ? sungCount(line, t) : line.words.length;
    el.querySelectorAll('.my-w').forEach((w, j) => w.classList.toggle('on', j < count));
  });

  const line = lines[active];
  if (!line) return null;
  return (
    <div className="my">
      <div
        key={line.id}
        ref={lineRef}
        className="my-line"
        dir={line.rtl ? 'rtl' : undefined}
        onClick={interactive ? () => onSeek(seekTarget(line, offsetMs)) : undefined}
      >
        {line.interlude ? (
          <Dots />
        ) : (
          line.words.map((w, j) => (
            <Fragment key={j}>
              <span className="my-w">{w.text.trimEnd()}</span>{' '}
            </Fragment>
          ))
        )}
      </div>
    </div>
  );
}
```

## 2. Style it

Add CSS to `src/styles/lyrics.css`:

```css
.my { position: absolute; inset: 0; display: grid; place-items: center; }
.my-line { font: 800 calc(48px * var(--font-scale, 1)) var(--font-apple); text-align: center; max-width: 90%; }
.my-w { opacity: 0.3; transition: opacity 0.3s; }
.my-w.on { opacity: 1; color: var(--accent); }
```

These CSS variables are available:

| Variable | What it is |
| --- | --- |
| `--accent`, `--accent2` | Bright colors taken from the album cover |
| `--base` | Dark background color |
| `--font-scale` | The user's text size setting |
| `--font-apple`, `--font-serif`, `--font-poster`, `--font-neon` | Font stacks |

## 3. Register it

- Add the id to `StyleId` in `src/lib/types.ts`.
- Add an entry to `STYLES` in `src/components/styles/index.ts` with a name and a one-line blurb.
- Add a preview look for the settings card: `.sc-myid .sc-preview { … }` in `src/styles/app.css`.
- Optionally, teach **Auto** when to pick it in `analyzeVibe()` in `src/lib/vibe.ts`.

## What your component receives (`StyleProps`)

| Prop | Meaning |
| --- | --- |
| `lyrics.lines` | Timed lines. Each has `start`/`end` (ms), `text`, `words[]` (each with `start`, `end`, and `backing` for words in parentheses), `interlude` for "•••" breaks, and `rtl` for right-to-left lines |
| `lyrics.wordSynced` | `true` if the word timings are real, `false` if they're estimated |
| `clock` | `clock.now()` returns the song position in ms. `useLyricTimeline` already adds the user's timing offset |
| `vibe` | `energy` (0..1), `scrollMs`, `staggerMs`, `motion`: use these to make motion follow the song |
| `palette` | The colors as strings, if you need them in JS |
| `sweep` | The user's word-highlight setting (`wordByWord()` handles it for you) |
| `reduceMotion` | Tone things down when `true` |
| `interactive` | `false` while this song's lyrics are fading out. Ignore clicks then |
| `onSeek(ms)` | Jump the song to a position |

## Tips

- **Test with the demo** (`/?demo`). It has real word timing, estimated timing, an Arabic line, a held note,
  interludes and Automix blends.
- **Keep per-frame work cheap.** Update CSS variables or classes on a few elements, and only when the value changes.
- **Support RTL:** set `dir` on each line and mirror any left-to-right sweep.
- **Blends are handled for you.** During Automix, two copies of your style are on screen: the old song's copy fades out,
  still animating, and the new song's copy fades in.
