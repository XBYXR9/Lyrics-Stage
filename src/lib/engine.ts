// The playback "engine": keeps track of what Spotify is playing, where in the
// song we are, and how each song handed over to the next.
//
// Two sources feed it:
//  1. The Web API (/me/player), polled about once a second. This follows
//     playback on ANY device — your phone, the desktop app, a speaker — which
//     is where Spotify's Automix and Crossfade actually happen.
//  2. The Web Playback SDK, when you press "Play here" to use this browser tab
//     as the player. It reports position changes instantly.

import { getAccessToken } from './auth';
import { PlaybackClock, type Clock } from './clock';
import { loadSdk, sdkPosition, type SdkPlayer, type SdkState, type SdkTrack } from './sdk';
import { friendlyError, pickImages, spotify, SpotifyError, toTrackInfo, type ApiDevice, type ApiTrack } from './spotify';
import { BlendLearner, classifyTransition } from './transitions';
import type { TrackInfo, TransitionInfo } from './types';

export interface DeviceInfo {
  id: string | null;
  name: string;
  type: string;
  isActive: boolean;
  isThisBrowser: boolean;
}

export interface TrackChange {
  /** Increments on every song change. */
  seq: number;
  track: TrackInfo | null;
  previous: TrackInfo | null;
  transition: TransitionInfo;
  /** Keeps the previous song's position moving while its lyrics fade out. */
  ghost: Clock | null;
}

export type BrowserPlayerStatus = 'off' | 'loading' | 'ready' | 'error';

/** Only used by the desktop app: the Spotify app on this computer. */
export interface SpotifyAppStatus {
  /** Is the Spotify app open? */
  running: boolean;
  /** Something the user can fix (e.g. a macOS permission). */
  problem?: string;
  /** False when the Spotify app doesn't report song position (Linux), so we count time ourselves. */
  exactPosition: boolean;
}

export interface EngineState {
  status: 'connecting' | 'playing' | 'paused' | 'nothing' | 'ad';
  track: TrackInfo | null;
  isPlaying: boolean;
  device: DeviceInfo | null;
  nextTrack: TrackInfo | null;
  change: TrackChange;
  browserPlayer: { status: BrowserPlayerStatus; deviceId: string | null; message?: string };
  /** Typical Automix/Crossfade overlap we've seen, in ms. */
  typicalBlendMs: number | null;
  /** Set when the connection to Spotify is failing. */
  problem: string | null;
  /** Set when the login is no longer valid. */
  authExpired: boolean;
  /** Desktop app only: status of the linked Spotify app. */
  spotifyApp: SpotifyAppStatus | null;
  /** Spotify's volume (0–100), or null while we don't know it. */
  volume: number | null;
}

export type EngineKind = 'web-api' | 'desktop' | 'demo';

