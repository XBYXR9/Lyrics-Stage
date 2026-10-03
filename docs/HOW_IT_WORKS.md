# How it works

This page explains the main parts of the app and how they fit together.

```
 Spotify app (desktop) ──OS media interface──► electron/bridge ──IPC──┐
 Spotify Web API ──poll /me/player────────────────────────────────────┤
 Web Playback SDK ──state events──────────────────────────────────────┼─► Engine ──► clock + current song + "how did the song change?"
 Demo songs ──fake clock──────────────────────────────────────────────┘        │
                                             ▼
 LRCLIB ──► lyrics lookup ──► parser ──► timed lines & words
 Album cover ──► color palette                │
                     └──► "vibe" (energy) ────┤
                                              ▼
                         Stage: background · lyric layers · player panel
```

There are three engines, and they all share the same song-change and Automix logic (`BaseEngine.observe` in
`src/lib/engine.ts`):

| Engine | Used by | Source |
| --- | --- | --- |
| `DesktopEngine` (`src/lib/desktopEngine.ts`) | the desktop app | the Spotify app on the same computer |
| `SpotifyEngine` (`src/lib/engine.ts`) | the web version | Spotify Web API + Web Playback SDK |
| `DemoEngine` (`src/lib/demo.ts`) | demo mode | made-up songs on a fake clock |

## 0. The desktop app and the Spotify app (`electron/`)

The desktop app is an Electron window showing the same page as the web version. Its main process
(`electron/main.ts`) links it to the **Spotify app you already use**, through the system interfaces Spotify supports:

- **macOS** (`bridge/mac.ts`): a small JavaScript-for-Automation loop (`osascript -l JavaScript`) reads
  `playerState`, `playerPosition` and `currentTrack` four times a second. Commands are one-line AppleScripts
  (`playpause`, `next track`, `set player position to …`). macOS asks the user once for permission (Automation).
- **Windows** (`bridge/windows.ts`): a PowerShell script (built into Windows) uses
  `GlobalSystemMediaTransportControlsSessionManager` (the "media controls" API) to read the title, artist, timeline
  and cover of the Spotify session. The position is extrapolated from `LastUpdatedTime`. Commands go to the same script
  through its input, one JSON line each.
- **Linux** (`bridge/linux.ts`): MPRIS over the D-Bus session bus, using `dbus-next`. Spotify's Linux app always reports
  position 0, so the bridge sends `positionMs: null`. The page then counts time from the start of each song, and
  treats a seek from the app as a fresh sync point.

Each bridge turns its answers into a `DesktopSnapshot` (`src/lib/desktopTypes.ts`): running, playing, track, position,
and the time it was taken. Snapshots go to the page over IPC. The page's API (`window.lyricsStage`, from
`electron/preload.ts`) is deliberately small: listen to snapshots, send a command, open Spotify, keep the window on top.
Every command is checked in the main process (`validateCommand`) before it reaches AppleScript, PowerShell or D-Bus.

Because the music plays in Spotify itself, **Spotify's Automix and Crossfade apply**, and the page detects the blends
from the timing, exactly as described in section 4.

## 1. Login — web version (`src/lib/auth.ts`)

The app uses Spotify's **Authorization Code with PKCE** flow. Because PKCE doesn't need a client secret, everything runs
in the browser and no server is required. Tokens are saved in `localStorage` and refreshed automatically.

Spotify only accepts loopback **IP addresses** such as `127.0.0.1` as local redirect URIs, not `localhost`. For that
reason the dev server listens on `127.0.0.1:5173`, and `main.tsx` redirects `localhost` there.

## 2. Following playback — web version (`src/lib/engine.ts`)

The **engine** keeps track of what's playing and gets its information from two sources:

- **Web API polling:** `GET /me/player` about once a second. This works for any device (phone, desktop app, speakers),
  which matters because that's where Automix and Crossfade happen. The engine polls faster when something is about to
  happen:
  - every 500 ms near the end of a song (to catch a blend quickly),
  - every 700 ms right after a song change (to settle the new position),
  - every 2.5–4 s while paused or when the tab is hidden.
  It backs off on errors and follows Spotify's `Retry-After` header on 429 responses.
