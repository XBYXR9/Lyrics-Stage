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

There are three engines (the Android app uses the Web API one, see [ANDROID.md](ANDROID.md)), and they all share the same song-change and Automix logic (`BaseEngine.observe` in
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
  It is off with Reduce motion, which is also what makes the song change itself quick (250 ms) instead of as long as
  the overlap, so with it on an Automix change looks abrupt. Reduce motion starts as whatever the computer asks for
  (Windows: Settings → Accessibility → Visual effects → Animation effects) and is only saved once somebody chooses it in
  Settings (`settingsToStore` in `src/lib/settings.ts`): before 0.6.9 it was saved along with any other setting, so a
  moment of "animations off" stayed on for good. An explicit "Reduce motion: off" wins over the system setting on the
  main screen (`.calm-ui` in `src/styles/app.css`). When a blend happens and a setting is why the covers don't merge, a
  note says so (`src/lib/motionHint.ts`, shown at most three times), and the timing report logs each change with its
  animation length and whether the cover merge was on (`coverMergeBlocker`), plus a `motion:` line.
- A small "Automix blend · 6.2s" badge appears.

**Timing after a blend.** When Spotify moves on by itself with Crossfade or Automix, the position it reports for the new
song can be ahead of the audio until the next pause, resume or seek (or a quiet refresh, see below) makes Spotify refresh
it (a known Spotify quirk, also seen through AppleScript). Left alone, the lyrics run early for the rest of the song.

*How far ahead?* Versions 0.5.2 to 0.6.6 assumed "by the length of the blend", and took that off every report. A real
timing report (a Windows PC, Automix, seven measured blends) showed otherwise: Spotify was ahead by **0.4 to 1.4 s**
(about a second), while the blend lasted 9.5 to 12 s. Taking 12 s off made the lyrics about 11 s late until the re-sync
ran, and then they jumped forward. So now, after a `blend`, `BaseEngine.observe` takes off only what the app has
**measured** on earlier blends (the middle value of the last four, `BlendBiasLearner.recentBias()`; nothing before the
first measurement), or a guess that has proven right on the last two blends (`old-song` is still such a guess, for a
Crossfade of fixed length). It stops as soon as Spotify refreshes itself: a pause or resume, a seek (here or from another
device), or the reports stepping *back* by about the error (Spotify refreshing itself) or jumping forward by more than
2.5 s. The first answers after a song change can be stale and then catch up (21.1 s reported while the real position
was 25.5 s), so for the first 4 s (`CHANGE_SETTLE_MS`) a forward step is not taken for a seek: 0.6.7 took it for one,
dropped the correction and cancelled the re-sync, which left the lyrics about a second early. Skips and natural song endings are never touched, a new
song that shows up minutes in is taken for somebody seeking (Automix was seen starting the next song 8 to 21 s in), and
a song whose position we count ourselves (Linux) has nothing to correct. Settings → Song transitions → *Keep lyrics in
time after a blend* switches it off.

**Re-sync after a blend (`BaseEngine.resync`, `src/lib/blendBias.ts`).** Spotify's own apps have this bug too: after a
blend, the position of the new song stays wrong until Spotify refreshes it, and people fix it by seeking or by pausing
and playing again. By how much it is wrong isn't known and differs between setups, so guessing it from the old song's
remaining time wasn't enough. Now, 6 s after a `blend` (and only then), the app pauses and resumes the music for a split
second (the Web API's pause and play, or the Spotify app's own commands in the desktop app), waits 2 s for Spotify's
server to settle, and compares the position it then reports with where the earlier reports said the song would be. The
difference is the real error; from then on the lyrics follow Spotify's refreshed reports. Each measurement is stored
next to the two guesses made when the blend was seen (`first-report`: the position of the new song when it showed up;
`old-song`: how much of the old song was left; and `recent`: what the last few blends measured). When one guess has
been right on the last two blends, the app uses it
and stops pausing the music. It checks again after 2 blends, then 4, 8 and 16 as long as the checks pass (the music is
paused less and less); a check that fails starts the measuring again. In the desktop app signed in to Spotify, when the
Spotify app on this computer has just reported that it is playing exactly this song (`src/lib/localPlayer.ts`), the
pause and resume go to that app through the operating system instead of through Spotify's servers, which makes the gap
in the music a fraction of a second shorter; the timing report says which way was used.

**Quiet ways (`src/lib/silentProbes.ts`).** Pausing is heard, so before it the app tries quiet attempts that might make
Spotify's player publish a fresh state too: nudging the volume one step and back, and changing the repeat mode to
another and back (`SpotifyEngine.silentProbes`). Nobody knows if the player answers those with a fresh position, so the
app finds out by itself: after a quiet attempt it waits 2 s and looks at what Spotify reports. If the position jumped
by 0.5 s or more, that way works: it is remembered (kept in the browser) and used on every blend from then on, with no
pause at all. If nothing changed, it pauses and resumes as before, and if that shows an error the quiet attempt didn't
find, the quiet way is written off (and the next one is tried on the next blend). A blend with no error to find teaches
nothing about a quiet way. Spotify refusing it (400, 403, 404) writes it off at once; a network hiccup doesn't. Both
attempts put everything back as they found it, retrying once if putting it back fails. The re-sync
is skipped when someone pauses or seeks first, near the end of a song, without Premium (403: not tried again), for
the browser's own player (its positions are exact) and where the Spotify app gives no position (Linux). Settings → Song
transitions → *Re-sync the timing after a blend* switches it off.

**Stale reports during a mix.** While Spotify mixes into the next song it can answer with the song it just left for a
moment, between answers about the new one. Taken for a change back, that would flip the lyrics, the clock and the
animations back and forth (the lyrics restarted several times and ended up out of time). So within 14 s of a change, a
report of the song just left that puts it where it was when it was left, or later (not more than 4 s earlier, which
covers a frozen position as well as one that kept counting), is ignored (`BaseEngine.observe`) and noted in the timing
report. A real change back, like pressing "previous" (the old song then starts from its beginning, far earlier), is
still followed.

**Finding timing problems.** That correction is a best guess from a known Spotify quirk, so the app keeps a short
note of what Spotify reports around song changes (`src/lib/timingLog.ts`: each hand-over with how it was classified,
the blend length and the correction, then the reported position against the app's own clock for about 45 s, when
the correction was dropped, and each re-sync: the error it measured and what it has learned; in the desktop app signed in, also what the Spotify app on the computer reports).
Settings → *Copy timing report* copies it as text, with the version, the source and the settings. For a bad song in
the meantime, `,` and `.` nudge the lyrics later or earlier for that song only (`src/lib/nudge.ts`, 0.5 s a step,
Shift: 0.1 s, up to 30 s), without touching the music; it ends with the song.

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
Windows desktop app, "Follow your PC's sound" instead feeds the bars from a Web Audio analyser on the system sound
(`src/lib/audioLevels.ts`).

### Beat flash

Strong beats are found in one place, `useBeatFlash` (`src/hooks/beatHooks.ts`), once per frame for the whole screen. The
rules are in `src/lib/beat.ts` (`beatPlan`): with synced lyrics a flash may only happen in a *short pause* (after one
sung line, before the next, a gap of at least 250 ms and under the 4.5 s that makes an interlude); with the no-lyrics
scene on screen it happens on every strong beat. *Every bass beat* heard in the real sound may also flash anywhere in the song (`anywhere`; Settings → Bass beats glow
even while singing), since the estimated rhythm isn't the real beat and stays in the pauses. `detectBeat` (`src/lib/audioLevels.ts`) finds a bass
beat (a kick, a bass note, an 808) as a sharp rise in the low bins of the spectrum (30 to 130 Hz). Each bin is
watched on its own against the lowest it has been lately, so a loud steady bass note in one bin doesn't hide a kick
rising in the bins around it, and the rises are added up (deep bins count most). Steady loud bass, a slow swell and
the tail of the last beat don't count; beats are at least 250 ms apart. The analyser's decibel scale is widened
(`configureAnalyser`: -90 to -5 dB instead of the default -100 to -30), because in loud music the bass sits above -30 dB
all the time, which made it read "full" and hid every kick. A beat's strength is how hard it hit compared with the
hardest recent beat, so harder beats flash brighter, and beats of 0.7 and up are "big" (the no-lyrics scene gives
those a harder punch and a shockwave). Limits: low voices and instruments near 130 Hz can occasionally set it off,
and flashes are still capped at three a second, so very fast bass patterns are thinned out. The look is picked in Settings (`BeatStyle`): the hook writes `--bf`,
`--bf-ring` and `--bf-rs` on the `.beat-fx` layer and CSS (`src/styles/lyrics.css`) shows the glow and ring, a
full-screen wash or lit edges; "kick" scales the lyrics area instead. Flashes are at least 340 ms apart (never more
than three a second, the accessibility limit for flashing content), the glow never goes above 40% opacity, the wash
about 26%, and Reduce motion turns it all off. Every beat is also announced on a small bus (`onBeat`) so the scene can
punch with it.

The beats come from the real sound when it's on (`detectBeat` in `src/lib/audioLevels.ts`: bass jumping well above its
recent average), otherwise from the estimated rhythm (`estimatedBeat` in `src/lib/pulse.ts`).