export interface Engine {
  /** Where playback info comes from: the Spotify Web API, the Spotify app on this computer, or the demo. */
  readonly kind: EngineKind;
  readonly isDemo: boolean;
  /** "results": search shows songs you can play here. "external": search opens in the Spotify app. */
  readonly searchMode: 'results' | 'external';
  /** Can this window itself play music (Spotify's Web Playback SDK, the "Play here" option)? */
  readonly canPlayHere: boolean;
  readonly clock: PlaybackClock;
  subscribe(listener: () => void): () => void;
  getState(): EngineState;
  start(): void;
  stop(): void;
  togglePlay(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  playTrack(uri: string): Promise<void>;
  addToQueue(uri: string): Promise<void>;
  search(query: string): Promise<TrackInfo[]>;
  listDevices(): Promise<DeviceInfo[]>;
  transferTo(deviceId: string): Promise<void>;
  enableBrowserPlayer(): Promise<void>;
  /** Turns Spotify up (+) or down (−) by this many percentage points. */
  changeVolume(delta: number): Promise<void>;
  /** The cover picture at this address didn't load; find another one if possible. */
  coverFailed?(url: string): void;
}

export const BROWSER_PLAYER_NAME = 'Lyrics Stage';
const REMEMBER_BROWSER_PLAYER = 'ls.browserPlayer';

export function initialEngineState(): EngineState {
  return {
    status: 'connecting',
    track: null,
    isPlaying: false,
    device: null,
    nextTrack: null,
    change: {
      seq: 0,
      track: null,
      previous: null,
      transition: { kind: 'initial', overlapMs: 0, startOffsetMs: 0 },
      ghost: null,
    },
    browserPlayer: { status: 'off', deviceId: null },
    typicalBlendMs: null,
    problem: null,
    authExpired: false,
    spotifyApp: null,
    volume: null,
  };
}

/** Keeps a volume within 0–100. */
export const clampVolume = (v: number) => Math.round(Math.min(100, Math.max(0, v)));

/** Shared bits for all engines: state, listeners and song-change detection. */
export abstract class BaseEngine {
  readonly clock = new PlaybackClock();
  protected state: EngineState = initialEngineState();
  private listeners = new Set<() => void>();
  protected lastReportAt = 0;
  protected lastChangeAt = 0;
  protected learner = new BlendLearner();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  protected update(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Called after a new song is detected (e.g. to look at the queue). */
  protected onTrackChanged(): void {}

  /**
   * Core logic shared by every source: is this a new song (and if so, how did
   * it hand over — skip, natural end, or an Automix/Crossfade blend?) or just
   * a position update?
   */
  protected observe(track: TrackInfo, positionMs: number, playing: boolean, measuredAt: number) {
    const prev = this.state.track;
    if (!prev || prev.key !== track.key) {
      const transition: TransitionInfo = prev
        ? classifyTransition({
            prevDurationMs: prev.durationMs,
            prevPositionMs: this.clock.raw(measuredAt),
            newPositionMs: positionMs,
            sinceLastReportMs: this.lastReportAt ? measuredAt - this.lastReportAt : 5000,
            wasPlaying: this.clock.playing,
          })
        : { kind: 'initial', overlapMs: 0, startOffsetMs: positionMs };
      this.learner.record(transition);
      const ghost = prev ? this.clock.fork(transition.kind === 'blend') : null;
      this.clock.set(positionMs, playing, measuredAt, track.durationMs);
      this.lastChangeAt = performance.now();
      this.update({
        track,
        status: playing ? 'playing' : 'paused',
        isPlaying: playing,
        nextTrack: null,
        typicalBlendMs: this.learner.typicalOverlapMs,
        change: { seq: this.state.change.seq + 1, track, previous: prev, transition, ghost },
      });
      this.onTrackChanged();
    } else {
      this.clock.durationMs = track.durationMs;
      this.clock.sync(positionMs, playing, measuredAt);
      if (this.state.isPlaying !== playing || this.state.status !== (playing ? 'playing' : 'paused')) {
        this.update({ isPlaying: playing, status: playing ? 'playing' : 'paused' });
      }
    }
    this.lastReportAt = measuredAt;
  }
}

function sdkTrackToInfo(t: SdkTrack): TrackInfo {
  const art = pickImages(t.album.images);
  return {
    key: t.id ?? t.uri,
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => a.name),
    album: t.album.name,
    artUrl: art.large,
    artThumbUrl: art.small,
    durationMs: t.duration_ms,
  };
}

function isApiTrack(item: unknown): item is ApiTrack {
  return !!item && typeof item === 'object' && 'uri' in item && String((item as ApiTrack).uri).startsWith('spotify:track:');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SpotifyEngine extends BaseEngine implements Engine {
  readonly kind = 'web-api';
  readonly isDemo = false;
  readonly searchMode = 'results';
  readonly canPlayHere: boolean;

  /**
   * `browserPlayer: false` in the desktop app: Spotify's in-page player needs
   * copy protection (DRM) that Electron doesn't include, so music plays in a
   * Spotify app (this computer, phone, speaker) and the window follows it.
   */
  constructor({ browserPlayer = true }: { browserPlayer?: boolean } = {}) {
    super();
    this.canPlayHere = browserPlayer;
  }
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = false;
  private pokeRequested = false;
  private failures = 0;

  protected onTrackChanged() {
    if (!this.sdkActive) void this.refreshQueue();
  }

  private player: SdkPlayer | null = null;
  /** True while this browser tab is the device Spotify is playing on. */
  private sdkActive = false;
  private sdkTimer: ReturnType<typeof setInterval> | undefined;
  private readyWaiters: ((id: string | null) => void)[] = [];

  start() {
    if (this.running) return;
    this.running = true;
    void this.poll();
    let remembered = false;
    try {
      remembered = localStorage.getItem(REMEMBER_BROWSER_PLAYER) === '1';
    } catch {
      /* ignore */
    }
    if (remembered && this.canPlayHere) void this.enableBrowserPlayer().catch(() => {});
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    clearInterval(this.sdkTimer);
    this.player?.disconnect();
    this.player = null;
  }

  // ---------------------------------------------------------------- polling

  private pokeSoon(ms = 350) {
    if (!this.running) return;
    if (this.inFlight) {
      this.pokeRequested = true;
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), ms);
  }

  private async poll() {
    if (!this.running) return;
    this.inFlight = true;
    let delay = 1000;
    try {
      const t0 = performance.now();
      const res = await spotify.getPlayer();
      const t1 = performance.now();
      this.ingestApi(res, (t0 + t1) / 2);
      this.failures = 0;
      if (this.state.problem) this.update({ problem: null });
      delay = this.nextDelay();
    } catch (err) {
      this.failures++;
      if (err instanceof SpotifyError && err.status === 401) {
        this.update({ authExpired: true, problem: friendlyError(err) });
        this.inFlight = false;
        return; // stop polling until the user logs in again
      }
      if (err instanceof SpotifyError && err.status === 429) delay = err.retryAfterMs ?? 5000;
      else delay = Math.min(15000, 1000 * 2 ** Math.min(this.failures, 4));
      if (this.failures >= 2) this.update({ problem: friendlyError(err) });
    }
    this.inFlight = false;
    if (!this.running) return;
    if (this.pokeRequested) {
      this.pokeRequested = false;
      delay = Math.min(delay, 350);
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), delay);
  }

