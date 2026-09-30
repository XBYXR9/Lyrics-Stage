import type { DesktopCommand, DesktopSnapshot } from '../../src/lib/desktopTypes';

/**
 * Connects to the Spotify app on this computer through the operating system.
 * One implementation per platform (macOS, Windows, Linux).
 */
export interface SpotifyBridge {
  start(onSnapshot: (s: DesktopSnapshot) => void): void;
  stop(): void;
  /** Throws a plain-language error if Spotify didn't accept the command. */
  command(c: DesktopCommand): Promise<void>;
}

export type { DesktopCommand, DesktopSnapshot };
