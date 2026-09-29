# Lyrics Stage

**Apple Music–style animated lyrics for whatever you play on Spotify.** It runs on your own computer, follows the music
on any of your devices, and picks lyric styles and colors that fit each song. When Spotify **Automix** or **Crossfade**
blends two songs together, the lyrics and colors blend too, for exactly as long as the songs overlap.

![Apple Music style](docs/screenshots/apple.jpg)

| Karaoke | Neon | Spotlight | Kinetic |
| --- | --- | --- | --- |
| ![Karaoke](docs/screenshots/karaoke.jpg) | ![Neon](docs/screenshots/neon.jpg) | ![Spotlight](docs/screenshots/spotlight.jpg) | ![Kinetic](docs/screenshots/kinetic.jpg) |

> The screenshots come from the built-in **demo mode**. The demo songs and lyrics are made up.

## What it does

- **Apple Music–style lyrics.** Big bold lines. Words light up as they're sung, held notes glow, and lines glide into
  place one after another. You can tap a line to jump to it, or scroll to look around.
- **Five styles, plus Auto.** Apple Music, Karaoke (with a bouncing ball), Neon, Spotlight and Kinetic. **Auto** picks
  one for each song based on how fast the words come and how colorful the cover is.
- **Adapts to each song.** Colors come from the album cover. The background moves faster for energetic songs and slower
  for calm ones, and the scroll speed changes the same way.
- **Adapts to Spotify Automix & Crossfade.** The app notices when songs overlap and crossfades the lyrics and background
  over the same length of time. The old song's lyrics keep moving in time while they fade out.
- **Follow any device, or play in the browser.** It follows playback on your phone, the desktop app or a speaker. With
  Premium you can also play music right in the page.
- **Search and play any song**, or add it to your queue.
- **Works with right-to-left lyrics** such as Arabic and Hebrew.
- **A demo mode** to try every style without connecting Spotify.

## Quick start

You need [Node.js](https://nodejs.org) 20.19 or newer, plus a Spotify account (Premium is needed to control playback).

```bash
git clone https://github.com/xbyxr9/spotifylyrics.git
cd spotifylyrics
npm install
npm run dev
```

The site opens at **http://127.0.0.1:5173**. The page then walks you through three steps:

1. Create a free app on the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Add the redirect URI `http://127.0.0.1:5173/callback`, and tick **Web API** and **Web Playback SDK**.
3. Paste the app's **Client ID** into the page and click **Connect Spotify**.

The full guide, with fixes for common problems, is in **[docs/SETUP.md](docs/SETUP.md)**.

Just want to look around? Click **Try the demo** on the first screen.

## Using it

- Play a song in any Spotify app and it appears on the page. You can also press <kbd>/</kbd> to search.
- Click the style button at the top (or press <kbd>Y</kbd>) to switch styles.
- Open **Settings** (<kbd>S</kbd>) to change text size, the word highlight, the background, the transitions and the
  lyrics timing. If the lyrics feel late (Bluetooth headphones add a delay), press <kbd>]</kbd> to show them earlier.

| Key | Action |
| --- | --- |
| <kbd>Space</kbd> | Play / pause |
| <kbd>N</kbd> / <kbd>P</kbd> | Next / previous song |
| <kbd>/</kbd> | Search |
| <kbd>S</kbd> | Settings |
| <kbd>Y</kbd> | Next lyrics style |
| <kbd>L</kbd> | Lyrics only (hide the player) |
| <kbd>F</kbd> | Fullscreen |
| <kbd>[</kbd> / <kbd>]</kbd> | Show lyrics 0.1s later / earlier |

## How it works (short version)

- **Spotify:** the site logs in with Spotify's PKCE flow, so no secret or server is needed. It checks what's playing
  about once a second, and more often near the end of a song so it can catch Automix transitions.
- **Lyrics:** they come from [LRCLIB](https://lrclib.net), a free and open database of time-synced lyrics. When a song
  only has line timing, the app estimates the timing of each word.
- **Automix detection:** Spotify doesn't say when Automix is happening, but the timing gives it away. If the next song
  starts while the current one still has time left, or starts part-way in, it's a blend.

The details are in **[docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md)**.

## Project layout

```
src/
  lib/            logic: Spotify login & API, playback engine, clock, Automix detection,
                  lyrics lookup & parsing, color palette, song "vibe", demo mode
  components/     React UI: stage, player panel, search, settings, background
    styles/       the lyric styles (Apple Music, Karaoke, Neon, Spotlight, Kinetic)
  styles/         CSS
docs/             guides and screenshots
```

## Contributing

Ideas, bug reports and new lyric styles are welcome. See **[CONTRIBUTING.md](CONTRIBUTING.md)**. If you want to add a
style, start with **[docs/ADDING_A_STYLE.md](docs/ADDING_A_STYLE.md)**.

```bash
npm run dev        # start the site
npm test           # run the unit tests
npm run typecheck  # check types
npm run build      # production build
```

## Limits

- Controlling playback (play, pause, skip, search-to-play) needs **Spotify Premium**. That's Spotify's rule.
- Apps in Spotify's "Development mode" work for up to 5 Spotify accounts, which you add in the dashboard.
- Some songs have no lyrics on LRCLIB yet. You can add them at [lrclib.net](https://lrclib.net).
- Spotify doesn't share Automix transition points, so blends are detected from timing. The detection is usually
  accurate to within half a second.

## Credits & license

- Lyrics: [LRCLIB](https://lrclib.net), a community project. Please be kind to their servers.
- Not affiliated with, or endorsed by, Spotify or Apple. "Apple Music" describes the visual style only.

[MIT](LICENSE)
