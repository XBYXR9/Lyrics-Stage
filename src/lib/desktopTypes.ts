// Messages between the desktop app's main process (which talks to the Spotify
// app on this computer) and the page that draws the lyrics.

/** Which music app the desktop app follows. */
export type MusicApp = 'spotify' | 'apple' | 'youtube';

export const MUSIC_APPS: MusicApp[] = ['spotify', 'apple', 'youtube'];

/** The name people know each app by. */
export const MUSIC_APP_LABEL: Record<MusicApp, string> = {
  spotify: 'Spotify',
  apple: 'Apple Music',
  youtube: 'YouTube Music',
};

export const isMusicApp = (v: unknown): v is MusicApp => typeof v === 'string' && (MUSIC_APPS as string[]).includes(v);

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

/**
 * "Sign in with Spotify" in the desktop app: Spotify sends the login back to
 * this address, where the app listens only while a login is in progress. It
 * must be added as a Redirect URI in the Spotify developer app.
 */
export const DESKTOP_REDIRECT_PORT = 43117;
export const DESKTOP_REDIRECT_URI = `http://127.0.0.1:${DESKTOP_REDIRECT_PORT}/callback`;

/** What came back from Spotify's login page (the code is swapped for tokens by the page). */
export interface SpotifyLoginResult {
  code?: string;
  state?: string;
  /** Spotify's error ("access_denied"), or ours: "timeout", "cancelled", "port_in_use", ... */
  error?: string;
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
  /** Opens the chosen music app (Apple Music, or YouTube Music in the browser), on its search page when `query` is given. */
  openMusicApp(app: MusicApp, query?: string): Promise<void>;
  /** Chooses which music app the desktop app follows. */
  setMusicApp(app: MusicApp): Promise<void>;
  setAlwaysOnTop(on: boolean): Promise<void>;
  /** The name of this computer (Spotify names the Spotify app on it the same, which is how the app finds its own device). */
  hostname(): Promise<string>;
  /** Windows: how the next "listen to the sound" request is answered, with the app's own page (default) or a screen source as the picture that goes with it. */
  setSoundSource(kind: 'frame' | 'screen'): Promise<void>;
  /** Current update status right away, then every change. Returns an unsubscribe function. */
  onUpdate(cb: (s: UpdateStatus) => void): () => void;
  /** Restarts into the downloaded update. */
  installUpdate(): Promise<void>;
  /** Opens Spotify's login page (`authUrl`) in the browser and waits for the answer. */
  signInWithSpotify(authUrl: string): Promise<SpotifyLoginResult>;
  /** Stops waiting for a login started with signInWithSpotify. */
  cancelSpotifyLogin(): Promise<void>;
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