- **Web Playback SDK:** when you press "Play here", the browser tab becomes a Spotify device. Its state events give exact
  positions, so the engine polls the API less often.

It also reads the **queue** so the next song's lyrics and colors are loaded before that song starts.

## 3. A smooth clock (`src/lib/clock.ts`)

Spotify reports the position about once a second, but lyrics need to update 60 times a second. The `PlaybackClock`
counts forward on its own between reports:

- Each report is timed at the midpoint of the request, to cancel out network delay.
- Small differences (under 0.7 s) are **slewed**: the clock runs slightly fast or slow for up to a second until it
  catches up. This avoids jumps.
- Large differences (seeks) jump straight to the new position.
- `fork()` makes a copy of the clock that keeps running on its own. It's used for the "ghost" of the previous song during
  a blend.

## 4. Detecting Automix & Crossfade (`src/lib/transitions.ts`)

Spotify's API doesn't say when Automix happens. The timing, however, gives it away. When the song changes, we compare:

- **how much time the old song had left** when it was replaced, and
- **where the new song started** (Automix often skips intros).

| What we see | Meaning | Visual transition |
| --- | --- | --- |
| Old song ran to the end, new one starts at 0 | `natural` | 0.9 s fade |
| Old song had more than 14 s left, new one starts at 0 | `skip` (you pressed next) | 0.45 s fade |
| Old song had 1–14 s left, or the new song started part-way in | `blend` (Automix/Crossfade) | Lasts as long as the overlap (1.2–8 s) |

The `BlendLearner` remembers how long your blends usually last (for example, your Crossfade setting). The engine uses
that to decide when to start polling faster near the end of each song.

During a blend:

- The old song's lyrics stay on screen, driven by a **ghost clock** that keeps them moving in time. They sink and blur
  away while the new song's lyrics rise in (`src/components/LyricsStage.tsx`).
- The background fades from the old cover to the new one over the same length of time
  (`src/components/Background.tsx`).
- The player's album cover merges too: the old cover slides aside and fades while the new one slides in over it
  (`planCoverMerge` in `src/lib/transitions.ts`, drawn in `src/components/NowPlaying.tsx`).
- A small "Automix blend · 6.2s" badge appears.

## 5. Lyrics (`src/lib/lyrics.ts`, `src/lib/lrc.ts`)

