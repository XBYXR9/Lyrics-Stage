// Lyrics Stage desktop app — main process.
//
// Opens the lyrics window and links it to the Spotify app on this computer
// (see bridge/). You stay logged in to Spotify the normal way; no Spotify
// developer account is needed, and Spotify's own Automix/Crossfade apply.
import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } from 'electron';
import path from 'node:path';
import { isMusicApp, validateCommand, type DesktopSnapshot, type MusicApp } from '../src/lib/desktopTypes';
import { createBridge } from './bridge';
import { mayHearSound, parseSoundSource, type SoundVideoSource } from './soundAccess';
import { cancelSpotifyLogin, signInWithSpotify } from './spotifyLogin';
import { startUpdates } from './updater';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
let musicApp: MusicApp = 'spotify';
let bridge = createBridge(process.platform, musicApp);
let win: BrowserWindow | null = null;
let lastSnapshot: DesktopSnapshot | null = null;

function isAppUrl(url: string) {
  return DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://');
}

function startBridge() {
  bridge.start((snapshot) => {
    lastSnapshot = snapshot;
    win?.webContents.send('ls:snapshot', snapshot);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 380,
    minHeight: 520,
    title: 'Lyrics Stage',
    backgroundColor: '#0b0b10',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Links open in the normal browser (or Spotify); the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.on('closed', () => (win = null));
}

ipcMain.handle('ls:last-snapshot', () => lastSnapshot);

ipcMain.handle('ls:command', async (_event, raw: unknown) => {
  const cmd = validateCommand(raw);
  if (!cmd) return { ok: false, error: 'Unknown command.' };
  try {
    const reply = await bridge.command(cmd);
    return { ok: true, ...(reply ?? {}) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('ls:open-spotify', async (_event, query: unknown) => {
  const q = typeof query === 'string' ? query.trim().slice(0, 200) : '';
  try {
    await shell.openExternal(q ? `spotify:search:${encodeURIComponent(q)}` : 'spotify:');
  } catch {
    await shell.openExternal(q ? `https://open.spotify.com/search/${encodeURIComponent(q)}` : 'https://open.spotify.com/');
  }
});

// Which music app to follow (Spotify, Apple Music or YouTube Music): the page asks for it when it opens and when it changes.
ipcMain.handle('ls:music-app', (_event, raw: unknown) => {
  if (!isMusicApp(raw) || raw === musicApp) return;
  musicApp = raw;
  bridge.stop();
  lastSnapshot = null;
  bridge = createBridge(process.platform, musicApp);
  startBridge();
});

/** Opens a music app: Apple Music through its own link, YouTube Music in the browser. */
ipcMain.handle('ls:open-music', async (_event, app: unknown, query: unknown) => {
  const q = typeof query === 'string' ? query.trim().slice(0, 200) : '';
  if (app === 'apple') {
    try {
      await shell.openExternal(q ? `music://music.apple.com/search?term=${encodeURIComponent(q)}` : 'music://');
    } catch {
      await shell.openExternal(q ? `https://music.apple.com/search?term=${encodeURIComponent(q)}` : 'https://music.apple.com/');
    }
  } else if (app === 'youtube') {
    await shell.openExternal(q ? `https://music.youtube.com/search?q=${encodeURIComponent(q)}` : 'https://music.youtube.com/');
  }
});

ipcMain.handle('ls:spotify-login', async (_event, authUrl: unknown) => {
  const result = await signInWithSpotify(authUrl, (url) => shell.openExternal(url));
  // Bring the app back to the front once the browser is done.
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  return result;
});

ipcMain.handle('ls:spotify-login-cancel', () => cancelSpotifyLogin());

// What goes along with the shared sound (see soundAccess.ts). The page asks for "screen" only if the first try fails.
let soundVideoSource: SoundVideoSource = 'frame';
ipcMain.handle('ls:sound-source', (_event, kind: unknown) => {
  soundVideoSource = parseSoundSource(kind);
});

ipcMain.handle('ls:always-on-top', (_event, on: unknown) => {
  win?.setAlwaysOnTop(on === true, 'floating');
});

app.whenReady().then(() => {
  // "Follow the real sound" (Windows, opt-in in Settings): when the lyrics page asks to
  // capture, hand it a copy of the sound going to the speakers and nothing else (the
  // "video" is just the app's own page, so the screen is never captured).
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const frame = request.frame;
    if (!frame || !mayHearSound(process.platform, frame.url, isAppUrl)) {
      callback({});
      return;
    }
    if (soundVideoSource !== 'screen') {
      callback({ video: frame, audio: 'loopback' });
      return;
    }
    // The second way: share the sound along with a screen source (its picture is dropped by the page at once).
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : { video: frame, audio: 'loopback' }))
      .catch(() => callback({ video: frame, audio: 'loopback' }));
  });
  createWindow();
  startUpdates(() => win);
  startBridge();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => bridge.stop());