### The playback window

The computer's sound is only used inside the song's *playback window* (`inSongWindow` in `src/lib/beat.ts`): the clock
is running, the position is inside the song, and it isn't an ad. The main screen sets the window every frame
(`setPlaybackWindow`); `LevelReader` (`src/lib/audioLevels.ts`) refuses to look at the sound while it's closed, throws
away anything it was holding when it closes (so a late beat can't fire), and starts its beat detector from scratch
when it opens (with a few warm-up looks so the bars rising from nothing aren't taken for a beat). This is what stops a
video or a notification ping on the computer from flashing the screen while Spotify is paused. A delay line holds
what was heard for up to 500 ms for Bluetooth headphones.

### Songs without lyrics

When the lyrics are `none` or `instrumental` (and Reduce motion is off, and the user didn't pick "Just a message"),
`LyricsLayer` shows `BeatScene` (`src/components/BeatScene.tsx`) instead of a message: a canvas in the cover's colors,
either an orb with 48 bars around it or a mirrored equalizer. It reads the same bar heights as the break visualizer
(real sound or estimate) and listens to the beat bus: each beat adds a ripple and a punch (`src/lib/scene.ts`), and
beats of strength 0.7 or more are "big": a harder punch and a shockwave that reaches much further. The scene is drawn
in the lyrics area only (beside the cover and player), so its glow and rings fade out before the area's nearest edge
(`edgeFade` in `src/lib/scene.ts`); otherwise they would end in a hard straight line there and the screen would look
split in two. The bars blend the two album colors smoothly all the way round (`mixHsl`).

### Lyrics only

Switching "lyrics only" on slides the cover and player away (the cover shrinks, spins and blurs out first) while the
lyrics widen; switching it off brings them back with a little pop. The player stays mounted until its exit animation
ends (`usePresence` in `src/hooks/hooks.ts`). "Reduce motion" skips all of it.

### The recording view (TikTok)

<kbd>R</kbd>, the phone-shaped button or Settings → Record for TikTok turns the whole picture (background, beat flash,
lyrics, cover and song name) into a 9:16 frame in the middle of a black, full screen. The app doesn't record anything
itself: you record the screen with OBS or the phone's screen recorder and crop to the frame.

- **The frame.** `recordFrame()` in `src/lib/record.ts` picks the biggest 9:16 box that fits the window (608 × 1080 on a
  1920 × 1080 screen, the full width of a phone with black bars above and below). Everything that is part of the
  picture lives inside one `.stage-frame` element, which is simply the whole screen normally. In the recording view
  it gets that size, and the main screen sets `--rec-w` and `--rec-h` on it.
- **Sizes follow the frame, not the screen.** The lyric styles size their text from the screen's width, which would be
  far too big in a narrow frame. The block at the end of `src/styles/lyrics.css` re-sizes the text, the bars and the
  glow from `--rec-w` and `--rec-h`. The background canvas and the Spotlight style read the frame's size too.
- **What goes away.** The top bar, the cover and player, the Automix badge and the toasts (the hints and the ✕ sit
  outside the frame on a wide screen).
- **TikTok's safe area.** TikTok draws its own buttons over the video, so nothing important goes under them: the top
  14% (the LIVE / Following / For You bar) holds only the picture, the cover and song name start at 15%, and the lyrics
  stay between 23% and 78% of the height and 12% in from each side (the like / comment / share buttons are on the
  right, the caption and sound name at the bottom). It is the padding of `.stage-main` and the position of `.rec-hud`
  in `src/styles/app.css`.
- **Sound.** The app records nothing, and TikTok flags a video with the song's audio inside the file as copyrighted
  and mutes it. The recording should be without sound, with the song added in TikTok (*Add sound*).
- **Full screen.** It asks the browser for fullscreen (on the phone it hides the status and navigation bars instead
  with Capacitor's `SystemBars`), and it ends when fullscreen ends (Esc), on <kbd>R</kbd>, on the ✕, or with the
  phone's Back button. The screen is kept awake while it's on.

## 8. Demo mode (`src/lib/demo.ts`)

`DemoEngine` implements the same `Engine` interface as the real one, using three made-up songs, generated covers and a
fake clock. It includes:

- one song with real word timing,
- a slow ballad with an Arabic line,
- a fast rap,
- scripted Automix blends between songs.

That makes it handy for trying styles and for developing without Spotify. Open `http://127.0.0.1:5173/?demo`.