  /** Poll faster when something interesting is about to happen. */
  private nextDelay(): number {
    const { track, isPlaying } = this.state;
    if (document.hidden) return 4000;
    if (!track || !isPlaying) return 2500;
    if (this.sdkActive) return 3000; // the SDK already gives exact positions
    const remaining = track.durationMs - this.clock.now();
    if (remaining < this.learner.watchWindowMs()) return 500; // an Automix blend may start any moment
    if (performance.now() - this.lastChangeAt < 4000) return 700; // settle the new song's position
    return 1000;
  }

  private ingestApi(res: Awaited<ReturnType<typeof spotify.getPlayer>>, measuredAt: number) {
    if (!res) {
      // 204: nothing is playing anywhere.
      if (!this.sdkActive) {
        this.clock.set(this.clock.now(), false);
        this.update({ status: this.state.track ? 'paused' : 'nothing', isPlaying: false, device: null });
      }
      return;
    }
    const device = this.mapDevice(res.device);
    if (this.sdkActive && device.isThisBrowser) {
      // The SDK is the better source for this device; only refresh device info.
      this.update({ device });
      return;
    }
    if (res.currently_playing_type === 'ad') {
      this.update({ status: 'ad', isPlaying: res.is_playing, device });
      return;
    }
    if (!res.item || !isApiTrack(res.item)) {
      this.clock.set(this.clock.now(), false);
      this.update({ status: 'nothing', isPlaying: false, device });
      return;
    }
    this.observe(toTrackInfo(res.item), res.progress_ms ?? 0, res.is_playing, measuredAt);
    this.update({ device, volume: this.volumeSettling() ? this.state.volume : res.device.volume_percent });
  }

