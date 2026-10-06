// Gives the lyrics page a small, safe API (`window.lyricsStage`) to talk to
// the main process. The page gets no other access to the computer.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { CommandResult, DesktopCommand, DesktopSnapshot, LyricsStageDesktopApi, MusicApp, SpotifyLoginResult, UpdateStatus } from '../src/lib/desktopTypes';

const api: LyricsStageDesktopApi = {
  isDesktop: true,
  platform: process.platform,
  version: process.env.npm_package_version ?? '',
  onSnapshot(cb) {
    const listener = (_e: IpcRendererEvent, s: DesktopSnapshot) => cb(s);
    ipcRenderer.on('ls:snapshot', listener);
    void ipcRenderer.invoke('ls:last-snapshot').then((s: DesktopSnapshot | null) => s && cb(s));
    return () => ipcRenderer.removeListener('ls:snapshot', listener);
  },
  command: (c: DesktopCommand) => ipcRenderer.invoke('ls:command', c) as Promise<CommandResult>,
  openSpotify: (query?: string) => ipcRenderer.invoke('ls:open-spotify', query),
  openMusicApp: (app: MusicApp, query?: string) => ipcRenderer.invoke('ls:open-music', app, query),
  setMusicApp: (app: MusicApp) => ipcRenderer.invoke('ls:music-app', app),
  setAlwaysOnTop: (on: boolean) => ipcRenderer.invoke('ls:always-on-top', on),
  setSoundSource: (kind: 'frame' | 'screen') => ipcRenderer.invoke('ls:sound-source', kind),
  onUpdate(cb) {
    const listener = (_e: IpcRendererEvent, s: UpdateStatus) => cb(s);
    ipcRenderer.on('ls:update', listener);
    void ipcRenderer.invoke('ls:update-status').then((s: UpdateStatus) => cb(s));
    return () => ipcRenderer.removeListener('ls:update', listener);
  },
  installUpdate: () => ipcRenderer.invoke('ls:update-install'),
  signInWithSpotify: (authUrl: string) => ipcRenderer.invoke('ls:spotify-login', authUrl) as Promise<SpotifyLoginResult>,
  cancelSpotifyLogin: () => ipcRenderer.invoke('ls:spotify-login-cancel'),
};

contextBridge.exposeInMainWorld('lyricsStage', api);
