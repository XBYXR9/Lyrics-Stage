// Is the music holding a note right now? (Windows desktop app, with the real sound switched on.)
//
// A singer holding a vowel ("youuuu") makes a steady sound with clear harmonics in the voice range: the same
// pattern of peaks, frame after frame. A melody changing note, drums, and hiss don't. This looks at the same
// spectrum snapshots the bars use (see audioLevels.ts) and says for how long such a steady, peaky sound has
// lasted. It can't tell a voice from a guitar or a synth pad; it only sees the whole mix. Two things keep that
// honest: it is only used while a word is being sung (lyrics timing), and a sound that is steady ALL the time
// (a pad under the whole song) is measured against its own baseline, so only a note that stands out counts.

/** The range where voices live: the base note and the first few overtones. */
const BAND_LOW_HZ = 150;
const BAND_HIGH_HZ = 3000;
/** Frames are compared with one this far back, so a change that takes a few frames still shows up. */
const COMPARE_MS = 45;
const HISTORY_MS = 160;
/** If even the strongest peaks in the band are quieter than this (0..1 of the full scale), it is silence. */
const MIN_PEAK = 0.3;
/** How alike two frames must be (correlation) to count as steady: nothing below LOW, fully steady at HIGH. */
const STEADY_LOW = 0.86;
const STEADY_HIGH = 0.97;
/** How much the strongest peaks must stand above the middle of the spectrum (0..1 of the full scale). */
const PEAKY_LOW = 0.12;
const PEAKY_HIGH = 0.3;
/** How quickly the score follows what is heard, per frame. */
const FOLLOW = 0.5;
/** The score counts as "holding" above this, and must also stand this far above the song's usual score. */
const HOLD_SCORE = 0.5;
const HOLD_ABOVE_BASELINE = 0.3;
/** While holding, a frame that no longer looks like the held note (below this correlation) starts a new note. */
const SAME_NOTE = 0.85;
/** A short drop-out (a consonant, a breath of the mix) doesn't end a held note. */
const GRACE_MS = 250;
/** The baseline (how steady the song usually is) averages over about this long... */
const BASELINE_MS = 5000;
/** ...but only from what was heard at least this long ago, so a note being held doesn't raise the bar against itself. */
const BASELINE_LAG_MS = 1000;

export interface SustainReading {
  /** How long the note has been held, in ms (0 when nothing is held). */
  heldMs: number;
  /** How steady and peaky the sound is right now, 0..1. */
  score: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Pearson correlation of two equally long vectors. 0 when one of them is flat. */
export function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  const d = Math.sqrt(saa * sbb);
  return d < 1e-9 ? 0 : sab / d;
}

export class SustainDetector {
  private history: { at: number; v: Float32Array }[] = [];
  private score = 0;
  private baseline = 0;
  private lastAt = -1;
  private heldSince: number | null = null;
  private lastGood = -Infinity;
  /** What the held note looks like, to tell the same note coming back (after a drum hit) from a new one. */
  private anchor: Float32Array | null = null;
  private pending: { at: number; dt: number; score: number }[] = [];

  /** Forget everything (a new song, or the sound stopped counting). */
  reset() {
    this.history.length = 0;
    this.score = 0;
    this.baseline = 0;
    this.lastAt = -1;
    this.heldSince = null;
    this.lastGood = -Infinity;
    this.anchor = null;
    this.pending.length = 0;
  }

  /** Looks at one spectrum snapshot (0..255 per bin) taken at `now` (ms). */
  push(spectrum: ArrayLike<number>, sampleRate: number, now: number): SustainReading {
    const binHz = sampleRate / 2 / spectrum.length;
    const lo = Math.max(1, Math.floor(BAND_LOW_HZ / binHz));
    const hi = Math.min(spectrum.length - 1, Math.ceil(BAND_HIGH_HZ / binHz));
    const dt = this.lastAt < 0 ? 0 : Math.max(0, now - this.lastAt);
    this.lastAt = now;

    const cur = new Float32Array(hi - lo + 1);
    let sum = 0;
    for (let i = lo; i <= hi; i++) {
      cur[i - lo] = spectrum[i];
      sum += spectrum[i];
    }
    // The strongest tenth of the bins, against the average: how peaky the sound is.
    const sorted = Float32Array.from(cur).sort();
    const top = Math.max(1, Math.floor(sorted.length / 10));
    let topSum = 0;
    for (let i = sorted.length - top; i < sorted.length; i++) topSum += sorted[i];
    const topMean = topSum / top;
    const crest = (topMean - sum / cur.length) / 255;

    let raw = 0;
    if (topMean / 255 >= MIN_PEAK) {
      // Compare with a frame from a moment ago.
      let prev: Float32Array | null = null;
      for (let k = this.history.length - 1; k >= 0; k--) {
        if (now - this.history[k].at >= COMPARE_MS) {
          prev = this.history[k].v;
          break;
        }
      }
      if (prev && prev.length === cur.length) {
        const steady = clamp01((correlation(cur, prev) - STEADY_LOW) / (STEADY_HIGH - STEADY_LOW));
        raw = steady * clamp01((crest - PEAKY_LOW) / (PEAKY_HIGH - PEAKY_LOW));
      }
    }
    // Keep a frame about every 20 ms for later comparison.
    const newest = this.history[this.history.length - 1];
    if (!newest || now - newest.at >= 20) this.history.push({ at: now, v: cur });
    while (this.history.length && now - this.history[0].at > HISTORY_MS + COMPARE_MS) this.history.shift();

    this.score += (raw - this.score) * FOLLOW;
    // The baseline hears the score late (see BASELINE_LAG_MS).
    this.pending.push({ at: now, dt, score: this.score });
    while (this.pending.length && now - this.pending[0].at >= BASELINE_LAG_MS) {
      const old = this.pending.shift()!;
      this.baseline += (old.score - this.baseline) * clamp01(old.dt / BASELINE_MS);
    }

    const holding = this.score >= HOLD_SCORE && this.score - this.baseline >= HOLD_ABOVE_BASELINE;
    if (holding) {
      if (this.heldSince !== null && this.anchor && correlation(cur, this.anchor) < SAME_NOTE) this.heldSince = null; // a new note
      if (this.heldSince === null) {
        this.heldSince = now;
        this.anchor = cur;
      } else if (this.anchor) {
        for (let i = 0; i < cur.length; i++) this.anchor[i] += (cur[i] - this.anchor[i]) * 0.1; // follows the vibrato
      }
      this.lastGood = now;
    } else if (now - this.lastGood > GRACE_MS) {
      this.heldSince = null;
      this.anchor = null;
    }
    return { heldMs: this.heldSince === null ? 0 : now - this.heldSince, score: this.score };
  }
}
