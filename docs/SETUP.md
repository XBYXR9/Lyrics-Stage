# Setup guide (web version)

> **Using the desktop app?** You don't need any of this. The desktop app follows the Spotify app directly; see
> [DESKTOP_APP.md](DESKTOP_APP.md).

This guide gets the **web version** of Lyrics Stage running in your browser. It uses the Spotify Web API, which needs
a (free) Spotify developer app. Setup takes about 5 minutes.

## 1. Install and start

You need [Node.js](https://nodejs.org) version 20.19 or newer.

```bash
git clone https://github.com/xbyxr9/spotifylyrics.git
cd spotifylyrics
npm install
npm run dev
```

Open **http://127.0.0.1:5173** in Chrome, Edge, Firefox or Safari.

> Use `127.0.0.1`, not `localhost`. Spotify doesn't accept `localhost` as a login address, so the site automatically
> switches you to `127.0.0.1`.

## 2. Create a Spotify app (free)

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in with your Spotify
   account.
2. Click **Create app**.
3. Fill in:
   - **App name / description**: anything, for example "Lyrics Stage".
   - **Redirect URI**: `http://127.0.0.1:5173/callback`. Click **Add**.
   - **Which API/SDKs are you planning to use?**: tick **Web API** and **Web Playback SDK**.
4. Accept the terms and click **Save**.
5. Open the app's **Settings** and copy the **Client ID** (32 letters and numbers).

You don't need the Client Secret. The site uses Spotify's PKCE login, which works without one.

## 3. Add yourself as a user

New Spotify apps start in **Development mode**. Only accounts you list can use the app:

1. In your app on the dashboard, open **User Management**.
2. Add the name and email of each Spotify account that will use Lyrics Stage (up to 5).

Spotify also requires the app owner to have Premium.

## 4. Connect

Back on http://127.0.0.1:5173, paste the Client ID and click **Connect Spotify**. After you allow access, you're back on
the site.

**Optional:** to skip pasting the Client ID, copy `.env.example` to `.env` and fill in `VITE_SPOTIFY_CLIENT_ID`.

## Playing music

- **On your phone or the desktop app** (recommended for Automix): just play music there. The site follows along.
- **In the browser**: open the device menu under the player and choose **Play here**. This uses Spotify's Web Playback
  SDK and needs Premium.
- **Search**: press `/`, type a song, and press Enter to play the top result.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Spotify says **"INVALID_CLIENT: Invalid redirect URI"** | The redirect URI in the dashboard must be exactly `http://127.0.0.1:5173/callback`. Also make sure nothing else is using port 5173. |
| **"User not registered in the Developer Dashboard"** or a 403 error | Add your account under **User Management** (step 3). |
| Play, pause or skip does nothing / "needs Premium" | Spotify only allows playback control for Premium accounts. You can still watch lyrics for music you control in the Spotify app. |
| "No active Spotify device" | Open Spotify on any device and play something, or use **Play here**. |
| "Play here" fails | Browser playback needs Premium and a browser that supports protected media (Chrome, Edge, Firefox, Safari). In Firefox, allow DRM content when asked. |
| Lyrics are a bit early or late | Settings → **Lyrics timing**, or press `[` / `]`. Bluetooth headphones usually need +0.2 s to +0.4 s. |
| "No lyrics for this one" | LRCLIB doesn't have the song yet. You can add it at [lrclib.net](https://lrclib.net). |
| The page asks you to reconnect | Your login expired or was revoked. Click **Reconnect Spotify**. |

## Sharing it with friends

The site is meant to run on your own computer (`127.0.0.1`). To host it on a real domain, add that domain's
`https://…/callback` address as another redirect URI in the dashboard, run `npm run build`, and host the `dist/` folder
as a single-page app (every path should serve `index.html`). Remember the 5-user limit in Development mode.
