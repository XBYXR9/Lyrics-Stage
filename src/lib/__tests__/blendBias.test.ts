import { describe, expect, it } from 'vitest';
import { BlendBiasLearner, biasTolerance, loadBiasSamples, ruleValue, type BiasSample } from '../blendBias';

const sample = (b: number, first: number, old: number): BiasSample => ({ b, first, old });

describe('BlendBiasLearner', () => {
  it('trusts nothing until it has measured a couple of blends', () => {
    const l = new BlendBiasLearner();
    expect(l.trustedRule()).toBeNull();
    l.record(sample(6000, 6100, 6000));
    expect(l.trustedRule()).toBeNull();
    expect(l.plan()).toBe('measure');
    l.record(sample(5000, 5100, 5000));
    expect(l.trustedRule()).not.toBeNull();
  });

  it('trusts a rule that was right twice in a row', () => {
    const l = new BlendBiasLearner();
    l.record(sample(6000, 6100, 12000));
    l.record(sample(4500, 4400, 12000));
    expect(l.trustedRule()).toBe('first-report');
  });

  it('trusts the old-song guess when it has been right three times in a row', () => {
    const l = new BlendBiasLearner();
    // the new song started 8 s in, so the first report says far too much; what was left of the old song is right
    l.record(sample(6000, 14000, 6200));
    l.record(sample(4500, 12500, 4300));
    l.record(sample(7000, 15000, 7400));
    expect(l.trustedRule()).toBe('old-song');
  });

  it('trusts the first-report guess when the old song was cut short (Automix) and its remaining time says too much', () => {
    const l = new BlendBiasLearner();
    l.record(sample(6000, 6100, 12000));
    l.record(sample(4500, 4600, 12000));
    l.record(sample(7000, 6800, 12000));
    expect(l.trustedRule()).toBe('first-report');
  });

  it('trusts "no error" when the position was right every time', () => {
    const l = new BlendBiasLearner();
    for (let i = 0; i < 3; i++) l.record(sample(100 * i, 5000, 6000));
    expect(l.trustedRule()).toBe('none');
  });

  it('trusts nothing when no guess fits, and forgets a rule that stops fitting', () => {
    const l = new BlendBiasLearner();
    l.record(sample(6000, 6000, 6000));
    l.record(sample(6000, 6000, 6000));
    l.record(sample(6000, 6000, 6000));
    expect(l.trustedRule()).not.toBeNull();
    l.record(sample(2500, 6000, 6000)); // a measurement that no guess matches
    expect(l.trustedRule()).toBeNull();
    l.record(sample(9000, 1000, 2000));
    l.record(sample(1000, 5000, 3000));
    expect(l.trustedRule()).toBeNull();
  });

  it('measures every few blends even when a rule is trusted, to check it, and checks less and less often', () => {
    const l = new BlendBiasLearner();
    for (let i = 0; i < 2; i++) l.record(sample(6000, 6000, 12000));
    const plans = () => {
      const out: string[] = [];
      for (let i = 0; i < 40; i++) {
        const p = l.plan();
        out.push(p);
        if (p === 'measure') break;
      }
      return out;
    };
    // the first check comes after 2 blends, and passes...
    expect(plans()).toEqual(['trust', 'trust', 'measure']);
    l.record(sample(6100, 6100, 12000));
    // ...so the next comes after 4, then 8, then 16 (and never further apart than that)
    expect(plans()).toHaveLength(5);
    l.record(sample(5900, 5900, 12000));
    expect(plans()).toHaveLength(9);
    l.record(sample(6000, 6000, 12000));
    expect(plans()).toHaveLength(17);
    l.record(sample(6000, 6000, 12000));
    expect(plans()).toHaveLength(17);
  });

  it('goes back to checking soon after a check fails', () => {
    const l = new BlendBiasLearner();
    for (let i = 0; i < 2; i++) l.record(sample(6000, 6000, 12000));
    l.plan();
    l.plan();
    expect(l.plan()).toBe('measure');
    l.record(sample(6000, 6000, 12000)); // passes: the next check is further away
    for (let i = 0; i < 4; i++) expect(l.plan()).toBe('trust');
    expect(l.plan()).toBe('measure');
    l.record(sample(2000, 6000, 12000)); // fails: nothing is trusted, so every blend is measured again
    expect(l.trustedRule()).toBeNull();
    expect(l.plan()).toBe('measure');
    expect(l.plan()).toBe('measure');
  });

  it('allows a little more room for big errors, and never less than 0.8 s', () => {
    expect(biasTolerance(1000)).toBe(800);
    expect(biasTolerance(10000)).toBe(2000);
    expect(biasTolerance(-10000)).toBe(2000);
  });

  it('says what each rule predicts', () => {
    const g = { first: 6100, old: 12000 };
    expect(ruleValue('first-report', g)).toBe(6100);
    expect(ruleValue('old-song', g)).toBe(12000);
    expect(ruleValue('none', g)).toBe(0);
  });

  it('keeps only the latest measurements and tells the app when they change', () => {
    const seen: BiasSample[][] = [];
    const l = new BlendBiasLearner([], (s) => seen.push(s));
    for (let i = 0; i < 12; i++) l.record(sample(i, i, i));
    expect(l.count).toBe(8);
    expect(seen.at(-1)!.map((s) => s.b)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(l.describe()).toContain('trusted=');
  });

  it('survives a browser without storage', () => {
    expect(loadBiasSamples()).toEqual([]);
  });
});
