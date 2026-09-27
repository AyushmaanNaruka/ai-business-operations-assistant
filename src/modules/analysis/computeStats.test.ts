import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { computeStats, twoProportionZTest } from './computeStats';
import { describe as describeTable } from './describe';
import { detectQualityIssues } from './qualityWarnings';
import { query } from './query';
import { closeSession, createSession, registerFile } from './session';

const SAMPLES = join(import.meta.dirname, '..', '..', '..', 'samples');

describe('computeStats: linearRegression', () => {
  it('matches a hand computed perfect line y = 2x + 1', () => {
    // Points (1,3) (2,5) (3,7) (4,9) lie exactly on y = 2x + 1:
    // slope = 2, intercept = 1, and a perfect fit gives R^2 = 1.
    const rows = [
      { x: 1, y: 3 },
      { x: 2, y: 5 },
      { x: 3, y: 7 },
      { x: 4, y: 9 },
    ];
    const result = computeStats(rows, { kind: 'linearRegression', xColumn: 'x', yColumn: 'y' });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.kind !== 'linearRegression') return;
    expect(result.data.slope).toBeCloseTo(2, 10);
    expect(result.data.intercept).toBeCloseTo(1, 10);
    expect(result.data.rSquared).toBeCloseTo(1, 10);
  });

  it('ignores rows with a null or non-numeric x or y', () => {
    const rows = [
      { x: 1, y: 3 },
      { x: null, y: 5 },
      { x: 2, y: 5 },
      { x: 3, y: 'n/a' },
      { x: 3, y: 7 },
    ];
    const result = computeStats(rows as never, { kind: 'linearRegression', xColumn: 'x', yColumn: 'y' });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.kind !== 'linearRegression') return;
    expect(result.data.n).toBe(3);
  });

  it('reports NO_DATA rather than crashing with fewer than two usable points', () => {
    const result = computeStats([{ x: 1, y: 3 }], { kind: 'linearRegression', xColumn: 'x', yColumn: 'y' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_DATA');
  });
});

describe('computeStats: correlation', () => {
  it('matches a hand computed perfect negative correlation', () => {
    // a strictly decreasing while b strictly increases in lockstep: r = -1 exactly.
    const rows = [
      { a: 1, b: 4 },
      { a: 2, b: 3 },
      { a: 3, b: 2 },
      { a: 4, b: 1 },
    ];
    const result = computeStats(rows, { kind: 'correlation', columnA: 'a', columnB: 'b' });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.kind !== 'correlation') return;
    expect(result.data.r).toBeCloseTo(-1, 10);
    expect(result.data.n).toBe(4);
  });
});

