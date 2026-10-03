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
import { BaseEngine, clampVolume, type DeviceInfo, type Engine, type SpotifyAppStatus } from './engine';
import type { TrackInfo } from './types';

/** How long to wait before trying a cover lookup again for the same song. */
const COVER_RETRY_MS = 20_000;

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
  readonly canPlayHere = false;
  private off: (() => void) | null = null;
  private api: LyricsStageDesktopApi;
  private waitTimer: ReturnType<typeof setTimeout> | undefined;
  private findCover: (q: CoverQuery) => Promise<string | null>;
  /** Covers we looked up ourselves, for songs the player gave no cover for. */
  private foundCovers = new Map<string, string>();
  /** When we last looked up a cover for each song (a failed lookup is tried again later). */
  private coverLookups = new Map<string, number>();
  /** Cover pictures from the player that didn't load. */
  private brokenCovers = new Set<string>();

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
    this.cancelResync('stopped');
    this.off?.();
    this.off = null;
    clearTimeout(this.waitTimer);
  }

  // The re-sync (see BaseEngine): only where the Spotify app tells us the position (not Linux).
  protected canResync() {
    return this.state.spotifyApp?.exactPosition === true;
  }
  protected async sendPause() {
    await this.send({ type: 'pause' });
  }
  protected async sendResume() {
    await this.send({ type: 'play' });
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
      if (typeof s.volume === 'number' && s.volume !== this.state.volume && !this.volumeSettling()) p.volume = s.volume;
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

    // Cover: the player's own picture wins. Without one (or if it doesn't load), use one we looked up.
    if (track.artUrl && this.brokenCovers.has(track.artUrl)) track.artUrl = track.artThumbUrl = null;
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
    this.observe(track, positionMs, s.playing, measuredAt, s.positionMs !== null);
    const p = patch();
    // Same song, but its cover or length showed up a moment later (Windows
    // often sends the title first and the rest after): use them now. The
    // length matters for finding the right version of the lyrics.
    const current = this.state.track;
    if (current?.key === track.key) {
      const fix: Partial<TrackInfo> = {};
      if (track.artUrl && current.artUrl !== track.artUrl) fix.artUrl = fix.artThumbUrl = track.artUrl;
      if (Math.abs(current.durationMs - track.durationMs) > 1000) fix.durationMs = track.durationMs;
      if (Object.keys(fix).length) p.track = { ...current, ...fix };
    }
    if (Object.keys(p).length) this.update(p);
  }

  /** Looks up a cover when the player didn't provide one: once per song, again after a while if it failed (e.g. offline). */
  private lookUpCover(track: TrackInfo) {
    const last = this.coverLookups.get(track.key);
    if (last !== undefined && performance.now() - last < COVER_RETRY_MS) return;
    this.coverLookups.set(track.key, performance.now());
    void this.findCover({ name: track.name, artists: track.artists, album: track.album }).then((url) => {
      if (!url) return;
      this.foundCovers.set(track.key, url);
      const current = this.state.track;
      if (current?.key === track.key && (!current.artUrl || this.brokenCovers.has(current.artUrl))) {
        this.update({ track: { ...current, artUrl: url, artThumbUrl: url } });
      }
    });
  }

  coverFailed(url: string) {
    if (this.brokenCovers.has(url)) return;
    this.brokenCovers.add(url);
    const current = this.state.track;
    if (current?.artUrl !== url) return;
    const found = this.foundCovers.get(current.key);
    if (found && found !== url) this.update({ track: { ...current, artUrl: found, artThumbUrl: found } });
    else {
      this.update({ track: { ...current, artUrl: null, artThumbUrl: null } });
      this.coverLookups.delete(current.key);
      this.lookUpCover(current);
    }
  }

  private async send(c: DesktopCommand) {
    const res = await this.api.command(c);
    if (!res.ok) throw new Error(res.error ?? 'Spotify didn’t respond. Is the Spotify app open?');
    return res;
  }

  /** Just after a volume change, the player can still report the old level for a moment. */
  private volumeChangedAt = -Infinity;
  private volumeSettling() {
    return performance.now() - this.volumeChangedAt < 1500;
  }

  async changeVolume(delta: number) {
    const before = this.state.volume;
    if (before !== null) this.update({ volume: clampVolume(before + delta) });
    this.volumeChangedAt = performance.now();
    try {
      const res = await this.send({ type: 'volume', delta });
      if (typeof res.volume === 'number') this.update({ volume: clampVolume(res.volume) });
    } catch (err) {
      this.update({ volume: before });
      throw err;
    }
  }

  async togglePlay() {
    const playing = !this.state.isPlaying;
    this.clock.set(this.clock.now(), playing);
    this.update({ isPlaying: playing, status: playing ? 'playing' : 'paused' });
    await this.send({ type: 'playpause' });
  }

  async next() {
    await this.send({ type: 'next' });
  }

  async previous() {
    await this.send({ type: 'previous' });
  }

  async seek(positionMs: number) {
    // Also how Linux users "sync" the lyrics, since we can't read the position there.
    this.clock.set(positionMs, this.clock.playing);
    this.clearPositionBias();
    await this.send({ type: 'seek', positionMs });
  }

  async playTrack(uri: string) {
    await this.send({ type: 'openUri', uri });
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
