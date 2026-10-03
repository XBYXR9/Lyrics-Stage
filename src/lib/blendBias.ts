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
// Each measurement is kept next to the two guesses made when the blend was seen:
//   "first-report": the position Spotify gave for the new song when it showed up
//                   (less the time since the switch): the new song started that far in
//   "old-song":     how much of the old song was left when it was replaced
// When one guess has been right on the last two blends, the app uses it and stops
// pausing the music (it still measures again now and then, to check, less and less often).

/** One measurement: the real error `b` (ms) and the two guesses that were made for that blend. */
export interface BiasSample {
  b: number;
  first: number;
  old: number;
}

export type BiasRule = 'none' | 'first-report' | 'old-song';

/** How many measurements are kept. */
const KEEP = 8;
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

/** What a rule says the error is, from the two guesses made when the blend was seen. */
export function ruleValue(rule: BiasRule, guesses: { first: number; old: number }): number {
  if (rule === 'first-report') return guesses.first;
  if (rule === 'old-song') return guesses.old;
  return 0;
}

const RULES: BiasRule[] = ['none', 'first-report', 'old-song'];

function ruleError(rule: BiasRule, s: BiasSample): number {
  return rule === 'none' ? Math.abs(s.b) : Math.abs(ruleValue(rule, s) - s.b);
}

function ruleIsRight(rule: BiasRule, s: BiasSample): boolean {
  return rule === 'none' ? Math.abs(s.b) <= SMALL_MS : ruleError(rule, s) <= biasTolerance(s.b);
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

  record(sample: BiasSample) {
    const trusted = this.trustedRule();
    this.passed = trusted && ruleIsRight(trusted, sample) ? this.passed + 1 : 0;
    this.samples.push(sample);
    if (this.samples.length > KEEP) this.samples.splice(0, this.samples.length - KEEP);
    this.onChange?.([...this.samples]);
  }

  /** The way of working out the error that was right on the last few measurements, or null while none has been. */
  trustedRule(): BiasRule | null {
    const recent = this.samples.slice(-NEED);
    if (recent.length < NEED) return null;
    let best: BiasRule | null = null;
    let bestError = Infinity;
    for (const rule of RULES) {
      if (!recent.every((s) => ruleIsRight(rule, s))) continue;
      const error = Math.max(...recent.map((s) => ruleError(rule, s)));
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
    return `trusted=${rule ?? 'none yet'} measured=[${list.join(' ')}]`;
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
