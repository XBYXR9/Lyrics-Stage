import type { MusicApp } from '../../src/lib/desktopTypes';
import { LinuxBridge } from './linux';
import { MacBridge } from './mac';
import type { SpotifyBridge } from './types';
import { WindowsBridge } from './windows';

/** Picks the right way to talk to the music app (Spotify, Apple Music or YouTube Music) for this operating system. */
export function createBridge(platform: NodeJS.Platform, app: MusicApp = 'spotify'): SpotifyBridge {
  switch (platform) {
    case 'darwin':
      return new MacBridge(app);
    case 'win32':
      return new WindowsBridge(app);
    default:
      return new LinuxBridge(app);
  }
}
