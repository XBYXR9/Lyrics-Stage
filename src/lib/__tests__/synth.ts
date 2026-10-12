// Made-up sound for tests: turns a signal into the same kind of spectrum snapshots the browser's AnalyserNode gives
// (2048-point Blackman window, magnitudes smoothed over time, decibels mapped to 0..255 between -90 and -5).

export const SAMPLE_RATE = 48000;
const N = 2048;
const BINS = N / 2;

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const WINDOW = Float64Array.from({ length: N }, (_, i) => 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N) + 0.08 * Math.cos((4 * Math.PI * i) / N));

/** A deterministic pseudo-random number in [-1, 1]. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

/**
 * Plays `signal` (a function of time in seconds) for `seconds` and returns one spectrum snapshot every `hopMs`,
 * each with its time in ms.
 */
export function spectra(signal: (t: number) => number, seconds: number, hopMs = 16, smoothing = 0.55): { at: number; bins: Uint8Array }[] {
  const out: { at: number; bins: Uint8Array }[] = [];
  const smooth = new Float64Array(BINS);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let ms = 0; ms < seconds * 1000; ms += hopMs) {
    const end = Math.round(((ms + hopMs) / 1000) * SAMPLE_RATE);
    for (let i = 0; i < N; i++) {
      re[i] = signal((end - N + i) / SAMPLE_RATE) * WINDOW[i];
      im[i] = 0;
    }
    fft(re, im);
    const bins = new Uint8Array(BINS);
    for (let b = 0; b < BINS; b++) {
      const mag = Math.hypot(re[b], im[b]) / N;
      smooth[b] = smoothing * smooth[b] + (1 - smoothing) * mag;
      const db = 20 * Math.log10(Math.max(smooth[b], 1e-9));
      bins[b] = Math.round(Math.min(1, Math.max(0, (db + 90) / 85)) * 255);
    }
    out.push({ at: ms, bins });
  }
  return out;
}

/** A sung vowel: a base note with overtones that fade towards the top, with a little natural wobble (vibrato, 5.5 times a second). */
export function voice(f0: number, vibrato = 0.003) {
  const rate = 5.5;
  return (t: number) => {
    // Frequency modulation done properly: the phase wobbles, so the pitch stays within +-vibrato of f0.
    const wobble = (vibrato * f0 / rate) * Math.cos(2 * Math.PI * rate * t);
    let s = 0;
    for (let h = 1; h <= 8; h++) s += (0.5 / h) * Math.sin(2 * Math.PI * f0 * h * t - h * 2 * Math.PI * wobble);
    return s * 0.5;
  };
}
