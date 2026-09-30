import { LinuxBridge } from './linux';
import { MacBridge } from './mac';
import type { SpotifyBridge } from './types';
import { WindowsBridge } from './windows';

/** Picks the right way to talk to the Spotify app for this operating system. */
export function createBridge(platform: NodeJS.Platform): SpotifyBridge {
  switch (platform) {
    case 'darwin':
      return new MacBridge();
    case 'win32':
      return new WindowsBridge();
    default:
      return new LinuxBridge();
  }
}
