// Real-sound bars and beats (Windows desktop app, opt-in).
//
// The desktop app asks Windows for a copy of the sound going to the speakers
// ("loopback"; see electron/main.ts) and this file turns it into bar heights and
// beats with a Web Audio analyser. The sound stays inside the app: it's analysed
// and thrown away, never recorded, saved or sent anywhere.
//
// The app hears everything the computer plays, not just Spotify (Windows can't
// hand over one app's sound to an app like this). So the sound is only used
// inside the song's playback window: while Spotify is playing and the position
// is inside the song (see setPlaybackWindow). Paused, between songs, during an
// ad: it's ignored completely, and a video or a message ping can't set anything
// off. Anywhere this isn't available, the effects fall back to the estimated
// rhythm in pulse.ts.
import { desktopApi } from './desktopTypes';
import { BAR_COUNT } from './pulse';

const LOW_HZ = 45;
const HIGH_HZ = 12000;
/** The bars stay put for this long after the sound goes quiet, then the estimate takes over. */
const SILENCE_MS = 1500;
/** Don't look at the sound more often than this (several callers share one look per frame). */
const READ_EVERY_MS = 8;
/** After the window opens, the first few looks only warm the bars up (they rise from nothing), so that rise isn't taken for a beat. */
const WARM_UP_READS = 4;
/** The longest delay that can be asked for (for Bluetooth headphones). */
export const MAX_SOUND_DELAY_MS = 500;

/**
 * Turns an FFT spectrum (0..255 per frequency bin, as the analyser gives it)
 * into bar heights: log-spaced bands, auto-leveled so quiet and loud songs fill
 * the bars alike, with a quick rise and a slower fall. `state` keeps the
 * smoothing and the leveling between calls. Returns false when it's silent.
 */
export function barsFromSpectrum(
  spectrum: ArrayLike<number>,
  sampleRate: number,
  out: Float32Array,
  state: { smooth: Float32Array; peak: number },
): boolean {
  const n = out.length;
  const binHz = sampleRate / 2 / spectrum.length;
  const ratio = HIGH_HZ / LOW_HZ;
  let loudest = 0;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const from = Math.max(1, Math.floor((LOW_HZ * Math.pow(ratio, i / n)) / binHz));
    const to = Math.max(from + 1, Math.ceil((LOW_HZ * Math.pow(ratio, (i + 1) / n)) / binHz));
    let sum = 0;
    let count = 0;
    for (let b = from; b < Math.min(to, spectrum.length); b++) {
      sum += spectrum[b];
      count++;
    }
    // Higher sounds carry less energy in music; lift them so the right side of the bars moves too.
    raw[i] = (count ? sum / count / 255 : 0) * (1 + (i / n) * 0.6);
    loudest = Math.max(loudest, raw[i]);
  }
  state.peak = Math.max(loudest, state.peak * 0.995);
  const silent = loudest < 0.02;
  const level = Math.max(state.peak, 0.25);
  for (let i = 0; i < n; i++) {
    const v = Math.min(1, Math.pow(raw[i] / level, 1.3));
    const s = state.smooth[i];
    state.smooth[i] = s + (v - s) * (v > s ? 0.65 : 0.2);
    out[i] = state.smooth[i];
  }
  return !silent;
}

/**
 * Sets up the analyser the way the effects need. The default decibel scale tops
 * out at -30 dB, and in loud music the bass sits above that all the time, so the
 * bass would read "full" constantly and a kick could never stand out. This scale
 * leaves room above the bass.
 */
export function configureAnalyser(node: AnalyserNode) {
  node.fftSize = 2048; // fine enough that each low bar hears its own slice of the bass
  node.smoothingTimeConstant = 0.55;
  node.minDecibels = -90;
  node.maxDecibels = -5;
}

/** The bass range that beats are listened for: low enough to leave voices and most instruments out. */
const BASS_LOW_HZ = 30;
const BASS_HIGH_HZ = 130;

/**
 * The level (0..1) of each bin in the bass range, straight from an analyser
 * spectrum (0..255 per bin, on a decibel scale). Kept per bin, so a steady bass
 * note in one bin doesn't hide a kick drum rising in the bins next to it.
 */