  /** Just after a volume change, Spotify can still report the old level for a moment. */
  private volumeChangedAt = 0;
  private volumeSettling() {
    return performance.now() - this.volumeChangedAt < 3000;
  }

  async changeVolume(delta: number) {
    const before = this.state.volume;
    const volume = clampVolume((before ?? 50) + delta);
    this.volumeChangedAt = performance.now();
    this.update({ volume });
    try {
      if (this.sdkActive && this.player) await this.player.setVolume(volume / 100);
      else await spotify.volume(volume);
    } catch (err) {
      this.volumeChangedAt = 0;
      this.update({ volume: before });
      throw err;
    }
  }

  /** Look at the queue so the next song's lyrics & colors are ready before it starts. */
  private async refreshQueue() {
    try {
      const q = await spotify.getQueue();
      const next = q?.queue.find(isApiTrack);
      this.update({ nextTrack: next ? toTrackInfo(next) : null });
    } catch {
      /* not important */
    }
  }

  private mapDevice(d: ApiDevice): DeviceInfo {
    const isThisBrowser = !!d.id && d.id === this.state.browserPlayer.deviceId;
    return { id: d.id, name: d.name, type: d.type, isActive: d.is_active, isThisBrowser };
  }

  // ---------------------------------------------------------- browser player

  private enabling: Promise<void> | null = null;

  async enableBrowserPlayer() {
    if (!this.canPlayHere) throw new Error('Play music in a Spotify app (this computer, your phone or a speaker) and the lyrics follow along.');
    if (this.player) {
      await this.player.activateElement().catch(() => {});
      return;
    }
    // Only ever create one browser player, even if asked twice at once.
    this.enabling ??= this.createBrowserPlayer().finally(() => (this.enabling = null));
    return this.enabling;
  }

  private async createBrowserPlayer() {
    this.update({ browserPlayer: { status: 'loading', deviceId: null } });
    try {
      await loadSdk();
    } catch (err) {
      this.update({ browserPlayer: { status: 'error', deviceId: null, message: friendlyError(err) } });
      throw err;
    }
    const Player = window.Spotify!.Player;
    const player = new Player({
      name: BROWSER_PLAYER_NAME,
      volume: 0.8,
      getOAuthToken: (cb) => {
        void getAccessToken().then((t) => t && cb(t));
      },
    });
    this.player = player;

    const fail = (message: string) => {
      this.update({ browserPlayer: { status: 'error', deviceId: null, message } });
      this.flushReadyWaiters(null);
    };
    player.addListener('ready', ({ device_id }) => {
      this.update({ browserPlayer: { status: 'ready', deviceId: device_id } });
      this.flushReadyWaiters(device_id);
      try {
        localStorage.setItem(REMEMBER_BROWSER_PLAYER, '1');
      } catch {
        /* ignore */
      }
    });
    player.addListener('not_ready', () => {
      this.sdkActive = false;
      this.update({ browserPlayer: { status: 'loading', deviceId: null } });
    });
    player.addListener('initialization_error', ({ message }) =>
      fail(`This browser can't play Spotify here (${message}). Try Chrome, Edge or Firefox.`),
    );
    player.addListener('authentication_error', () => fail('Spotify login problem — please reconnect.'));
    player.addListener('account_error', () => fail('Playing inside the browser needs Spotify Premium.'));
    player.addListener('player_state_changed', (s) => this.ingestSdk(s));

    await player.activateElement().catch(() => {});
    const ok = await player.connect();
    if (!ok) fail('Could not connect the browser player.');

    clearInterval(this.sdkTimer);
    this.sdkTimer = setInterval(() => {
      if (!this.sdkActive || !this.player) return;
      void this.player.getCurrentState().then((s) => s && this.ingestSdk(s));
    }, 1000);
  }

