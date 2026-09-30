// Messages between the desktop app's main process (which talks to the Spotify
// app on this computer) and the page that draws the lyrics.

export interface DesktopTrack {
  /** "spotify:track:…" when the Spotify app tells us (macOS, Linux). */
  uri: string | null;
  title: string;
  /** All artists as Spotify shows them, e.g. "Artist A, Artist B". */
  artist: string;
  album: string;
  durationMs: number;
  /** https:// or data: URL of the cover, when available. */
  artUrl: string | null;
}

export interface DesktopSnapshot {
  /** Which system interface the info came from. */
  source: 'applescript' | 'smtc' | 'mpris';
  /** Is the Spotify app open? */
  running: boolean;
  playing: boolean;
  track: DesktopTrack | null;
  /**
   * Song position in ms at time `at`. `null` when the Spotify app doesn't
   * report it (the Linux app doesn't), so the page counts time itself.
   */
  positionMs: number | null;
  /** When this snapshot was taken (epoch ms, from Date.now()). */
  at: number;
  /** Can we seek through the system interface? */
  canSeek: boolean;
  /** A problem the user can fix, in plain words. */
  problem?: string;
  /** Spotify's volume (0–100), when the system interface reports it (macOS, Linux). */
  volume?: number | null;
}

export type DesktopCommand =
  | { type: 'playpause' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
  | { type: 'openUri'; uri: string }
  /** Turn Spotify up (+) or down (−) by this many percentage points. */
  | { type: 'volume'; delta: number };

export interface CommandResult {
  ok: boolean;
  error?: string;
  /** Spotify's volume (0–100) after a volume command, when known. */
  volume?: number;
}

/** Where the desktop app's own update stands. */
export type UpdateStatus =
  | { state: 'none' }
  /** Downloading a new version in the background (Windows, Linux AppImage). */
  | { state: 'downloading'; version: string }
  /** Downloaded: installs on restart (or when the app quits). */
  | { state: 'ready'; version: string }
  /** A new version is out, but this system can't install it by itself (macOS, Linux .deb): download page. */
  | { state: 'available'; version: string; url: string };

/** What the desktop app's preload script exposes as `window.lyricsStage`. */
export interface LyricsStageDesktopApi {
  readonly isDesktop: true;
  readonly platform: string;
  readonly version: string;
  /** Latest snapshot right away (if any), then every update. Returns an unsubscribe function. */
  onSnapshot(cb: (s: DesktopSnapshot) => void): () => void;
  command(c: DesktopCommand): Promise<CommandResult>;
  /** Opens the Spotify app — on its search page when `query` is given. */
  openSpotify(query?: string): Promise<void>;
  setAlwaysOnTop(on: boolean): Promise<void>;
  /** Current update status right away, then every change. Returns an unsubscribe function. */
  onUpdate(cb: (s: UpdateStatus) => void): () => void;
  /** Restarts into the downloaded update. */
  installUpdate(): Promise<void>;
}

/** Only Spotify URIs may be sent to the Spotify app (checked in both processes). */
export const SPOTIFY_URI_RE = /^spotify:(track|album|playlist|artist|show|episode):[A-Za-z0-9]{10,40}$/;

/** Checks and cleans a command that came from the page before acting on it. */
export function validateCommand(c: unknown): DesktopCommand | null {
  if (!c || typeof c !== 'object') return null;
  const cmd = c as Record<string, unknown>;
  switch (cmd.type) {
    case 'playpause':
    case 'play':
    case 'pause':
    case 'next':
    case 'previous':
      return { type: cmd.type };
    case 'seek': {
      const ms = Number(cmd.positionMs);
      return Number.isFinite(ms) && ms >= 0 && ms < 24 * 3600e3 ? { type: 'seek', positionMs: Math.round(ms) } : null;
    }
    case 'openUri':
      return typeof cmd.uri === 'string' && SPOTIFY_URI_RE.test(cmd.uri) ? { type: 'openUri', uri: cmd.uri } : null;
    case 'volume': {
      const delta = Number(cmd.delta);
      return Number.isFinite(delta) && Math.abs(delta) <= 100 ? { type: 'volume', delta: Math.round(delta) } : null;
    }
    default:
      return null;
  }
}

declare global {
  interface Window {
    lyricsStage?: LyricsStageDesktopApi;
  }
}

export const desktopApi = (): LyricsStageDesktopApi | null =>
  typeof window !== 'undefined' && window.lyricsStage?.isDesktop ? window.lyricsStage : null;