export function bassBins(spectrum: ArrayLike<number>, sampleRate: number): Float32Array {
  const binHz = sampleRate / 2 / spectrum.length;
  const from = Math.max(1, Math.floor(BASS_LOW_HZ / binHz));
  const to = Math.min(spectrum.length - 1, Math.max(from, Math.floor(BASS_HIGH_HZ / binHz)));
  const out = new Float32Array(to - from + 1);
  for (let i = from; i <= to; i++) out[i - from] = spectrum[i] / 255;
  return out;
}

/** Remembers what the bass has been doing, to tell a hit from steady loudness. */
export interface BeatState {
  /** For each bass bin, the lowest it has been lately; it creeps up slowly, so steady bass stops counting as "above" it. */
  floors: Float32Array | null;
  /** The last ~100 ms of bass levels, to see how fast each bin is rising. */
  recent: { at: number; levels: Float32Array }[];
  lastNow: number;
  lastAt: number;
  /** How hard the hardest recent beat hit, fading slowly: a beat is rated against it. */
  peak: number;
  /** After a beat: the highest the bass (all bins added up, weighted) has been since, and the lowest it has been since that top. */
  top: number;
  low: number;
  /** After a beat: has the bass come down from its top since? */
  dipped: boolean;
  /** After a beat: has the bass dipped and risen again since, so that the next sharp rise is a new beat and not the same one? */
  armed: boolean;
}

export const newBeatState = (): BeatState => ({ floors: null, recent: [], lastNow: -1, lastAt: -Infinity, peak: 0, top: 0, low: 0, dipped: false, armed: true });

/** How much a floor may creep up per second. */
const FLOOR_CREEP_PER_S = 0.15;
/** A bin counts as "hit" when it rose at least this far above its floor (about 4 dB)... */
const MIN_RISE = 0.05;
/** ...and by at least this much within the last ~100 ms (a sharp attack, not a slow swell). */
const MIN_ATTACK = 0.04;
/** A beat needs this much rising bass added up over all the bins (a kick rises in several bins, a pure bass note in one or two). */
const MIN_HIT = 0.3;
const RECENT_MS = 100;
/**
 * Two beats are never closer than this: a debounce against jitter. Fast drum patterns (16th notes at 120 BPM are 125 ms
 * apart, double kicks about 180 ms) need it short; what keeps one long kick or 808 from counting twice is REARM_RISE.
 */
const MIN_BEAT_GAP_MS = 90;
/**
 * After a beat, the next one only counts once the bass has come down by at least REARM_DIP and then gone up again by
 * REARM_RISE (all bins added up, see binWeight). The fixed 250 ms gap this replaces dropped about half of the beats in
 * fast patterns, but a plain shorter gap counts a slow-rising 808 twice: its rise outlasts the gap.
 */
const REARM_DIP = 0.12;
const REARM_RISE = 0.12;

/**
 * How much a bin's rise counts, by its place in the bass range (0 = lowest, 1 =
 * highest): full for the deep bass where kicks and bass notes live, less near the
 * top, where low voices and other instruments leak in.
 */
const binWeight = (place: number) => (place <= 0.4 ? 1 : 1 - ((place - 0.4) / 0.6) * 0.6);

/**
 * Is this a beat? `levels` are the current bass levels (0..1), one per bin (see
 * bassBins). A beat is a sharp rise in the bass, clearly above where it has
 * been lately: a kick drum, a bass note, an 808. Steady loud bass isn't a beat,
 * and neither is a slow swell or the tail of the last beat, however loud the
 * rest of the music is. A beat counts again only once the bass has dipped and risen
 * since the last one, however fast that is (a kick every 125 ms is fine). Returns its strength
 * (0..1), or 0: how hard it hit compared with the hardest recent beat, so the
 * hardest are 1.
 */
