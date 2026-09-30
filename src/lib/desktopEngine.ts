// Engine for the desktop app: follows the Spotify app running on this
// computer (the one you're normally logged into). No Spotify developer
// account needed, and Spotify's own Automix and Crossfade just work, since
// the music plays in Spotify. We watch the timing to blend the lyrics.
//
// The desktop app's main process reads Spotify through the operating
// system (AppleScript on macOS, media controls on Windows, MPRIS on Linux)
// and sends snapshots here; see electron/bridge/.

import { findCover, type CoverQuery } from './cover';
import type { DesktopCommand, DesktopSnapshot, LyricsStageDesktopApi } from './desktopTypes';
import { BaseEngine, type DeviceInfo, type Engine, type SpotifyAppStatus } from './engine';
import type { TrackInfo } from './types';

export const SPOTIFY_APP_DEVICE: DeviceInfo = {
  id: 'spotify-app',
  name: 'Spotify app',
  type: 'Computer',
  isActive: true,
  isThisBrowser: false,
};

/** Turns what the Spotify app reports into the track shape the rest of the app uses. */
export function snapshotToTrack(s: DesktopSnapshot): TrackInfo | null {
  const t = s.track;
  if (!t || !t.title) return null;
  const id = t.uri?.startsWith('spotify:track:') ? t.uri.slice('spotify:track:'.length) : null;
  return {
    key: t.uri ?? `${t.title}|${t.artist}|${t.album}`,
    id,
    uri: t.uri ?? '',
    name: t.title,
    artists: t.artist ? [t.artist] : [],
    album: t.album,
    artUrl: t.artUrl,
    artThumbUrl: t.artUrl,
    durationMs: t.durationMs,
  };
}

const sameStatus = (a: SpotifyAppStatus | null, b: SpotifyAppStatus) =>
  !!a && a.running === b.running && a.problem === b.problem && a.exactPosition === b.exactPosition;

export class DesktopEngine extends BaseEngine implements Engine {
  readonly kind = 'desktop';
  readonly isDemo = false;
  readonly searchMode = 'external';
  private off: (() => void) | null = null;
  private api: LyricsStageDesktopApi;
  private waitTimer: ReturnType<typeof setTimeout> | undefined;
  private findCover: (q: CoverQuery) => Promise<string | null>;
  /** Covers we looked up ourselves, for songs the player gave no cover for. */
  private foundCovers = new Map<string, string>();
  private coverLookups = new Set<string>();

  constructor(api: LyricsStageDesktopApi, coverFinder: (q: CoverQuery) => Promise<string | null> = findCover) {
    super();
    this.api = api;
    this.findCover = coverFinder;
  }

  start() {
    if (this.off) return;
    this.off = this.api.onSnapshot((s) => this.ingest(s));
    // If nothing arrives, say so instead of spinning forever.
    this.waitTimer = setTimeout(() => {
      if (this.state.status === 'connecting') {
        this.update({ status: 'nothing', spotifyApp: { running: false, exactPosition: true } });
      }
    }, 6000);
  }

  stop() {
    this.off?.();
    this.off = null;
    clearTimeout(this.waitTimer);
  }

  /** Handles one snapshot from the Spotify app. Public for tests. */
  ingest(s: DesktopSnapshot) {
    const measuredAt = performance.now() - Math.max(0, Date.now() - s.at);
    const spotifyApp: SpotifyAppStatus = { running: s.running, problem: s.problem, exactPosition: s.positionMs !== null };
    const patch = () => {
      const p: Partial<typeof this.state> = {};
      if (!sameStatus(this.state.spotifyApp, spotifyApp)) p.spotifyApp = spotifyApp;
      if (this.state.problem !== (s.problem ?? null)) p.problem = s.problem ?? null;
      if (this.state.device !== SPOTIFY_APP_DEVICE) p.device = SPOTIFY_APP_DEVICE;
      return p;
    };

    const track = s.running ? snapshotToTrack(s) : null;
    if (!track) {
      // Spotify is closed or has nothing loaded: keep the last song on screen, paused.
      if (this.clock.playing) this.clock.set(this.clock.now(), false);
      const status = this.state.track ? 'paused' : 'nothing';
      this.update({ ...patch(), status, isPlaying: false });
      return;
    }

    // Cover: the player's own picture wins. Without one, use one we looked up.
    if (!track.artUrl) {
      const found = this.foundCovers.get(track.key);
      if (found) track.artUrl = track.artThumbUrl = found;
      else this.lookUpCover(track);
    }

    let positionMs = s.positionMs;
    if (positionMs === null) {
      // The Spotify app doesn't tell us the position (Linux), so count time
      // ourselves: a new song starts at 0, otherwise keep our own clock.
      const isNew = this.state.track?.key !== track.key;
      positionMs = isNew ? 0 : this.clock.now(measuredAt);
    }
    this.observe(track, positionMs, s.playing, measuredAt);
    const p = patch();
    // Same song, but its cover showed up a moment later (Windows often sends
    // the title first and the picture after): show it now.
    const current = this.state.track;
    if (current?.key === track.key && track.artUrl && current.artUrl !== track.artUrl) {
      p.track = { ...current, artUrl: track.artUrl, artThumbUrl: track.artUrl };
    }
    if (Object.keys(p).length) this.update(p);
  }

  /** Looks up a cover (once per song) when the player didn't provide one. */
  private lookUpCover(track: TrackInfo) {
    if (this.coverLookups.has(track.key)) return;
    this.coverLookups.add(track.key);
    void this.findCover({ name: track.name, artists: track.artists, album: track.album }).then((url) => {
      if (!url) return;
      this.foundCovers.set(track.key, url);
      const current = this.state.track;
      if (current?.key === track.key && !current.artUrl) {
        this.update({ track: { ...current, artUrl: url, artThumbUrl: url } });
      }
    });
  }

  private async send(c: DesktopCommand) {
    const res = await this.api.command(c);
    if (!res.ok) throw new Error(res.error ?? 'Spotify didn’t respond. Is the Spotify app open?');
  }

  async togglePlay() {
    const playing = !this.state.isPlaying;
    this.clock.set(this.clock.now(), playing);
    this.update({ isPlaying: playing, status: playing ? 'playing' : 'paused' });
    await this.send({ type: 'playpause' });
  }

  next() {
    return this.send({ type: 'next' });
  }

  previous() {
    return this.send({ type: 'previous' });
  }

  async seek(positionMs: number) {
    // Also how Linux users "sync" the lyrics, since we can't read the position there.
    this.clock.set(positionMs, this.clock.playing);
    await this.send({ type: 'seek', positionMs });
  }

  playTrack(uri: string) {
    return this.send({ type: 'openUri', uri });
  }

  async addToQueue() {
    throw new Error('Add songs to your queue in the Spotify app.');
  }

  /** Search happens in the Spotify app itself. */
  async search(query: string): Promise<TrackInfo[]> {
    await this.api.openSpotify(query.trim() || undefined);
    return [];
  }

  async listDevices() {
    return [SPOTIFY_APP_DEVICE];
  }

  async transferTo() {}

  async enableBrowserPlayer() {}

  openSpotify() {
    return this.api.openSpotify();
  }
}
