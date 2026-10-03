# The desktop app

The desktop app is the easiest way to use Lyrics Stage:

- **No Spotify developer account.** Stay logged in to the Spotify app the usual way; Lyrics Stage follows it.
- **Automix and Crossfade work.** The music plays in Spotify, so Spotify's own Automix (desktop, since May 2026) and
  Crossfade do the mixing. Lyrics Stage notices each blend and crossfades the lyrics and colors to match.
- **It works on macOS, Windows and Linux.**

## Install

**Download:** grab the installer for your system from the
[Releases page](https://github.com/xbyxr9/spotifylyrics/releases):

| System | File |
| --- | --- |
| macOS (Apple silicon) | `Lyrics-Stage-…-mac-arm64.dmg` |
| macOS (Intel) | `Lyrics-Stage-…-mac-x64.dmg` |
| Windows (most PCs: Intel/AMD) | `Lyrics-Stage-…-win-x64.exe` |
| Windows on ARM (Snapdragon, Surface Pro X…) | `Lyrics-Stage-…-win-arm64.exe` |
| Linux | `Lyrics-Stage-…-linux-x86_64.AppImage` or `.deb` |

The installers aren't code-signed yet, so your system may warn you the first time:

- **macOS:** "can't be opened because Apple cannot check it". Right-click the app → **Open** → **Open**. You only need
  to do this once.
- **Windows:** "Windows protected your PC". Click **More info** → **Run anyway**.

**Updates:** you only install by hand once (starting with version 0.2.0). After that:

- **Windows and the Linux AppImage** update themselves. A new version downloads in the background, and an
  **Update ready · Restart** button appears at the top. Click it, or just quit the app, and the new version installs.
- **macOS and the Linux `.deb`** show **Version … is out · Download** instead. macOS only lets *signed* apps replace
  themselves (signing needs a paid Apple Developer account); a `.deb` belongs to your system's package manager.

**Or run it from the source code:**

```bash
npm install
npm run app:start     # builds and opens the app
```

## First run

1. Open **Spotify** and log in the usual way.
2. Open **Lyrics Stage**, then play a song in Spotify. The lyrics appear.
3. **macOS only:** the first time, macOS asks *"Lyrics Stage wants access to control Spotify"*. Click **OK**. If you
   clicked "Don't Allow", go to **System Settings → Privacy & Security → Automation → Lyrics Stage** and turn on
   **Spotify**.

## Sign in with Spotify (optional)

Out of the box, the app follows the Spotify app on the same computer, with no setup. You can instead **sign in with
your Spotify account**, and the app then uses Spotify's own data (the Spotify Web API), like the web version:

- **Exact timing and covers** straight from Spotify, on every system (no estimated timing on Linux, no missing covers
  on Windows).
- **Follows any device**: your phone, a speaker, or the Spotify app on another computer.
- **Search and play** songs from inside Lyrics Stage (playback control needs Premium).

Music still plays in a Spotify app; the desktop app can't play music itself (Spotify's in-page player needs copy
protection that the app doesn't include).

**Set it up once:**

1. In the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), click **Create app** (any name).
2. Add this **Redirect URI**: `http://127.0.0.1:43117/callback`, tick **Web API**, and save.
3. Under **User Management**, add the email of each Spotify account that will sign in (up to 5; Development mode).
4. In Lyrics Stage: **Settings → Spotify connection → Sign in with Spotify** (or the button on the start screen). Paste
   the app's **Client ID** and click **Sign in with Spotify**.
5. Your browser opens Spotify's login. Allow access; when the page says you're signed in, go back to the app.

The app remembers the login. **Settings → Spotify connection → Sign out** goes back to following the Spotify app on
this computer.

How it works: Spotify's login opens in your normal browser, and Spotify sends the answer to
`http://127.0.0.1:43117/callback`. The app listens there only while a login is in progress, and only on your own
computer (`electron/spotifyLogin.ts`). It uses PKCE, so there's no client secret. If another program uses port 43117,
the app tells you.

**Building it in (for whoever publishes the app):** set a repository variable named `SPOTIFY_CLIENT_ID` (GitHub →
Settings → Secrets and variables → Actions → Variables) to your Spotify app's Client ID. Release builds then include it,
and people only click **Sign in with Spotify**. Client IDs aren't secret. Spotify still only lets the accounts listed
under User Management sign in, so others can paste their own Client ID via **Use a different Client ID**.

## Turn on Automix

Automix is a Spotify setting (Premium):

**Spotify → your profile picture → Settings → Playback → Automix** (or **Crossfade songs**).

Automix works on select Spotify playlists. When Spotify blends two songs, Lyrics Stage shows a small "Automix blend"
badge and crossfades the lyrics for exactly as long as the songs overlap.

