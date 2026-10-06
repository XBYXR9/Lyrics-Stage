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
import { canPlayProtectedAudio } from './drm';
import { isNativeApp } from './nativeApp';
import { desktopApi, type LyricsStageDesktopApi } from './desktopTypes';
import { localIsPlaying, type LocalSnapshot } from './localPlayer';
import { isRefusal, loadProbeMemory, PROBE_REFRESH_MIN_MS, ProbeMemory, saveProbeMemory, type SilentProbe } from './silentProbes';
import { loadSdk, sdkPosition, type SdkPlayer, type SdkState, type SdkTrack } from './sdk';
import { friendlyError, pickImages, spotify, SpotifyError, toTrackInfo, type ApiDevice, type ApiTrack } from './spotify';
import { isWatchingTiming, logTiming, sec, signedSec, watchTiming } from './timingLog';
import { BlendBiasLearner, loadBiasSamples, ruleValue, saveBiasSamples } from './blendBias';
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
  /** Shuffle is on. */
  shuffle: boolean;
  /** Repeat: off, the playlist or album again, or the song again. */
  repeat: RepeatMode;
}

export type RepeatMode = 'off' | 'context' | 'track';

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
  /** Plays a playlist or album (`firstUri`: start with this song of it). */
  playContext(contextUri: string, firstUri?: string): Promise<void>;
  /** Plays these songs in order, starting with the one at `startIndex`. */
  playUris(uris: string[], startIndex?: number): Promise<void>;
  setShuffle(on: boolean): Promise<void>;
  setRepeat(mode: RepeatMode): Promise<void>;
  /** The songs coming up next, in order. */
  queueList(): Promise<TrackInfo[]>;
  addToQueue(uri: string): Promise<void>;
  search(query: string): Promise<TrackInfo[]>;
  listDevices(): Promise<DeviceInfo[]>;
  transferTo(deviceId: string): Promise<void>;
  enableBrowserPlayer(): Promise<void>;
  /** Turns Spotify up (+) or down (−) by this many percentage points. */
  changeVolume(delta: number): Promise<void>;
  /** The cover picture at this address didn't load; find another one if possible. */
  coverFailed?(url: string): void;
  /** Take the blend length off the song position Spotify reports after an Automix or Crossfade hand-over (see BaseEngine). */
  setBlendTimingFix(on: boolean): void;
  /** After a blend, pause and resume the music for a split second so Spotify reports the right position again (see BaseEngine). */
  setResyncAfterBlend(on: boolean): void;
  /** What the app has learned about Spotify's position after blends, for the timing report. */
  describeBlendBias(): string;
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
    shuffle: false,
    repeat: 'off',
  };
}

/** Keeps a volume within 0–100. */
export const clampVolume = (v: number) => Math.round(Math.min(100, Math.max(0, v)));

/** How long after a song change a report of the song just left can still be a stale one (blends last up to 12 s). */
const STALE_REPORT_WINDOW_MS = 14_000;
/**
 * A report of the song just left counts as stale if it puts that song where it was when it was left, or later (not
 * more than this earlier): a stale answer may show a frozen position or one that kept counting. A song that really
 * starts again (pressing "previous") starts from its beginning, far earlier than that.
 */
const STALE_REPORT_TOLERANCE_MS = 4000;

/**
 * The first answers about a new song can be stale: the very first one may still show where the song started (a real
 * report: 21.1 s while the Spotify app on the same PC said 25.5 s), and the next one then catches up. That is not Spotify
 * refreshing itself or somebody seeking, so for this long after a song change a step forward in the reports is ignored.
 */
const CHANGE_SETTLE_MS = 4000;
/** A jump of this much (forward or back) in what Spotify reports is a seek. */
const SEEK_JUMP_MS = 2500;
/**
 * Spotify refreshing its state shows as the reported position stepping back by about the error we take off (the real
 * ones were 0.4 to 1.4 s), and never by less than this, which is more than the jitter of the reports (about 0.2 s).
 * A step forward is not a refresh.
 */
const REFRESH_STEP_BACK_MS = 450;

