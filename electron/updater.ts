// Keeps the desktop app up to date from GitHub Releases.
//
// Windows and the Linux AppImage download a new version in the background
// (electron-updater) and install it when the app restarts or quits; the page
// shows an "Update ready · Restart" button. On macOS and for Linux .deb
// installs the app can't replace itself, so it just says a new version is out
// and links to the download page. See updateCheck.ts.
import { app, ipcMain, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../src/lib/desktopTypes';
import { isNewerVersion, parseLatestRelease, RELEASES, updateChannel, updateMode } from './updateCheck';

/** First check shortly after launch (so it doesn't slow down startup), then every few hours. */
const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let status: UpdateStatus = { state: 'none' };

export function startUpdates(getWindow: () => BrowserWindow | null) {
  const publish = (next: UpdateStatus) => {
    status = next;
    getWindow()?.webContents.send('ls:update', status);
  };
  ipcMain.handle('ls:update-status', () => status);
  ipcMain.handle('ls:update-install', () => {
    // Quietly run the downloaded installer, then open the new version.
    if (status.state === 'ready') autoUpdater.quitAndInstall(true, true);
  });

  if (!app.isPackaged) return; // nothing to update while developing
  const check = updateMode(process.platform, process.env.APPIMAGE) === 'auto' ? autoUpdates(publish) : releaseNotice(publish);
  setTimeout(() => {
    void check();
    setInterval(() => void check(), CHECK_EVERY_MS);
  }, FIRST_CHECK_MS);
}

function autoUpdates(publish: (s: UpdateStatus) => void) {
  const channel = updateChannel(process.platform, process.arch);
  if (channel) {
    autoUpdater.channel = channel;
    autoUpdater.allowDowngrade = false; // setting a channel turns this on; we never want to go back a version
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => publish({ state: 'downloading', version: info.version }));
  autoUpdater.on('update-downloaded', (info) => publish({ state: 'ready', version: info.version }));
  // Offline, GitHub busy, or a release without update files: try again at the next check.
  autoUpdater.on('error', (err) => console.warn('Update check failed:', err instanceof Error ? err.message : err));
  return async () => {
    if (status.state === 'ready') return;
    await autoUpdater.checkForUpdates().catch(() => {}); // already reported through 'error'
  };
}

function releaseNotice(publish: (s: UpdateStatus) => void) {
  return async () => {
    try {
      const res = await fetch(`https://api.github.com/repos/${RELEASES.owner}/${RELEASES.repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Lyrics-Stage' },
      });
      if (!res.ok) return;
      const latest = parseLatestRelease(await res.json());
      if (latest && isNewerVersion(latest.version, app.getVersion())) {
        publish({ state: 'available', version: latest.version, url: latest.url });
      }
    } catch (err) {
      console.warn('Update check failed:', err instanceof Error ? err.message : err);
    }
  };
}
