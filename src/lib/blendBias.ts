// Learns how far ahead (or behind) Spotify's reported song position runs after an
// Automix / Crossfade blend.
//
// Spotify's own apps have this bug: after the songs are mixed, the position of
// the new song can be wrong for the rest of the song, until something makes
// Spotify refresh it (a seek, or a pause and play). Nobody knows by how much, and
// it differs from one setup to another, so the app measures it: a few seconds
// after a blend it pauses and resumes the music for a split second, which makes
// Spotify report the right position, and the difference is the error.
//
// Each measurement is kept next to the guesses that could be made when the blend was seen:
//   "first-report": the position Spotify gave for the new song when it showed up
//                   (less the time since the switch): the new song started that far in
//   "old-song":     how much of the old song was left when it was replaced
//   "recent":       what the last few blends measured (the middle one of them)
// When one guess has been right on the last two blends, the app uses it and stops
// pausing the music (it still measures again now and then, to check, less and less often).
//
// What a real setup measured (a Windows PC, Automix, seven blends): between -0.4 and +1.4 s, about a second
// ahead, while the old song's remaining time said 9.5 to 12 s. Taking that off, as this used to, made the lyrics
// 11 s late. So until a guess has been proven, only what was actually measured is taken off.

/** One measurement: the real error `b` (ms) and the two guesses that could be made for that blend from what was seen. */
export interface BiasSample {
  b: number;
  first: number;
  old: number;
}

export type BiasRule = 'none' | 'first-report' | 'old-song' | 'recent';

/** How many measurements are kept. */
const KEEP = 8;
/** How many of the latest measurements the "recent" guess goes by. */
const RECENT = 4;
/** A rule has to be right on this many measurements in a row to be trusted. */
const NEED = 2;
/**
 * Blends in a row that use a trusted rule before measuring again to check it. The more checks it has passed in a
 * row, the longer it waits for the next one, so the music is paused less and less.
 */
const CHECK_AFTER = [2, 4, 8, 16];
/** Smaller than this counts as "no error" (ms). */
const SMALL_MS = 500;

/** How far a guess may be off and still count as right: a fifth of the error, but at least 0.8 s. */
export const biasTolerance = (b: number) => Math.max(800, Math.abs(b) * 0.2);

/** What a rule says the error is, from the guesses made when the blend was seen. */
export function ruleValue(rule: BiasRule, guesses: { first: number; old: number; recent?: number }): number {
  if (rule === 'first-report') return guesses.first;
  if (rule === 'old-song') return guesses.old;
  if (rule === 'recent') return guesses.recent ?? 0;
  return 0;
}

const RULES: BiasRule[] = ['none', 'recent', 'first-report', 'old-song'];

const middleOf = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};

/** `recent` is what the "recent" guess said for this measurement (null when there was nothing to go by). */
function ruleError(rule: BiasRule, s: BiasSample, recent: number | null): number {
  if (rule === 'none') return Math.abs(s.b);
  if (rule === 'recent') return recent === null ? Infinity : Math.abs(recent - s.b);
  return Math.abs(ruleValue(rule, s) - s.b);
}

function ruleIsRight(rule: BiasRule, s: BiasSample, recent: number | null): boolean {
  return rule === 'none' ? Math.abs(s.b) <= SMALL_MS : ruleError(rule, s, recent) <= biasTolerance(s.b);
}

export class BlendBiasLearner {
  private samples: BiasSample[];
  private trustedUses = 0;
  /** Checks of the trusted rule passed in a row. */
  private passed = 0;

  constructor(
    samples: BiasSample[] = [],
    private readonly onChange?: (samples: BiasSample[]) => void,
  ) {
    this.samples = samples.slice(-KEEP);
  }

  get count() {
    return this.samples.length;
  }

  /** What the latest few measurements say the error is (their middle value), or null before the first one. */
  recentBias(): number | null {
    return this.recentBefore(this.samples.length);
  }

  /** The same, going by the measurements before number `index` only: what it would have said just before it. */
  private recentBefore(index: number): number | null {
    const before = this.samples.slice(Math.max(0, index - RECENT), index);
    return before.length ? middleOf(before.map((s) => s.b)) : null;
  }

  record(sample: BiasSample) {
    const trusted = this.trustedRule();
    this.passed = trusted && ruleIsRight(trusted, sample, this.recentBias()) ? this.passed + 1 : 0;
    this.samples.push(sample);
    if (this.samples.length > KEEP) this.samples.splice(0, this.samples.length - KEEP);
    this.onChange?.([...this.samples]);
  }

  /** The way of working out the error that was right on the last few measurements, or null while none has been. */
  trustedRule(): BiasRule | null {
    const start = this.samples.length - NEED;
    if (start < 0) return null;
    const latest = this.samples.slice(start).map((s, i) => ({ s, recent: this.recentBefore(start + i) }));
    // Nothing to take off, when that has been right: the simplest answer wins.
    if (latest.every(({ s, recent }) => ruleIsRight('none', s, recent))) return 'none';
    let best: BiasRule | null = null;
    let bestError = Infinity;
    for (const rule of RULES) {
      if (!latest.every(({ s, recent }) => ruleIsRight(rule, s, recent))) continue;
      const error = Math.max(...latest.map(({ s, recent }) => ruleError(rule, s, recent)));
      if (error < bestError) {
        best = rule;
        bestError = error;
      }
    }
    return best;
  }

  /**
   * What to do for the next blend: "measure" it (pause and resume the music a few seconds in, and learn from it), or
   * "trust" the rule that has been right lately and leave the music alone. A trusted rule is checked again every
   * few blends (less often each time it passes).
   */
  plan(): 'measure' | 'trust' {
    if (!this.trustedRule() || this.trustedUses >= CHECK_AFTER[Math.min(this.passed, CHECK_AFTER.length - 1)]) {
      this.trustedUses = 0;
      return 'measure';
    }
    this.trustedUses++;
    return 'trust';
  }

  /** A short line for the timing report. */
  describe(): string {
    const rule = this.trustedRule();
    const list = this.samples.map((s) => `${(s.b / 1000).toFixed(1)}(first ${(s.first / 1000).toFixed(1)}, old ${(s.old / 1000).toFixed(1)})`);
    const recent = this.recentBias();
    return `trusted=${rule ?? 'none yet'} recent=${recent === null ? 'n/a' : (recent / 1000).toFixed(1)}s measured=[${list.join(' ')}]`;
  }
}

const STORE_KEY = 'ls.blendBias.v1';

/** What an earlier run learned, if the browser kept it. */
export function loadBiasSamples(): BiasSample[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s) => s && [s.b, s.first, s.old].every((n) => typeof n === 'number' && Number.isFinite(n)))
      .map((s) => ({ b: s.b, first: s.first, old: s.old }));
  } catch {
    return [];
  }
}

export function saveBiasSamples(samples: BiasSample[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(samples));
  } catch {
    /* storage blocked: it just won't be remembered */
  }
}