## What you can do from the app

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Show what's playing | ✅ | ✅ | ✅ |
| Exact song position | ✅ | ✅ | ⚠️ estimated (see below) |
| Play / pause / next / previous | ✅ | ✅ | ✅ |
| Seek (click the bar or a lyric line) | ✅ | ✅ if Spotify allows it | ✅ |
| Search | opens in Spotify | opens in Spotify | opens in Spotify |
| Spotify volume (− / +) | ✅ | ✅ through Windows' Volume Mixer | ⚠️ depends on the Spotify version |
| Follow your phone or a speaker | with **Sign in with Spotify** | with **Sign in with Spotify** | with **Sign in with Spotify** |
| Automix / Crossfade blends | ✅ | ✅ | ✅ |

**Windows volume note:** Windows' media controls have no volume, so the volume buttons move Spotify's slider in
Windows' **Volume Mixer** (not the slider inside Spotify). The first press takes a second while a small helper starts.

**Linux note:** Spotify's Linux app doesn't share the song position (a
[long-standing Spotify limitation](https://community.spotify.com/t5/Desktop-Linux/MPRIS-properties-Volume-and-Position-are-not-populated/m-p/4476449/highlight/true)).
Lyrics Stage counts time from the start of each song instead. If you open the app in the middle of a song, or seek
inside Spotify, the timing will be off until the next song. To fix it right away, **click a lyric line** or the
progress bar: that seeks Spotify to a known spot, and the timing is exact again.

## How it connects to Spotify

The app never sees your Spotify password or account. It reads the same "now playing" information your operating system
already shows in its media controls:

| System | How | Where in the code |
| --- | --- | --- |
| macOS | Spotify's official AppleScript support (`osascript`) | `electron/bridge/mac.ts` |
| Windows | Windows media controls (System Media Transport Controls), through built-in PowerShell | `electron/bridge/windows.ts` |
| Linux | MPRIS over the D-Bus session bus | `electron/bridge/linux.ts` |

Each bridge sends a *snapshot* (song, playing or paused, position, time taken) about 4 times a second to the lyrics page
(`src/lib/desktopEngine.ts`). The page runs the same Automix detection as the web version.

Lyrics still come from [LRCLIB](https://lrclib.net), and the only other network requests are for fonts and album covers.
If the Spotify app doesn't share a song's cover (it sometimes doesn't on Windows), or the picture doesn't load, the app
looks it up with Apple's free [iTunes Search API](https://performance-partners.apple.com/search-api): first the song by
artist and title, then its album (`src/lib/cover.ts`).

On Windows, when the song changes, Spotify can leave the previous song's position and length in the media controls
for a moment. The app spots this (the timeline was last updated before the song changed) and counts from the song
change until Spotify catches up.

## Developing the app

```bash
npm run app:dev       # the app with live reload (edit the page and see changes immediately)
npm run app:start     # build and run, like the real app
npm run app:build     # make an installer for this computer in release/
```

**No Spotify on your dev machine (Linux)?** Run the fake Spotify. It appears on D-Bus exactly like the real Linux app,
position quirk included:

```bash
node scripts/fake-spotify.mjs    # terminal 1
npm run app:dev                  # terminal 2
```

It plays Yellow → Blinding Lights → Lover and switches 6 seconds before each song ends, like an Automix blend. Click
near the end of the progress bar to see a blend quickly.

The page also works in a normal browser with `?demo` for style work: `npm run dev`, then open
http://127.0.0.1:5173/?demo.

### Making installers for everyone

The **Build desktop app** GitHub Actions workflow (`.github/workflows/release.yml`) builds the macOS, Windows and Linux
installers:

- **Run it by hand** (Actions tab → Build desktop app → Run workflow) to download them as artifacts.
- **Publish a new version** (installed apps then update themselves):

  1. Change `"version"` in `package.json` (for example to `0.3.0`) and merge it.
  2. Tag that commit with the same version and push the tag:

     ```bash
     git tag v0.3.0 && git push origin v0.3.0
     ```

  The workflow stops early if the tag and `package.json` disagree, since installed apps compare versions.

Alongside the installers, each release carries small update files that the app reads (`electron/updater.ts`):
`latest.yml` (Windows), `latest-arm64.yml` (Windows on Arm), `latest-linux.yml` (AppImage) and `.blockmap` files, which
let the app download only the parts that changed. The app checks 10 seconds after it opens, then every 6 hours.

**Code signing (optional):** signing removes the security warnings. electron-builder signs automatically when the
certificates are provided as secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`, plus Apple notarization credentials for macOS).
See the [electron-builder code signing docs](https://www.electron.build/code-signing).

## Why not log in to Spotify inside the app?

We tried the obvious alternatives:

- **Spotify's web player inside the app:** Spotify's audio is protected with DRM (Widevine). Unsigned apps get license
  errors, so it doesn't play reliably.
- **The Spotify Web API:** that's the web version's approach. It needs you to create a developer app, and Spotify now
  limits those apps to 5 users.

Following the real Spotify app avoids both problems, and it's the only way to get Spotify's Automix.