export function detectBeat(levels: ArrayLike<number>, state: BeatState, nowMs: number): number {
  const n = levels.length;
  const dt = state.lastNow < 0 ? 0 : Math.max(0, (nowMs - state.lastNow) / 1000);
  state.lastNow = nowMs;
  if (!state.floors || state.floors.length !== n) state.floors = Float32Array.from(levels);
  const floors = state.floors;
  state.peak *= Math.pow(0.89, dt);

  while (state.recent.length && nowMs - state.recent[0].at > RECENT_MS) state.recent.shift();
  let total = 0;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    energy += binWeight(n > 1 ? i / (n - 1) : 0) * levels[i];
    floors[i] = Math.min(levels[i], floors[i] + FLOOR_CREEP_PER_S * dt);
    let before = levels[i];
    for (const r of state.recent) before = Math.min(before, r.levels[i]);
    const rise = levels[i] - floors[i];
    const attack = levels[i] - before;
    if (rise >= MIN_RISE && attack >= MIN_ATTACK) total += binWeight(n > 1 ? i / (n - 1) : 0) * Math.min(rise, attack);
  }
  state.recent.push({ at: nowMs, levels: Float32Array.from(levels) });

  // Since the last beat: has the bass come down, and gone up again? (Once it has, that stays true until the next beat.)
  if (!state.armed) {
    if (state.dipped) {
      if (energy - state.low >= REARM_RISE) state.armed = true;
      else state.low = Math.min(state.low, energy);
    } else if (energy >= state.top) {
      state.top = state.low = energy; // still climbing: the same beat
    } else {
      state.low = Math.min(state.low, energy);
      if (state.top - state.low >= REARM_DIP) state.dipped = true;
    }
  }

  if (total < MIN_HIT || !state.armed || nowMs - state.lastAt <= MIN_BEAT_GAP_MS) return 0;
  state.lastAt = nowMs;
  state.armed = false;
  state.dipped = false;
  state.top = state.low = energy;
  state.peak = Math.max(state.peak, total);
  const span = Math.max(0.1, state.peak - MIN_HIT);
  return Math.min(1, Math.max(0.35, 0.35 + (0.65 * (total - MIN_HIT)) / span));
}

/**
 * Holds what was heard for a moment before it's used. For Bluetooth headphones,
 * which play the sound a fraction of a second after the computer sends it: the
 * effects should land when the beat reaches the ears, not when it left the PC.
 */
export class DelayLine {
  private items: { at: number; bars: Float32Array; beat: number }[] = [];

  push(at: number, bars: ArrayLike<number>, beat: number) {
    this.items.push({ at, bars: Float32Array.from(bars), beat });
    if (this.items.length > 256) this.items.shift();
  }

  /**
   * Takes out everything heard at or before `until`. Copies the newest of those
   * bar heights into `out` and returns it with the strongest beat among them,
   * or null when nothing is old enough yet.
   */
  release(until: number, out: Float32Array): { beat: number } | null {
    let found = false;
    let beat = 0;
    while (this.items.length && this.items[0].at <= until) {
      const item = this.items.shift()!;
      out.set(item.bars.subarray(0, out.length));
      beat = Math.max(beat, item.beat);
      found = true;
    }
    return found ? { beat } : null;
  }

  clear() {
    this.items.length = 0;
  }

  get size() {
    return this.items.length;
  }
}

/**
 * Reads bars and beats out of a stream of spectrum snapshots. It holds all the
 * rules (the playback window, the delay, the silence fallback) apart from the
 * browser's audio objects, so they can be tested with a made-up spectrum.
 */
export class LevelReader {
  private readonly bars = new Float32Array(BAR_COUNT);
  private readonly shown = new Float32Array(BAR_COUNT);
  private readonly state = { smooth: new Float32Array(BAR_COUNT), peak: 0 };
  private readonly line = new DelayLine();
  private readonly meterBuf: Uint8Array<ArrayBuffer>;
  private beatState = newBeatState();
  private spectrum: Uint8Array<ArrayBuffer>;
  private lastReadAt = -Infinity;
  private lastSoundAt = 0;
  private heard = false;
  private pendingBeat = 0;
  private open = false;
  private warm = 0;
  private delayMs = 0;

  constructor(
    /** Fills the buffer with the current spectrum (0..255 per bin). */
    private readonly fill: (into: Uint8Array<ArrayBuffer>) => void,
    private readonly sampleRate: number,
    bins: number,
    startedAt = 0,
  ) {
    this.spectrum = new Uint8Array(bins);
    this.meterBuf = new Uint8Array(bins);
    this.lastSoundAt = startedAt;
  }