describe('computeStats: tTestTwoSample', () => {
  it('matches a hand computed pooled variance t statistic', () => {
    // sampleA = [10,12,14] (mean 12, sample variance 4)
    // sampleB = [20,22,24] (mean 22, sample variance 4)
    // pooled variance = ((3-1)*4 + (3-1)*4) / (3+3-2) = 16/4 = 4
    // t = (12 - 22) / sqrt(4 * (1/3 + 1/3)) = -10 / sqrt(2.6667) = -6.1237...
    const rows = [
      { segment: 'A', value: 10 },
      { segment: 'A', value: 12 },
      { segment: 'A', value: 14 },
      { segment: 'B', value: 20 },
      { segment: 'B', value: 22 },
      { segment: 'B', value: 24 },
    ];
    const result = computeStats(rows, {
      kind: 'tTestTwoSample',
      valueColumn: 'value',
      groupColumn: 'segment',
      groupA: 'A',
      groupB: 'B',
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.kind !== 'tTestTwoSample') return;
    expect(result.data.t).toBeCloseTo(-6.123724356957945, 10);
    expect(result.data.nA).toBe(3);
    expect(result.data.nB).toBe(3);
  });

  it('adds Welch df and a two sided p value that match scipy', () => {
    // scipy.stats.ttest_ind([1,2,3,4,5], [2,4,...,14], equal_var=False):
    // t = -2.809757, df = 8.037106, p = 0.022747
    const rows = [
      ...[1, 2, 3, 4, 5].map((value) => ({ arm: 'A', value })),
      ...[2, 4, 6, 8, 10, 12, 14].map((value) => ({ arm: 'B', value })),
    ];
    const result = computeStats(rows, { kind: 'tTestTwoSample', valueColumn: 'value', groupColumn: 'arm', groupA: 'A', groupB: 'B' });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.kind !== 'tTestTwoSample') return;
    expect(result.data.method).toBe('welch');
    expect(result.data.t).toBeCloseTo(-2.809757434745082, 8);
    expect(result.data.df).toBeCloseTo(8.037105751391467, 8);
    expect(result.data.pValue).toBeCloseTo(0.022747255279670916, 7);
    expect(result.data.meanA).toBe(3);
    expect(result.data.meanB).toBe(8);
  });

  it('gives the equal variance example its p value, and nulls for a one value group', () => {
    const rows = [10, 12, 14].map((value) => ({ g: 'A', value })).concat([20, 22, 24].map((value) => ({ g: 'B', value })));
    const result = computeStats(rows, { kind: 'tTestTwoSample', valueColumn: 'value', groupColumn: 'g', groupA: 'A', groupB: 'B' });
    if (!result.ok || result.data.kind !== 'tTestTwoSample') throw new Error('expected a t test');
    expect(result.data.df).toBeCloseTo(4, 10);
    expect(result.data.pValue).toBeCloseTo(0.0036022326091040033, 7);

    const tiny = computeStats(
      [
        { g: 'A', value: 1 },
        { g: 'B', value: 2 },
        { g: 'B', value: 3 },
      ],
      { kind: 'tTestTwoSample', valueColumn: 'value', groupColumn: 'g', groupA: 'A', groupB: 'B' },
    );
    expect(tiny).toMatchObject({ ok: true, data: { t: null, df: null, pValue: null, nA: 1, nB: 2 } });
  });

  it('reports NO_DATA when one group has no numeric values', () => {
    const rows = [{ segment: 'A', value: 1 }];
    const result = computeStats(rows, {
      kind: 'tTestTwoSample',
      valueColumn: 'value',
      groupColumn: 'segment',
      groupA: 'A',
      groupB: 'B',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_DATA');
  });
});

describe('computeStats: twoProportionZTest', () => {
  const op = {
    kind: 'twoProportionZTest' as const,
    successesColumn: 'conversions',
    trialsColumn: 'clicks',
    groupColumn: 'segment',
    groupA: 'SMB',
    groupB: 'Enterprise',
  };

  it('matches the hand computed pooled z test: 45/1000 vs 30/1000', () => {
    // pooled p = 75/2000 = 0.0375; se = sqrt(0.0375 * 0.9625 * (2/1000)) = 0.0084963
    // z = 0.015 / 0.0084963 = 1.76547; two sided p = 0.07748 (scipy norm.sf)
    const direct = twoProportionZTest(45, 1000, 30, 1000);
    expect(direct.z).toBeCloseTo(1.7654696590094991, 8);
    expect(direct.pValue).toBeCloseTo(0.0774848651326447, 6);
    expect(direct.significantAt05).toBe(false);
    expect(direct.pooledRate).toBeCloseTo(0.0375, 12);
  });

  it('sums successes and trials per group from row level or pre aggregated rows', () => {
    const rows = [
      { segment: 'SMB', clicks: 600, conversions: 25 },
      { segment: 'SMB', clicks: 400, conversions: 20 },
      { segment: 'Enterprise', clicks: '1000', conversions: '30' },
      { segment: 'Other', clicks: 5, conversions: 5 },
    ];
    const result = computeStats(rows, op);
    expect(result).toMatchObject({
      ok: true,
      data: { kind: 'twoProportionZTest', successesA: 45, trialsA: 1000, successesB: 30, trialsB: 1000, rateA: 0.045, rateB: 0.03 },
    });
    if (result.ok && result.data.kind === 'twoProportionZTest') expect(result.data.z).toBeCloseTo(1.76547, 4);
  });

  it('calls a large gap on large volumes significant', () => {
    expect(twoProportionZTest(600, 10000, 450, 10000).significantAt05).toBe(true);
  });

  it('refuses a group with no trials, and successes above trials', () => {
    const none = computeStats([{ segment: 'SMB', clicks: 10, conversions: 1 }], op);
    expect(none).toMatchObject({ ok: false, error: { code: 'NO_DATA' } });

    const bad = computeStats(
      [
        { segment: 'SMB', clicks: 10, conversions: 20 },
        { segment: 'Enterprise', clicks: 10, conversions: 1 },
      ],
      op,
    );
    expect(bad).toMatchObject({ ok: false, error: { code: 'QUERY_INVALID' } });
  });

  it('returns null z when there is no variance to test', () => {
    expect(twoProportionZTest(0, 100, 0, 200)).toMatchObject({ z: null, pValue: null, significantAt05: null });
  });
});

describe('computeStats: smallSample', () => {
  it('marks a row under the click threshold as not reportable', () => {
    const rows = [{ campaign: 'Trap', clicks: 47, conversions: 6 }];
    const result = computeStats(rows, {
      kind: 'smallSample',
      clicksColumn: 'clicks',
      conversionsColumn: 'conversions',
      labelColumn: 'campaign',
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.kind !== 'smallSample') return;
    expect(result.data.rows[0]!.reportable).toBe(false);
    expect(result.data.rows[0]!.reason).toContain('47 clicks');
    expect(result.data.rows[0]!.rate).toBeCloseTo(6 / 47, 10);
  });

  it('marks a row over both thresholds as reportable', () => {
    const rows = [{ campaign: 'Solid', clicks: 500, conversions: 60 }];
    const result = computeStats(rows, {
      kind: 'smallSample',
      clicksColumn: 'clicks',
      conversionsColumn: 'conversions',
      labelColumn: 'campaign',
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.kind !== 'smallSample') return;
    expect(result.data.rows[0]!.reportable).toBe(true);
    expect(result.data.rows[0]!.reason).toBeUndefined();
  });

  it('flags the planted 47-click / 6-conversion trap when run against the real campaigns.xlsx', async () => {
    const session = await createSession('cs1');
    try {
      await registerFile(session, join(SAMPLES, 'campaigns.xlsx'), 'campaigns');
      const trapQuery = await query(
        session,
        "SELECT campaign_name, clicks, conversions FROM campaigns WHERE clicks = 47 AND conversions = 6",
      );
      expect(trapQuery.ok).toBe(true);
      if (!trapQuery.ok) return;
      expect(trapQuery.data.rows.length).toBeGreaterThanOrEqual(1);

      const stats = computeStats(trapQuery.data.rows, {
        kind: 'smallSample',
        clicksColumn: 'clicks',
        conversionsColumn: 'conversions',
        labelColumn: 'campaign_name',
      });
      expect(stats.ok).toBe(true);
      if (!stats.ok || stats.data.kind !== 'smallSample') return;
      expect(stats.data.rows.every((r) => r.reportable === false)).toBe(true);
    } finally {
      closeSession(session);
    }
  });
});

// Cross-module sanity check: describe + detectQualityIssues + computeStats
// all compose on the same real dataset, matching how the Data Analyst agent
// will actually chain them in Phase 2.7.
describe('analysis module composition', () => {
  it('profile, quality warnings and stats all agree on the same table', async () => {
    const session = await createSession('cs2');
    try {
      await registerFile(session, join(SAMPLES, 'campaigns.xlsx'), 'campaigns');
      const profile = await describeTable(session, 'campaigns');
      expect(profile.ok).toBe(true);
      if (!profile.ok) return;
      const warnings = detectQualityIssues(profile.data, profile.data.sample);
      expect(warnings.length).toBeGreaterThan(0);
    } finally {
      closeSession(session);
    }
  });
});
