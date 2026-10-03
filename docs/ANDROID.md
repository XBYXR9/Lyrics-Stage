# Android app

Lyrics Stage also comes as an **Android app**: the same lyrics, styles and colors, in a phone-sized layout. It's the web
version inside a small Android shell ([Capacitor](https://capacitorjs.com/)), so everything you see on the web works
the same way.

## How it works

- **The Spotify app plays the music, Lyrics Stage shows the lyrics.** Spotify's own web player can't run inside an
  Android app, so Lyrics Stage can't play music itself. It follows whatever plays in the Spotify app on the **same
  phone** (or on any other device: your computer, a speaker). Put the two side by side on a tablet, use split-screen,
  or let the phone show the lyrics while the music plays somewhere else.
- **You sign in with Spotify.** It opens Spotify's login page in your phone's browser and brings you back to the app by
  itself, through a link of its own (`lyricsstage://callback`). Like the desktop app, you need a free Spotify developer
  app (a one-time setup), unless the release was built with a Client ID already in it.
- **The screen stays on while a song plays**, and the back button closes a panel before it leaves the app.
- **Automix and Crossfade work** like everywhere else: the lyrics blend with the music, and "Keep lyrics in time after
  a blend" is on. If one song is out of time, **Settings → Lyrics timing → Later / Earlier** nudges just that song.

## Install it

1. On your phone, open the [releases page](https://github.com/XBYXR9/Lyrics-Stage/releases) and download
   `Lyrics-Stage-<version>-android.apk` from the latest release.
2. Open the file. Android asks to allow installing apps from this source (your browser or Files app): allow it once,
   then tap **Install**. (It isn't on Google Play, so Android shows this warning for any app installed from a file.)
3. Open **Lyrics Stage** and follow the steps on the first screen.

**Updating:** download the new APK and install it over the old one. Your settings and login stay. There is no automatic
update, since the app isn't on Google Play.

## Set up Spotify (one time)

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and click **Create app** (any name).
2. Add this **Redirect URI**: `lyricsstage://callback`. Tick **Web API**, then save.
3. Under **User Management**, add the email of your Spotify account (new Spotify apps start in "Development mode").
4. Copy the app's **Client ID**, paste it into Lyrics Stage and tap **Sign in with Spotify**.

Controlling playback (play, pause, skip, seek) needs Spotify Premium. Showing lyrics doesn't.

## What's different from the desktop app

| | Android | Desktop app |
| --- | --- | --- |
| Follows the Spotify app on the same device | ✅ (through your Spotify login) | ✅ (no login needed) |
| Follows other devices | ✅ | ✅ with **Sign in with Spotify** |
| Needs a Spotify developer app | ✅ one time | only for sign-in |
| Beat flash and bars follow the real sound | ❌ (estimated rhythm) | ✅ on Windows |
| Updates itself | ❌ (install the new APK) | ✅ |

The bars and the beat flash use the **estimated rhythm** on Android. Android doesn't let one app listen to what another
app plays (and Spotify is one of the apps that can opt out), so there is no real-sound option there.

## Building it yourself

The Android app is built by the **Build desktop app** workflow (`.github/workflows/release.yml`, job `android`): it
builds the web app, copies it into the Android project (`android/`) with `npx cap sync android`, and runs Gradle.
Run the workflow by hand to get the APK as a downloadable artifact, or push a tag like `v0.6.0` to attach it to a
release. Locally you need Node 22, Java 21 and the Android SDK:

```
npm ci
npx vite build && npx cap sync android
cd android && ./gradlew assembleRelease -PappVersionName=0.6.0 -PappVersionCode=600
```

The APK ends up in `android/app/build/outputs/apk/release/`.

**Signing.** An APK has to be signed to install. By default it's signed with the key in `android/app/lyricsstage.keystore`
(a key that is stored in this repository), which keeps the signature the same from build to build so a new APK installs
over the old one. That's fine for installing on your own phone, but **anyone could sign a lookalike app with that key**,
so don't use it for anything you hand to the public (or Google Play). To sign with a private key, create a keystore and
set these repository secrets: `ANDROID_KEYSTORE_BASE64` (the file, base64), `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. The workflow then uses them. (Switching keys later means everyone has to
uninstall the app once before installing the new one.)

**Client ID.** Set the repository variable `SPOTIFY_CLIENT_ID` (as for the desktop app) and builds have it built in, so
people only tap "Sign in with Spotify". Client IDs aren't secret.

## How the login works (for developers)

`src/lib/nativeApp.ts` opens Spotify's authorize page with the Capacitor Browser plugin (a Chrome Custom Tab) and waits
for the `appUrlOpen` event that Android sends when the browser follows `lyricsstage://callback?code=…&state=…` (the
intent filter is in `android/app/src/main/AndroidManifest.xml`). The same PKCE code as the web and desktop versions then
swaps the code for tokens (`completeLogin` in `src/lib/auth.ts`). If Android closed the app while the browser was in
front, the answer link opens it from scratch and `finishLaunchLogin` finishes the login. Only that one exact link is
accepted as an answer (`parseLoginCallback`).
