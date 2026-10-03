// Real-sound bars for the break visualizer (Windows desktop app, opt-in).
//
// The desktop app asks Windows for a copy of the sound going to the speakers
// ("loopback"; see electron/main.ts) and this file turns it into bar heights
// with a Web Audio analyser. The sound stays inside the app: it's analysed and
// thrown away, never recorded, saved or sent anywhere. Everything playing on
// the computer is heard, not just Spotify. Anywhere this isn't available, the
// bars fall back to the estimated rhythm in pulse.ts.
import { BAR_COUNT } from './pulse';

const LOW_HZ = 45;
const HIGH_HZ = 12000;
/** The bars stay put for this long after the sound goes quiet, then the estimate takes over. */
const SILENCE_MS = 1500;

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

/** Remembers what the bass has been doing, to tell a hit from steady loudness. */
export interface BeatState {
  /** Slowly-moving average of the bass level. */
  avg: number;
  lastAt: number;
}

/** The average is learned from the first sample, so music that is already loud doesn't start with false beats. */
export const newBeatState = (): BeatState => ({ avg: -1, lastAt: -Infinity });

/**
 * Is this a strong beat? `bass` is the current level of the low bars (0..1).
 * A beat is a clear jump above the bass's recent average, at least 250 ms
 * after the last one, so steady loud bass isn't a beat, a kick drum is.
 * Returns its strength (0..1), or 0.
 */
export function detectBeat(bass: number, state: BeatState, nowMs: number): number {
  if (state.avg < 0) state.avg = bass;
  const threshold = Math.max(0.2, state.avg * 1.4);
  const hit = bass > threshold && nowMs - state.lastAt > 250;
  state.avg = state.avg * 0.96 + bass * 0.04;
  if (!hit) return 0;
  state.lastAt = nowMs;
  return Math.min(1, 0.35 + (bass - threshold) * 2.2);
}

let context: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let stream: MediaStream | null = null;
let spectrum: Uint8Array<ArrayBuffer> | null = null;
let starting: Promise<boolean> | null = null;
let lastSoundAt = 0;
let lastReadAt = -Infinity;
let lastHeard = false;
const state = { smooth: new Float32Array(BAR_COUNT), peak: 0 };
const cache = new Float32Array(BAR_COUNT);
let beatState = newBeatState();
let pendingBeat = 0;

/** Is the app listening to the sound right now? */
export function audioLive(): boolean {
  return !!analyser;
}

/**
 * Starts listening to the computer's sound. Resolves true once it's running,
 * false if it couldn't start (not allowed yet, no audio, not supported).
 */
export function startAudioLevels(): Promise<boolean> {
  if (analyser) return Promise.resolve(true);
  starting ??= (async () => {
    try {
      // The desktop app answers this request itself with the system sound (electron/main.ts).
      const media = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      media.getVideoTracks().forEach((t) => t.stop()); // only the sound is wanted
      if (!media.getAudioTracks().length) {
        media.getTracks().forEach((t) => t.stop());
        return false;
      }
      const ctx = new AudioContext();
      void ctx.resume().catch(() => {});
      const node = ctx.createAnalyser();
      node.fftSize = 2048; // fine enough that each low bar hears its own slice of the bass
      node.smoothingTimeConstant = 0.55;
      ctx.createMediaStreamSource(media).connect(node); // not connected to the speakers: no echo
      stream = media;
      context = ctx;
      analyser = node;
      spectrum = new Uint8Array(node.frequencyBinCount);
      lastSoundAt = performance.now();
      media.getAudioTracks()[0].addEventListener('ended', stopAudioLevels);
      return true;
    } catch {
      return false;
    } finally {
      starting = null;
    }
  })();
  return starting;
}

export function stopAudioLevels() {
  stream?.getTracks().forEach((t) => t.stop());
  void context?.close().catch(() => {});
  stream = null;
  context = null;
  analyser = null;
  spectrum = null;
  state.smooth.fill(0);
  state.peak = 0;
  lastHeard = false;
  beatState = newBeatState();
  pendingBeat = 0;
}

/** The strength (0..1) of a strong beat heard since the last call, or 0. Call it every frame while listening. */
export function takeBeat(): number {
  const b = pendingBeat;
  pendingBeat = 0;
  return b;
}

/**
 * Copies the current bar heights into `out`. Returns false when the real sound
 * isn't available or has been silent for a while, so the caller uses the
 * estimated rhythm instead. Cheap to call from several places in one frame.
 */
export function readAudioLevels(out: Float32Array): boolean {
  if (!analyser || !spectrum || !context) return false;
  const now = performance.now();
  if (now - lastReadAt > 8) {
    lastReadAt = now;
    analyser.getByteFrequencyData(spectrum);
    const heard = barsFromSpectrum(spectrum, context.sampleRate, cache, state);
    if (heard) {
      lastSoundAt = now;
      let bass = 0;
      for (let i = 0; i < 6; i++) bass += cache[i];
      const beat = detectBeat(bass / 6, beatState, now);
      if (beat > 0) pendingBeat = Math.max(pendingBeat, beat);
    }
    lastHeard = now - lastSoundAt < SILENCE_MS;
  }
  if (!lastHeard) return false;
  out.set(cache.subarray(0, out.length));
  return true;
}