  private flushReadyWaiters(id: string | null) {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    waiters.forEach((w) => w(id));
  }

  private waitForBrowserPlayer(timeoutMs = 10000): Promise<string | null> {
    const { status, deviceId } = this.state.browserPlayer;
    if (status === 'ready' && deviceId) return Promise.resolve(deviceId);
    if (status === 'error') return Promise.resolve(null);
    return new Promise((resolve) => {
      this.readyWaiters.push(resolve);
      setTimeout(() => resolve(this.state.browserPlayer.deviceId), timeoutMs);
    });
  }

  private ingestSdk(s: SdkState | null) {
    if (!s || !s.track_window.current_track) {
      // Playback moved to another device.
      if (this.sdkActive) {
        this.sdkActive = false;
        this.pokeSoon(200);
      }
      return;
    }
    this.sdkActive = true;
    const track = sdkTrackToInfo(s.track_window.current_track);
    this.observe(track, sdkPosition(s), !s.paused, performance.now());
    const nextRaw = s.track_window.next_tracks[0];
    const deviceId = this.state.browserPlayer.deviceId;
    this.update({
      nextTrack: nextRaw ? sdkTrackToInfo(nextRaw) : null,
      device: { id: deviceId, name: BROWSER_PLAYER_NAME, type: 'Computer', isActive: true, isThisBrowser: true },
    });
  }

  // --------------------------------------------------------------- controls

  async togglePlay() {
    const wasPlaying = this.state.isPlaying;
    this.clock.set(this.clock.now(), !wasPlaying);
    this.update({ isPlaying: !wasPlaying, status: !wasPlaying ? 'playing' : 'paused' });
    try {
      if (wasPlaying) await spotify.pause();
      else await this.playOrWakeBrowser(undefined);
    } catch (err) {
      this.clock.set(this.clock.now(), wasPlaying);
      this.update({ isPlaying: wasPlaying, status: wasPlaying ? 'playing' : 'paused' });
      throw err;
    } finally {
      this.pokeSoon();
    }
  }

  async next() {
    try {
      await spotify.next();
    } finally {
      this.pokeSoon(400);
    }
  }

  async previous() {
    try {
      await spotify.previous();
    } finally {
      this.pokeSoon(400);
    }
  }

  async seek(positionMs: number) {
    this.clock.set(positionMs, this.clock.playing);
    try {
      await spotify.seek(positionMs);
    } finally {
      this.pokeSoon(500);
    }
  }

  async playTrack(uri: string) {
    try {
      await this.playOrWakeBrowser({ uris: [uri] });
    } finally {
      this.pokeSoon(500);
    }
  }

  /**
   * Plays on the current device. If there isn't one, starts the browser player
   * and plays there instead.
   */
  private async playOrWakeBrowser(body: { uris: string[] } | undefined) {
    try {
      await spotify.play(body);
    } catch (err) {
      const noDevice = err instanceof SpotifyError && (err.status === 404 || err.reason === 'NO_ACTIVE_DEVICE');
      if (!noDevice) throw err;
      await this.enableBrowserPlayer();
      const id = await this.waitForBrowserPlayer();
      if (!id) throw err;
      try {
        await spotify.play(body, id);
      } catch {
        // A brand-new device can take a moment to show up on Spotify's side.
        await sleep(1200);
        await spotify.play(body, id);
      }
    }
  }

  async addToQueue(uri: string) {
    await spotify.queue(uri);
    void this.refreshQueue();
  }

  async search(query: string): Promise<TrackInfo[]> {
    if (!query.trim()) return [];
    const res = await spotify.search(query.trim());
    return (res?.tracks.items ?? []).filter(Boolean).map(toTrackInfo);
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const res = await spotify.getDevices();
    return (res?.devices ?? []).map((d) => this.mapDevice(d));
  }

  async transferTo(deviceId: string) {
    try {
      await spotify.transfer(deviceId, true);
    } finally {
      this.pokeSoon(600);
    }
  }
}
