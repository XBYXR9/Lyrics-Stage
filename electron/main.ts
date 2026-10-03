// Lyrics Stage desktop app — main process.
//
// Opens the lyrics window and links it to the Spotify app on this computer
// (see bridge/). You stay logged in to Spotify the normal way; no Spotify
// developer account is needed, and Spotify's own Automix/Crossfade apply.
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { validateCommand, type DesktopSnapshot } from '../src/lib/desktopTypes';
import { createBridge } from './bridge';
import { cancelSpotifyLogin, signInWithSpotify } from './spotifyLogin';
import { startUpdates } from './updater';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const bridge = createBridge(process.platform);
let win: BrowserWindow | null = null;
let lastSnapshot: DesktopSnapshot | null = null;

function isAppUrl(url: string) {
  return DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://');
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

ipcMain.handle('ls:always-on-top', (_event, on: unknown) => {
  win?.setAlwaysOnTop(on === true, 'floating');
});

app.whenReady().then(() => {
  createWindow();
  startUpdates(() => win);
  bridge.start((snapshot) => {
    lastSnapshot = snapshot;
    win?.webContents.send('ls:snapshot', snapshot);
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => bridge.stop());