/** How long after a blend to re-sync: the songs are no longer overlapping, and the new song's lyrics are about to start. */
const RESYNC_DELAY_MS = 6000;
/** Not worth a pause right before the song ends. */
const RESYNC_MIN_REMAINING_MS = 15_000;
/**
 * How long to wait after the music resumed before looking at the position: Spotify's server can answer with its
 * old state for a moment, and only the report after it has settled shows the refreshed position.
 */
const RESYNC_SETTLE_MS = 2000;
/** How much longer to wait for that report. */
const RESYNC_REPORT_TIMEOUT_MS = 3000;
/** A measured error beyond these can't be trusted (something else changed the position meanwhile). */
const RESYNC_MAX_AHEAD_MS = 30_000;
const RESYNC_MAX_BEHIND_MS = 15_000;

/** What an engine knows about its last position report. */
interface Report {
  pos: number;
  at: number;
  playing: boolean;
}

/** Shared bits for all engines: state, listeners and song-change detection. */
export abstract class BaseEngine {
  abstract readonly kind: EngineKind;
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
   * After Spotify moves on by itself with Crossfade or Automix, the position it
   * reports for the new song is ahead by the length of the blend, until the
   * next pause, resume or seek refreshes it (a known Spotify quirk, also seen
   * through AppleScript). Left alone, the lyrics run early for the rest of the
   * song. This is that amount, taken off every report; see observe().
   */
  private positionBiasMs = 0;
  private fixBlendTiming = true;
  /**
   * The song we just left and where it was, so a stale report of it, which Spotify can send between reports of the
   * new song while it mixes, isn't taken for a change back to it.
   */
  private lastLeft: { key: string; name: string; pos: number; at: number; durationMs: number } | null = null;
  /** The last position Spotify reported, to notice when it corrects itself. */
  private lastReport: Report | null = null;

  setBlendTimingFix(on: boolean) {
    this.fixBlendTiming = on;
    if (!on) this.positionBiasMs = 0;
  }

  // ------------------------------------------------------------- re-sync

  /**
   * Spotify's own apps have the same problem: after a blend the position of the new song stays wrong until Spotify
   * refreshes it, and pausing and resuming (or seeking) does exactly that. By how much it is wrong isn't known and
   * differs between setups, so a few seconds after a blend the app pauses and resumes the music for a split second,
   * gets the right position, and learns the difference (see blendBias.ts). Once a way of guessing it has been right
   * a few times in a row, the music is left alone and the guess is used.
   */
  private resyncEnabled = true;
  private resyncTimer: ReturnType<typeof setTimeout> | undefined;
  private resyncPlan: { key: string; first: number; old: number } | null = null;
  private resyncing = false;
  private reportWaiters: ((r: Report) => void)[] = [];
  protected biasLearner = new BlendBiasLearner(loadBiasSamples(), saveBiasSamples);
  protected probeMemory = new ProbeMemory(loadProbeMemory(), saveProbeMemory);

  setResyncAfterBlend(on: boolean) {
    this.resyncEnabled = on;
    if (!on) this.cancelResync('switched off');
  }

  describeBlendBias() {
    return `${this.resyncEnabled ? 'on' : 'off'} ${this.biasLearner.describe()} ${this.probeMemory.describe()}`;
  }

  /** Can the music be paused and resumed from here, with positions we can believe? Engines turn it on. */
  protected canResync(): boolean {
    return false;
  }
  protected async sendPause(): Promise<void> {
    throw new Error('not supported');
  }
  protected async sendResume(): Promise<void> {
    throw new Error('not supported');
  }
  /** Ask for a fresh report soon (the Web API is only asked about once a second). */
  protected askForReport(): void {}
  /** Quiet ways to make Spotify refresh the position, without pausing (see silentProbes.ts). */
  protected silentProbes(): SilentProbe[] {
    return [];
  }
  /** For the timing report: how the music was paused (e.g. through the Spotify app on this computer). */
  protected resyncPath(): string {
    return '';
  }
  /** The re-sync can't work from here (e.g. Spotify said no): stop trying. */
  protected resyncBlocked = false;

  protected cancelResync(why: string) {
    clearTimeout(this.resyncTimer);
    if (this.resyncPlan) logTiming(`re-sync cancelled: ${why}`);
    this.resyncPlan = null;
  }