Lyrics come from **[LRCLIB](https://lrclib.net)**, a free, open lyrics database that needs no API key.

Lookup order:

1. `GET /api/get`: an exact match on title, artist, album and duration (only when the song's length is known).
2. `GET /api/search`: a search on a *cleaned* title ("Hey Jude - Remastered 2015" becomes "Hey Jude"; "(feat. …)",
   "(Radio Edit)" and similar are removed) plus the artist.
3. A looser free-text search.
4. A search by title alone, for when LRCLIB spells the artist differently.

A different length usually means a different recording (live, radio edit, a cover), whose timing won't match what you
hear. So results must be within 8 s of the song's length, and entries by another artist name are only accepted within
2 s. Among those, results are scored by how close the length is, whether they're time-synced, and whether they have
word timing.

The desktop app can learn a song's length a moment after its title (Windows). Without a length the app waits briefly,
then searches by title and artist only; when the length arrives, it looks again. Results are cached per song *and*
length, in memory and in `localStorage` (the last 80 songs).

The parser understands:

- **LRC**: `[mm:ss.xx] line`, with repeated timestamps, `[offset:]` tags, and empty lines or "♪" marking instrumental
  parts.
- **Enhanced LRC**: `<mm:ss.xx>` tags on each word.
- **LRCLIB Lyricsfile** (YAML), for real word-by-word timing.
- Plain text, which is shown as a slowly scrolling page.

Most songs only have **line** timing. To make word-by-word highlighting possible anyway, the parser estimates word
timing. First it measures the song's **pace** (ms per letter) on lines that run straight into the next one: about 65
for rap, 100–115 for pop, 160 for a slow ballad. Each line is then sung at that pace, but never longer than the gap to
the next line, so a short line before a pause isn't stretched over the pause. That time is spread over the words,
giving longer words and pauses after punctuation more time.

It also:

- adds **interludes** (the "•••" dots) for instrumental gaps longer than 4.5 s,
- marks words in (parentheses) as backing vocals, which are drawn smaller,
- detects right-to-left scripts (Arabic, Hebrew, …) for each line.

## 6. Colors and "vibe" (`src/lib/palette.ts`, `src/lib/vibe.ts`)

**Palette:** the cover is shrunk to 40×40 pixels and grouped into 8 colors (k-means). From those the app picks:

- a dark **base** color for the background,
- a bright, readable **accent** color for highlights,
- a second accent,
- a few colors for the moving blobs.

**Vibe:** Spotify no longer gives new apps tempo or energy data, so the app estimates energy from:

- **how fast the words come** (words per second, measured from line spacing): rap is around 3 or more, ballads around 1;
- **how colorful and bright the cover is** (a smaller factor).

Energy controls scroll speed, the stagger between lines, how fast the background moves, and how much Kinetic words
tilt. In **Auto** mode it also picks the style:

- fast words → Kinetic
- very calm → Spotlight
- dark and colorful covers → Neon
- bright, upbeat songs → Karaoke
- everything else → Apple Music

## 7. Drawing (`src/components`)

- **Background:** drawn on a canvas only about 128 px wide, blurred and stretched to fill the screen. That keeps it
  cheap. "Album art" mode draws 4 slowly turning copies of the cover, as Apple Music does. "Color flow" mode draws blobs
  of the palette colors.
- **Lyric styles:** each style runs one `requestAnimationFrame` loop (`useLyricTimeline`). React re-renders **only when
  the current line changes**. The per-frame word animation writes CSS custom properties (such as `--p` for sweep
  progress) directly to the word elements. Registered CSS properties (`@property`) let those values be animated
  smoothly.
- **Apple Music style:** every line shares the same scroll offset, but each line starts moving a little later than the
  one above it, which creates the wave. Lines are blurred more the further they are from the current one. Held notes
  (≥ 1 s, with real word timing) are split into letters that ripple and glow.

### Instrumental breaks

During a break (an *interlude* line), every style shows the same visual (`src/components/styles/Dots.tsx`): 24 bars in
the cover's colors, plus a thin progress line, or the three dots if you prefer (Settings). The bars follow a rhythm
estimated from the song's energy (`src/lib/pulse.ts`: low bars thump on every beat, middle bars snap on beats 2 and 4,
high bars flick on the off-beats). It's worked out from the playback position, so seeking can't desync it. In the
Windows desktop app, "Follow the real sound" instead feeds the bars from a Web Audio analyser on the system sound
(`src/lib/audioLevels.ts`).

### Beat flash

In a *short pause* (after one sung line, before the next, a gap of at least 250 ms and under the 4.5 s that makes an
interlude), `BeatFlash` (`src/components/BeatFlash.tsx`) pulses a tinted glow and a ring behind the lyrics on strong
beats. The rules are in `src/lib/beat.ts`: flashes are at least 340 ms apart (never more than three a second, the
accessibility limit for flashing content), the glow never goes above 40% opacity, and Reduce motion turns it off. The
beats come from the real sound when "Follow the real sound" is on (`detectBeat` in `src/lib/audioLevels.ts`: bass
jumping well above its recent average), otherwise from the estimated rhythm (`estimatedBeat` in `src/lib/pulse.ts`).

### Lyrics only

Switching "lyrics only" on slides the cover and player away (the cover shrinks, spins and blurs out first) while the
lyrics widen; switching it off brings them back with a little pop. The player stays mounted until its exit animation
ends (`usePresence` in `src/hooks/hooks.ts`). "Reduce motion" skips all of it.

## 8. Demo mode (`src/lib/demo.ts`)

`DemoEngine` implements the same `Engine` interface as the real one, using three made-up songs, generated covers and a
fake clock. It includes:

- one song with real word timing,
- a slow ballad with an Arabic line,
- a fast rap,
- scripted Automix blends between songs.

That makes it handy for trying styles and for developing without Spotify. Open `http://127.0.0.1:5173/?demo`.