  /**
   * Opens or closes the window in which the sound counts. Closing throws away
   * everything held, so a beat from before can't fire later; opening starts the
   * beat detector from scratch.
   */
  setWindow(open: boolean) {
    if (open === this.open) return;
    this.open = open;
    this.line.clear();
    this.pendingBeat = 0;
    this.heard = false;
    this.state.smooth.fill(0);
    this.state.peak = 0;
    this.beatState = newBeatState();
    this.warm = open ? WARM_UP_READS : 0;
  }

  get windowOpen() {
    return this.open;
  }

  setDelay(ms: number) {
    const next = Math.min(MAX_SOUND_DELAY_MS, Math.max(0, Number.isFinite(ms) ? ms : 0));
    if (next === this.delayMs) return;
    this.delayMs = next;
    this.line.clear();
  }

  /** The strength (0..1) of a strong beat since the last call, or 0. */
  takeBeat(): number {
    const b = this.pendingBeat;
    this.pendingBeat = 0;
    return b;
  }

  /**
   * Copies the bar heights into `out`. False means "use the estimate": the
   * window is closed, or nothing has been heard for a while.
   */
  read(now: number, out: Float32Array): boolean {
    if (!this.open) return false;
    if (now - this.lastReadAt > READ_EVERY_MS) {
      this.lastReadAt = now;
      this.fill(this.spectrum);
      const loud = barsFromSpectrum(this.spectrum, this.sampleRate, this.bars, this.state);
      if (loud) this.lastSoundAt = now;
      // Silence between beats is data too (the bass falls to nothing), so it is always fed in.
      const bass = bassBins(this.spectrum, this.sampleRate);
      let beat = 0;
      if (this.warm > 0) {
        if (loud) this.warm--;
      } else beat = detectBeat(bass, this.beatState, now);
      this.heard = now - this.lastSoundAt < SILENCE_MS;
      if (this.delayMs > 0) this.line.push(now, this.bars, beat);
      else {
        this.shown.set(this.bars);
        if (beat > 0) this.pendingBeat = Math.max(this.pendingBeat, beat);
      }
    }
    if (this.delayMs > 0) {
      const got = this.line.release(now - this.delayMs, this.shown);
      if (got && got.beat > 0) this.pendingBeat = Math.max(this.pendingBeat, got.beat);
    }
    if (!this.heard) return false;
    out.set(this.shown.subarray(0, out.length));
    return true;
  }

  /** How loud the sound is right now (0..1), whether or not the window is open. For the level meter in Settings. */
  loudness(): number {
    this.fill(this.meterBuf);
    const top = Math.max(1, Math.floor(this.meterBuf.length / 4));
    let sum = 0;
    for (let i = 1; i < top; i++) sum += this.meterBuf[i];
    return Math.min(1, (sum / top / 255) * 2.2);
  }
}

// ---------------------------------------------------------------------------
// Starting and stopping the listening (browser side)

/** Where the listening stands, in words the settings can show. */
export type AudioState = 'off' | 'waiting' | 'starting' | 'listening' | 'failed';
export interface AudioStatus {
  state: AudioState;
  /** Plain words: why it isn't listening. */
  reason: string | null;
}

let status: AudioStatus = { state: 'off', reason: null };
const statusListeners = new Set<() => void>();

export const getAudioStatus = () => status;
export function subscribeAudioStatus(l: () => void) {
  statusListeners.add(l);
  return () => {
    statusListeners.delete(l);
  };
}
export function setAudioStatus(state: AudioState, reason: string | null = null) {
  if (status.state === state && status.reason === reason) return;
  status = { state, reason };
  statusListeners.forEach((l) => l());
}

/** The error name used when the system shared a stream without any sound in it. */
const NO_SOUND_TRACK = 'NoSoundTrack';

/** What went wrong while starting, in plain words. */
export function describeAudioError(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err === 'string' ? err : '';
  switch (name) {
    case 'NotAllowedError':
      return 'The app wasn’t allowed to share the sound yet. Click anywhere in the app and it tries again.';
    case 'NotFoundError':
      return 'No sound output was found on this computer.';
    case 'NotSupportedError':
      return 'This version of the app can’t listen to the computer’s sound.';
    case NO_SOUND_TRACK:
      return 'Windows shared the screen but no sound with it.';
    default:
      return 'Couldn’t start listening to the sound.';
  }
}