  private scheduleResync(key: string, transition: TransitionInfo, reported: boolean) {
    this.cancelResync('another song change');
    if (!this.resyncEnabled || !reported || transition.kind !== 'blend' || this.resyncBlocked || !this.canResync()) return;
    // A quiet way that works costs the listener nothing, so it is used on every blend. Pausing is measured only
    // until the error can be guessed.
    const works = this.probeMemory.works;
    const quiet = works !== null && this.silentProbes().some((p) => p.id === works);
    if (!quiet && this.biasLearner.plan() === 'trust') {
      logTiming(`re-sync skipped: the error is guessed well enough lately (${this.biasLearner.describe()})`);
      return;
    }
    this.resyncPlan = { key, first: transition.startOffsetMs, old: transition.overlapMs };
    this.resyncTimer = setTimeout(() => void this.resync(), RESYNC_DELAY_MS);
  }

  private nextReport(after: number, timeoutMs: number): Promise<Report | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.reportWaiters = this.reportWaiters.filter((w) => w !== waiter);
        resolve(null);
      }, timeoutMs);
      const waiter = (r: Report) => {
        if (!r.playing || r.at <= after) {
          this.reportWaiters.push(waiter);
          return;
        }
        clearTimeout(timer);
        resolve(r);
      };
      this.reportWaiters.push(waiter);
    });
  }

  /**
   * Does `act` (which refreshes Spotify's position somehow), waits for Spotify's server to settle, and works out
   * how far off the reported position was: where the earlier reports said the song would be by now, less the time
   * the music was silent (`act` returns it), against where Spotify says it is.
   */
  private async refreshAndMeasure(before: Report, act: () => Promise<number>): Promise<{ b: number } | null> {
    const silentMs = await act();
    const doneAt = performance.now();
    this.askForReport();
    const report = await this.nextReport(doneAt + RESYNC_SETTLE_MS, RESYNC_SETTLE_MS + RESYNC_REPORT_TIMEOUT_MS);
    if (!report) return null;
    const expected = before.pos + (report.at - before.at);
    return { b: Math.round(expected - silentMs - report.pos) };
  }

  /** Writes down what a re-sync measured, and learns from it. */
  private learnFrom(plan: { first: number; old: number }, b: number, how: string) {
    const rule = this.biasLearner.trustedRule();
    logTiming(
      `RE-SYNC measured error=${signedSec(b)}s ${how} (guessed first-report=${sec(plan.first)}s, old-song=${sec(plan.old)}s; trusted before: ${rule ?? 'none'})`,
    );
    if (b > RESYNC_MAX_AHEAD_MS || b < -RESYNC_MAX_BEHIND_MS) return logTiming('re-sync: that does not look right, not learning from it');
    this.biasLearner.record({ b, first: plan.first, old: plan.old });
    logTiming(`learned: ${this.biasLearner.describe()}`);
  }

  private async resync() {
    const plan = this.resyncPlan;
    this.resyncPlan = null;
    if (!plan || this.resyncing) return;
    const track = this.state.track;
    const skip = (why: string) => logTiming(`re-sync skipped: ${why}`);
    const ready = () => {
      if (!this.resyncEnabled || !this.canResync()) return 'not possible now';
      if (!track || this.state.track?.key !== plan.key) return 'the song changed';
      if (this.state.status !== 'playing' || !this.clock.playing || !this.lastReport?.playing) return 'the music is not playing';
      if (track.durationMs - this.clock.now() < RESYNC_MIN_REMAINING_MS) return 'the song is nearly over';
      return null;
    };
    const notReady = ready();
    if (notReady) return skip(notReady);

    this.resyncing = true;
    let tested: string | null = null;
    let gapForLog = 0;
    const startedAt = performance.now();
    const interrupted = () => this.lastUserActionAt >= startedAt;
    try {
      // 1. A quiet way first, if there is one: no gap in the music at all.
      const probes = this.silentProbes();
      const id = this.probeMemory.pick(probes.map((p) => p.id));
      if (id) {
        const probe = probes.find((p) => p.id === id)!;
        const known = this.probeMemory.works === id;
        try {
          const m = await this.refreshAndMeasure(this.lastReport!, async () => {
            await probe.run();
            return 0;
          });
          if (interrupted()) return logTiming('re-sync: you changed the playback meanwhile, so nothing is learned from it');
          if (m && (known || Math.abs(m.b) >= PROBE_REFRESH_MIN_MS)) {
            // Spotify reported a different position afterwards, so the quiet attempt refreshed it.
            if (!known) this.probeMemory.markWorks(id);
            this.positionBiasMs = 0;
            return this.learnFrom(plan, m.b, `quietly, without pausing (${id})`);
          }
          if (!known) {
            this.probeMemory.noteTried(id);
            tested = id;
          }
          logTiming(`quiet re-sync (${id}): ${m ? `the position did not change (${signedSec(m.b)}s)` : 'Spotify did not report'}; pausing instead`);
        } catch (err) {
          if (isRefusal(err)) this.probeMemory.markFailed(id);
          logTiming(`quiet re-sync (${id}) failed: ${err instanceof Error ? err.message : String(err)}${isRefusal(err) ? '; will not try it again' : ''}; pausing instead`);
        }
        const stillReady = ready();
        if (stillReady) return skip(stillReady);
      }

      // 2. Pause and resume the music for a split second.
      const m = await this.refreshAndMeasure(this.lastReport!, async () => {
        const sentAt = performance.now();
        await this.sendPause();
        // Spotify refreshes its state now: from here on, take reports as they are.
        this.positionBiasMs = 0;
        try {
          await this.sendResume();
        } catch {
          await this.sendResume(); // never leave the music paused because of us
        }
        // The music was silent from about the middle of the pause request to the middle of the resume request.
        const gapMs = (performance.now() - sentAt) / 2;
        gapForLog = gapMs;
        return gapMs;
      });
      if (!m) return logTiming('re-sync: Spotify did not report after the pause');
      if (interrupted()) return logTiming('re-sync: you changed the playback meanwhile, so nothing is learned from it');
      // The quiet attempt showed nothing but the pause did: that quiet way doesn't work.
      if (tested && Math.abs(m.b) >= PROBE_REFRESH_MIN_MS) {
        this.probeMemory.markFailed(tested);
        logTiming(`the quiet way (${tested}) does not refresh Spotify's position here; it won't be tried again`);
      }
      this.learnFrom(plan, m.b, `by pausing for about ${sec(gapForLog)}s${this.resyncPath()}`);
    } catch (err) {
      // 403: Spotify doesn't allow it (no Premium, or this device can't be controlled): no point in trying again.
      if ((err as { status?: number })?.status === 403) this.resyncBlocked = true;
      logTiming(`re-sync failed: ${err instanceof Error ? err.message : String(err)}${this.resyncBlocked ? ' (will not try again)' : ''}`);
    } finally {
      this.resyncing = false;
    }
  }

  /** When you last pressed play, pause, next, previous or sought from here: a change of position then isn't Spotify refreshing itself. */
  private lastUserActionAt = -Infinity;
  protected noteUserAction() {
    this.lastUserActionAt = performance.now();
  }

  /** Spotify's state is refreshed by a seek, so the blend length no longer applies. */
  protected clearPositionBias() {
    this.positionBiasMs = 0;
    this.noteUserAction();
    if (!this.resyncing) this.cancelResync('you sought');
  }

  /**
   * Core logic shared by every source: is this a new song (and if so, how did
   * it hand over — skip, natural end, or an Automix/Crossfade blend?) or just
   * a position update? `reported` is false when the position was counted by us
   * rather than reported by Spotify (so there is nothing to correct).
   */
  protected observe(track: TrackInfo, reportedMs: number, playing: boolean, measuredAt: number, reported = true, note = '') {
    const prev = this.state.track;
    const last = this.lastReport;
    const clockBefore = this.clock.now(measuredAt);

    // Around a hand-over, Spotify can answer with the song we just left for a moment, between answers about the new one.
    // That is not a change back: taking it for one would flip the lyrics, the clock and the animations back and forth.
    const left = this.lastLeft;
    if (prev && left && prev.key !== track.key && track.key === left.key && reported && measuredAt - left.at < STALE_REPORT_WINDOW_MS) {
      if (reportedMs >= left.pos - STALE_REPORT_TOLERANCE_MS) {
        logTiming(`ignored a stale report of "${left.name}" (reported ${sec(reportedMs)}; it was left at ${sec(left.pos)})`);
        return;
      }
    }
    if (!prev || prev.key !== track.key) {
      const transition: TransitionInfo = prev
        ? classifyTransition({
            prevDurationMs: prev.durationMs,
            prevPositionMs: this.clock.raw(measuredAt),
            newPositionMs: reportedMs,
            sinceLastReportMs: this.lastReportAt ? measuredAt - this.lastReportAt : 5000,
            wasPlaying: this.clock.playing,
          })
        : { kind: 'initial', overlapMs: 0, startOffsetMs: reportedMs };
      this.lastLeft = prev ? { key: prev.key, name: prev.name, pos: this.clock.raw(measuredAt), at: measuredAt, durationMs: prev.durationMs } : null;
      // What the app has measured on earlier blends (nothing before the first measurement), or a guess that has
      // been right lately. The blend length is not taken off by default: measured on a real setup, Spotify's
      // error was about a second while the blend lasted 9.5 to 12 s, so that made the lyrics 11 s late.
      const recent = this.biasLearner.recentBias() ?? 0;
      const rule = this.biasLearner.trustedRule();
      const guess = rule ? ruleValue(rule, { first: transition.startOffsetMs, old: transition.overlapMs, recent }) : recent;
      this.positionBiasMs = reported && this.fixBlendTiming && transition.kind === 'blend' ? Math.max(0, guess) : 0;
      const positionMs = Math.max(0, reportedMs - this.positionBiasMs);
      logTiming(
        `CHANGE ${this.kind}: "${prev?.name ?? '-'}" (clock ${sec(clockBefore)} of ${sec(prev?.durationMs)}) -> "${track.name}" (length ${sec(track.durationMs)}) ` +
          `reported=${sec(reportedMs)} kind=${transition.kind} overlap=${sec(transition.overlapMs)} startOffset=${sec(transition.startOffsetMs)} ` +
          `sinceLastReport=${sec(this.lastReportAt ? measuredAt - this.lastReportAt : null)} bias=${sec(this.positionBiasMs)} ${note}`.trimEnd(),
      );
      watchTiming(45_000);
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
      this.scheduleResync(track.key, transition, reported);
    } else {
      // A pause or resume, or a jump in what Spotify reports (a seek, from here or another device), means it
      // refreshed its state: the position is right again, so stop taking the blend length off.
      // Where the last report said we would be by now, and how far the new one is from that. A step forward in the
      // first seconds after a song change is a stale first answer catching up, not a seek.
      const settling = performance.now() - this.lastChangeAt < CHANGE_SETTLE_MS;
      const jump = last ? reportedMs - (last.playing ? last.pos + (measuredAt - last.at) : last.pos) : 0;
      const forwardSeek = jump >= SEEK_JUMP_MS && !settling;
      if (this.resyncPlan && !this.resyncing && last) {
        if (playing !== last.playing || forwardSeek || jump <= -SEEK_JUMP_MS) this.cancelResync('Spotify was paused, resumed or sought by someone else');
      }
      if (this.positionBiasMs > 0 && last) {
        const why = !reported
          ? 'not reported'
          : playing !== last.playing
            ? 'pause or resume'
            : forwardSeek || jump <= -Math.max(REFRESH_STEP_BACK_MS, this.positionBiasMs * 0.5)
              ? `jump of ${signedSec(jump)}`
              : '';
        if (why) {
          logTiming(`bias ${sec(this.positionBiasMs)} dropped: ${why}`);
          this.positionBiasMs = 0;
        }
      }
      if (isWatchingTiming() || track.durationMs - clockBefore < 25_000) {
        logTiming(
          `${this.kind} "${track.name}" reported=${sec(reportedMs)} clock=${sec(clockBefore)} diff=${signedSec(reportedMs - this.positionBiasMs - clockBefore)} ` +
            `playing=${playing ? 1 : 0} bias=${sec(this.positionBiasMs)} ${note}`.trimEnd(),
        );
      }
      this.clock.durationMs = track.durationMs;
      this.clock.sync(Math.max(0, reportedMs - this.positionBiasMs), playing, measuredAt);
      if (this.state.isPlaying !== playing || this.state.status !== (playing ? 'playing' : 'paused')) {
        this.update({ isPlaying: playing, status: playing ? 'playing' : 'paused' });
      }
    }
    this.lastReport = { pos: reportedMs, at: measuredAt, playing };
    this.lastReportAt = measuredAt;
    if (this.reportWaiters.length) {
      const waiters = this.reportWaiters;
      this.reportWaiters = [];
      waiters.forEach((w) => w(this.lastReport!));
    }
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

const NO_DRM_MESSAGE = 'This copy of the app can’t play Spotify’s protected music itself. Pick a device with the button at the bottom (the Spotify app on this computer, your phone or a speaker).';

export class SpotifyEngine extends BaseEngine implements Engine {
  readonly kind = 'web-api';
  readonly isDemo = false;
  readonly searchMode = 'results';
  readonly canPlayHere: boolean;

  /**
   * The music plays in this app's own player (Spotify's Web Playback SDK), which shows up as a device. That needs copy
   * protection (DRM): the desktop app ships a build of Electron that has it, and says so if it is missing (see drm.ts).
   * `browserPlayer: false` turns the own player off (music then plays in a Spotify app and the window follows it).
   */
  constructor({ browserPlayer = true, local = desktopApi() }: { browserPlayer?: boolean; local?: LyricsStageDesktopApi | null } = {}) {
    super();
    this.canPlayHere = browserPlayer;
    this.local = local;
  }
  /** Desktop app: the Spotify app on this computer, which can be paused and resumed much faster than through Spotify's servers. */
  private local: LyricsStageDesktopApi | null;
  private localSnap: LocalSnapshot | null = null;
  private offLocal: (() => void) | null = null;
  private resyncVia: 'local' | 'servers' = 'servers';
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = false;
  private pokeRequested = false;
  private failures = 0;

  protected onTrackChanged() {
    if (!this.sdkActive) void this.refreshQueue();
  }

  // The re-sync (see BaseEngine): not in this browser's own player, whose positions are exact.
  protected canResync() {
    return !this.sdkActive && this.state.device?.isActive !== false;
  }
  protected async sendPause() {
    const uri = this.state.track?.uri;
    if (this.local && uri && localIsPlaying(this.localSnap, uri, Date.now())) {
      try {
        if ((await this.local.command({ type: 'pause' })).ok) {
          this.resyncVia = 'local';
          return;
        }
      } catch {
        /* fall back to Spotify's servers */
      }
    }
    this.resyncVia = 'servers';
    await spotify.pause();
  }
  protected async sendResume() {
    if (this.resyncVia === 'local' && this.local) {
      try {
        if ((await this.local.command({ type: 'play' })).ok) return;
      } catch {
        /* fall back to Spotify's servers */
      }
    }
    await spotify.play(undefined);
  }
  protected askForReport() {
    this.pokeSoon(200);
  }
  /** What Spotify last said about the repeat mode (a quiet attempt changes it for a moment and puts it back). */
  private repeatState: 'off' | 'context' | 'track' | null = null;
  protected silentProbes(): SilentProbe[] {
    const probes: SilentProbe[] = [];
    // A nudge of the volume by one step, and back: too small to hear, and the player answers it.
    const volume = this.state.volume;
    if (volume !== null && !this.volumeSettling()) {
      probes.push({
        id: 'volume',
        run: async () => {
          this.volumeChangedAt = performance.now();
          await spotify.volume(volume < 100 ? volume + 1 : volume - 1);
          try {
            await spotify.volume(volume);
          } catch {
            await spotify.volume(volume); // always put it back
          }
          this.volumeChangedAt = performance.now();
        },
      });
    }
    // The repeat mode changed to another and back, within a moment.
    const repeat = this.repeatState;
    if (repeat) {
      probes.push({
        id: 'repeat',
        run: async () => {
          await spotify.repeat(repeat === 'off' ? 'context' : 'off');
          try {
            await spotify.repeat(repeat);
          } catch {
            await spotify.repeat(repeat); // always put it back
          }
        },
      });
    }
    return probes;
  }
  protected resyncPath() {
    return this.resyncVia === 'local' ? ', through the Spotify app on this computer' : ', through Spotify’s servers';
  }

  private player: SdkPlayer | null = null;
  /** True while this browser tab is the device Spotify is playing on. */
  private sdkActive = false;
  private sdkTimer: ReturnType<typeof setInterval> | undefined;
  private readyWaiters: ((id: string | null) => void)[] = [];

  start() {
    if (this.running) return;
    this.running = true;
    this.offLocal = this.local?.onSnapshot((s) => (this.localSnap = { uri: s.track?.uri ?? null, playing: s.playing, running: s.running, at: s.at })) ?? null;
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
    this.cancelResync('stopped');
    this.offLocal?.();
    this.offLocal = null;
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
    if (res.repeat_state === 'off' || res.repeat_state === 'context' || res.repeat_state === 'track') this.repeatState = res.repeat_state;
    // Shuffle and repeat, as the Spotify-style app shows them (only when they changed).
    const shuffle = res.shuffle_state === true;
    const repeat = this.repeatState ?? 'off';
    if (shuffle !== this.state.shuffle || repeat !== this.state.repeat) this.update({ shuffle, repeat });
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
    this.observe(
      toTrackInfo(res.item),
      res.progress_ms ?? 0,
      res.is_playing,
      measuredAt,
      true,
      typeof res.timestamp === 'number' ? `apiState=${sec(Date.now() - res.timestamp)}s old` : '',
    );
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
    if (!this.canPlayHere) throw new Error('Play music in a Spotify app (this computer, your phone or a speaker) and pick it with the device button.');
    // The desktop app and the phone app need copy protection (DRM) support to play Spotify's music themselves.
    if ((this.local || isNativeApp()) && !(await canPlayProtectedAudio())) {
      this.update({ browserPlayer: { status: 'error', deviceId: null, message: NO_DRM_MESSAGE } });
      throw new Error(NO_DRM_MESSAGE);
    }
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
    this.noteUserAction();
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
    this.noteUserAction();
    try {
      await spotify.next();
    } finally {
      this.pokeSoon(400);
    }
  }

  async previous() {
    this.noteUserAction();
    try {
      await spotify.previous();
    } finally {
      this.pokeSoon(400);
    }
  }

  async seek(positionMs: number) {
    this.clock.set(positionMs, this.clock.playing);
    this.clearPositionBias();
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
  private async playOrWakeBrowser(body: Parameters<typeof spotify.play>[0]) {
    try {
      await spotify.play(body);
    } catch (err) {
      const noDevice = err instanceof SpotifyError && (err.status === 404 || err.reason === 'NO_ACTIVE_DEVICE');
      if (!noDevice) throw err;
      // No device is playing right now: this app plays the music itself (its own player, shown as a device).
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

  async playContext(contextUri: string, firstUri?: string) {
    this.noteUserAction();
    try {
      await this.playOrWakeBrowser({ context_uri: contextUri, ...(firstUri ? { offset: { uri: firstUri } } : {}) });
    } finally {
      this.pokeSoon(500);
    }
  }

  async playUris(uris: string[], startIndex = 0) {
    if (!uris.length) return;
    this.noteUserAction();
    const start = Math.max(0, Math.min(startIndex, uris.length - 1));
    try {
      // Spotify takes up to 100 songs at once: the one picked, and what follows it.
      await this.playOrWakeBrowser({ uris: uris.slice(start, start + 100) });
    } finally {
      this.pokeSoon(500);
    }
  }

  async setShuffle(on: boolean) {
    this.update({ shuffle: on });
    try {
      await spotify.shuffle(on);
    } catch (err) {
      this.update({ shuffle: !on });
      throw err;
    } finally {
      this.pokeSoon(500);
    }
  }

  async setRepeat(mode: RepeatMode) {
    const before = this.state.repeat;
    this.repeatState = mode;
    this.update({ repeat: mode });
    try {
      await spotify.repeat(mode);
    } catch (err) {
      this.repeatState = before;
      this.update({ repeat: before });
      throw err;
    } finally {
      this.pokeSoon(500);
    }
  }

  async queueList(): Promise<TrackInfo[]> {
    const q = await spotify.getQueue();
    return (q?.queue ?? []).filter(isApiTrack).map(toTrackInfo);
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
