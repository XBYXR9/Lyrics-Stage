// Gives the lyrics page a small, safe API (`window.lyricsStage`) to talk to
// the main process. The page gets no other access to the computer.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { CommandResult, DesktopCommand, DesktopSnapshot, LyricsStageDesktopApi, UpdateStatus } from '../src/lib/desktopTypes';

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
  setAlwaysOnTop: (on: boolean) => ipcRenderer.invoke('ls:always-on-top', on),
  onUpdate(cb) {
    const listener = (_e: IpcRendererEvent, s: UpdateStatus) => cb(s);
    ipcRenderer.on('ls:update', listener);
    void ipcRenderer.invoke('ls:update-status').then((s: UpdateStatus) => cb(s));
    return () => ipcRenderer.removeListener('ls:update', listener);
  },
  installUpdate: () => ipcRenderer.invoke('ls:update-install'),
};

contextBridge.exposeInMainWorld('lyricsStage', api);