let context: AudioContext | null = null;
let stream: MediaStream | null = null;
let reader: LevelReader | null = null;
let starting: Promise<boolean> | null = null;
let wantedDelayMs = 0;
let wantedWindow = false;

/** Is the app listening to the sound right now? */
export function audioLive(): boolean {
  return !!reader;
}

async function capture(): Promise<MediaStream> {
  // The desktop app answers this request itself with the system sound (electron/main.ts).
  const media = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  media.getVideoTracks().forEach((t) => t.stop()); // only the sound is wanted
  if (!media.getAudioTracks().length) {
    media.getTracks().forEach((t) => t.stop());
    const err = new Error('no sound in the shared stream');
    err.name = NO_SOUND_TRACK;
    throw err;
  }
  return media;
}

/**
 * Starts listening to the computer's sound. Resolves true once it's running,
 * false if it couldn't start (not allowed yet, no audio, not supported). If the
 * first way fails, the desktop app is asked to share the sound along with a
 * screen source instead, which some Windows setups need. The reason for a
 * failure is kept in getAudioStatus().
 */
export function startAudioLevels(): Promise<boolean> {
  if (reader) return Promise.resolve(true);
  starting ??= (async () => {
    setAudioStatus('starting');
    let media: MediaStream | null = null;
    let failure: unknown = null;
    for (const source of ['frame', 'screen'] as const) {
      try {
        await desktopApi()?.setSoundSource(source);
        media = await capture();
        break;
      } catch (err) {
        failure = err;
      }
    }
    if (!media) {
      setAudioStatus('failed', describeAudioError(failure));
      return false;
    }
    try {
      const ctx = new AudioContext();
      void ctx.resume().catch(() => {});
      const node = ctx.createAnalyser();
      configureAnalyser(node);
      ctx.createMediaStreamSource(media).connect(node); // not connected to the speakers: no echo
      stream = media;
      context = ctx;
      reader = new LevelReader((into) => node.getByteFrequencyData(into), ctx.sampleRate, node.frequencyBinCount, performance.now());
      reader.setDelay(wantedDelayMs);
      reader.setWindow(wantedWindow);
      media.getAudioTracks()[0].addEventListener('ended', stopAudioLevels);
      setAudioStatus('listening');
      return true;
    } catch (err) {
      media.getTracks().forEach((t) => t.stop());
      setAudioStatus('failed', describeAudioError(err));
      return false;
    }
  })().finally(() => {
    starting = null;
  });
  return starting;
}

export function stopAudioLevels() {
  stream?.getTracks().forEach((t) => t.stop());
  void context?.close().catch(() => {});
  stream = null;
  context = null;
  reader = null;
  if (status.state === 'listening' || status.state === 'starting') setAudioStatus('off');
}

/**
 * Says whether the song is playing and the position is inside it. The sound only
 * counts while this is true (see the top of this file). Call it every frame.
 */
export function setPlaybackWindow(open: boolean) {
  wantedWindow = open;
  reader?.setWindow(open);
}

/** Delays what's heard by this many ms (0..500), to line the effects up with Bluetooth headphones. */
export function setSoundDelay(ms: number) {
  wantedDelayMs = ms;
  reader?.setDelay(ms);
}

/** The strength (0..1) of a strong beat heard since the last call, or 0. Call it every frame while listening. */
export function takeBeat(): number {
  return reader?.takeBeat() ?? 0;
}

/**
 * Copies the current bar heights into `out`. Returns false when the real sound
 * isn't available, isn't counted right now (outside the song's playback
 * window), or has been silent for a while, so the caller uses the estimated
 * rhythm instead. Cheap to call from several places in one frame.
 */
export function readAudioLevels(out: Float32Array): boolean {
  return reader ? reader.read(performance.now(), out) : false;
}

/** Is the sound counting right now (listening, and the song is playing)? For the status in Settings. */
export const audioCounting = () => !!reader && wantedWindow;

/** How loud the computer's sound is right now (0..1), for the meter in Settings. 0 when not listening. */
export function peekAudioLoudness(): number {
  return reader ? reader.loudness() : 0;
}
