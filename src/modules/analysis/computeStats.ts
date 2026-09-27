import * as ss from 'simple-statistics';
import type { ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';
import { normalTwoSidedP, studentTTwoSidedP } from './distributions';
import type { QueryValue } from './values';

export type StatsOp =
  | { kind: 'linearRegression'; xColumn: string; yColumn: string }
  | { kind: 'correlation'; columnA: string; columnB: string }
  | { kind: 'tTestTwoSample'; valueColumn: string; groupColumn: string; groupA: string; groupB: string }
  | { kind: 'smallSample'; clicksColumn: string; conversionsColumn: string; labelColumn?: string }
  | {
      kind: 'twoProportionZTest';
      successesColumn: string;
      trialsColumn: string;
      groupColumn: string;
      groupA: string;
      groupB: string;
    };

export type StatsResult =
  | { kind: 'linearRegression'; slope: number; intercept: number; rSquared: number; n: number }
  | { kind: 'correlation'; r: number; n: number }
  | {
      kind: 'tTestTwoSample';
      method: 'welch';
      t: number | null;
      df: number | null;
      pValue: number | null;
      meanA: number;
      meanB: number;
      nA: number;
      nB: number;
    }
  | { kind: 'smallSample'; rows: SmallSampleRow[] }
  | ({ kind: 'twoProportionZTest' } & TwoProportionZTest);

export type TwoProportionZTest = {
  z: number | null;
  pValue: number | null;
  significantAt05: boolean | null;
  rateA: number;
  rateB: number;
  pooledRate: number;
  successesA: number;
  trialsA: number;
  successesB: number;
  trialsB: number;
};

export type SmallSampleRow = {
  label: string;
  clicks: number;
  conversions: number;
  rate: number | null;
  reportable: boolean;
  reason?: string;
};

// Below these, a computed rate is noise, not a result. docs/03-ARCHITECTURE.md
// section 3.4 / skills/campaign-analytics: flag small samples, never report
// them as a winner.
const MIN_CLICKS = 100;
const MIN_CONVERSIONS = 30;

type Row = Record<string, QueryValue>;

function toNumber(value: QueryValue): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function numericColumn(rows: Row[], column: string): number[] {
  return rows.map((row) => toNumber(row[column])).filter((v): v is number => v !== null);
}

function pairedColumns(rows: Row[], xColumn: string, yColumn: string): [number, number][] {
  const pairs: [number, number][] = [];
  for (const row of rows) {
    const x = toNumber(row[xColumn]);
    const y = toNumber(row[yColumn]);
    if (x !== null && y !== null) pairs.push([x, y]);
  }
  return pairs;
}

/** A group label matches whether DuckDB returned it as a string or a number. */
function sameGroup(value: QueryValue | undefined, group: string): boolean {
  return value !== null && value !== undefined && String(value) === group;
}

/**
 * Welch's unequal variance t test: t, Welch-Satterthwaite degrees of freedom and the
 * two sided p value. With equal group sizes t equals the pooled variance t. t, df and
 * pValue are null when a group has fewer than two values or both have zero variance.
 */
export function welchTTest(sampleA: number[], sampleB: number[]) {
  const meanA = ss.mean(sampleA);
  const meanB = ss.mean(sampleB);
  const base = { method: 'welch' as const, meanA, meanB, nA: sampleA.length, nB: sampleB.length };
  if (sampleA.length < 2 || sampleB.length < 2) return { ...base, t: null, df: null, pValue: null };
  const seA = ss.sampleVariance(sampleA) / sampleA.length;
  const seB = ss.sampleVariance(sampleB) / sampleB.length;
  if (seA + seB === 0) return { ...base, t: null, df: null, pValue: null };
  const t = (meanA - meanB) / Math.sqrt(seA + seB);
  const df = (seA + seB) ** 2 / (seA ** 2 / (sampleA.length - 1) + seB ** 2 / (sampleB.length - 1));
  return { ...base, t, df, pValue: studentTTwoSidedP(t, df) };
}

/**
 * Pooled two proportion z test, the right test for two conversion rates built from
 * summed conversions over summed clicks. z and pValue are null when the pooled rate
 * is 0 or 1, where there is no variance to test against.
 */
export function twoProportionZTest(
  successesA: number,
  trialsA: number,
  successesB: number,
  trialsB: number,
): TwoProportionZTest {
  const rateA = successesA / trialsA;
  const rateB = successesB / trialsB;
  const pooledRate = (successesA + successesB) / (trialsA + trialsB);
  const variance = pooledRate * (1 - pooledRate) * (1 / trialsA + 1 / trialsB);
  const base = { rateA, rateB, pooledRate, successesA, trialsA, successesB, trialsB };
  if (!(variance > 0)) return { ...base, z: null, pValue: null, significantAt05: null };
  const z = (rateA - rateB) / Math.sqrt(variance);
  const pValue = normalTwoSidedP(z);
  return { ...base, z, pValue, significantAt05: pValue < 0.05 };
}

/**
 * Wraps simple-statistics over rows from a query() result, so the Data
 * Analyst never attempts a regression or significance test in SQL.
 * docs/04-MODULES.md M2. Never throws.
 */
export function computeStats(rows: Row[], op: StatsOp): ToolResult<StatsResult> {
  switch (op.kind) {
    case 'linearRegression': {
      const pairs = pairedColumns(rows, op.xColumn, op.yColumn);
      if (pairs.length < 2) {
        return fail('NO_DATA', `Not enough numeric (${op.xColumn}, ${op.yColumn}) pairs to fit a trend line.`, {
          suggestion: 'Need at least two rows with non-null numeric values in both columns.',
        });
      }
      const { m: slope, b: intercept } = ss.linearRegression(pairs);
      const line = ss.linearRegressionLine({ m: slope, b: intercept });
      const rSquared = ss.rSquared(pairs, line);
      return ok({ kind: 'linearRegression', slope, intercept, rSquared, n: pairs.length });
    }

    case 'correlation': {
      const a: number[] = [];
      const b: number[] = [];
      for (const row of rows) {
        const va = toNumber(row[op.columnA]);
        const vb = toNumber(row[op.columnB]);
        if (va !== null && vb !== null) {
          a.push(va);
          b.push(vb);
        }
      }
      if (a.length < 2) {
        return fail('NO_DATA', `Not enough numeric (${op.columnA}, ${op.columnB}) pairs to correlate.`, {
          suggestion: 'Need at least two rows with non-null numeric values in both columns.',
        });
      }
      return ok({ kind: 'correlation', r: ss.sampleCorrelation(a, b), n: a.length });
    }

    case 'tTestTwoSample': {
      const sampleA = numericColumn(
        rows.filter((row) => sameGroup(row[op.groupColumn], op.groupA)),
        op.valueColumn,
      );
      const sampleB = numericColumn(
        rows.filter((row) => sameGroup(row[op.groupColumn], op.groupB)),
        op.valueColumn,
      );
      if (sampleA.length === 0 || sampleB.length === 0) {
        return fail(
          'NO_DATA',
          `Need at least one numeric "${op.valueColumn}" value in each of "${op.groupA}" and "${op.groupB}".`,
        );
      }
      return ok({ kind: 'tTestTwoSample', ...welchTTest(sampleA, sampleB) });
    }

    case 'twoProportionZTest': {
      const totals = (group: string) => {
        let successes = 0;
        let trials = 0;
        for (const row of rows) {
          if (!sameGroup(row[op.groupColumn], group)) continue;
          successes += toNumber(row[op.successesColumn]) ?? 0;
          trials += toNumber(row[op.trialsColumn]) ?? 0;
        }
        return { successes, trials };
      };
      const a = totals(op.groupA);
      const b = totals(op.groupB);
      if (a.trials <= 0 || b.trials <= 0) {
        return fail('NO_DATA', `Need a positive "${op.trialsColumn}" total in each of "${op.groupA}" and "${op.groupB}".`, {
          suggestion: 'Check the group labels match the values in the group column exactly.',
        });
      }
      if (a.successes < 0 || b.successes < 0 || a.successes > a.trials || b.successes > b.trials) {
        return fail(
          'QUERY_INVALID',
          `"${op.successesColumn}" must be between 0 and "${op.trialsColumn}" in each group, e.g. conversions and clicks.`,
        );
      }
      return ok({ kind: 'twoProportionZTest', ...twoProportionZTest(a.successes, a.trials, b.successes, b.trials) });
    }

    case 'smallSample': {
      if (rows.length === 0) {
        return fail('NO_DATA', 'No rows to check for small sample size.');
      }
      const result = rows.map((row, index): SmallSampleRow => {
        const clicks = toNumber(row[op.clicksColumn]) ?? 0;
        const conversions = toNumber(row[op.conversionsColumn]) ?? 0;
        const label = op.labelColumn ? String(row[op.labelColumn] ?? `row ${index + 1}`) : `row ${index + 1}`;
        const rate = clicks > 0 ? conversions / clicks : null;

        const reasons: string[] = [];
        if (clicks < MIN_CLICKS) reasons.push(`only ${clicks} clicks (need ${MIN_CLICKS}+)`);
        if (conversions < MIN_CONVERSIONS) reasons.push(`only ${conversions} conversions (need ${MIN_CONVERSIONS}+)`);

        return {
          label,
          clicks,
          conversions,
          rate,
          reportable: reasons.length === 0,
          ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
        };
      });
      return ok({ kind: 'smallSample', rows: result });
    }
  }
}
