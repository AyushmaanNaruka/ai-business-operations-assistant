import * as ss from 'simple-statistics';
import type { ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';
import type { QueryValue } from './values';

export type StatsOp =
  | { kind: 'linearRegression'; xColumn: string; yColumn: string }
  | { kind: 'correlation'; columnA: string; columnB: string }
  | { kind: 'tTestTwoSample'; valueColumn: string; groupColumn: string; groupA: string; groupB: string }
  | { kind: 'smallSample'; clicksColumn: string; conversionsColumn: string; labelColumn?: string };

export type StatsResult =
  | { kind: 'linearRegression'; slope: number; intercept: number; rSquared: number; n: number }
  | { kind: 'correlation'; r: number; n: number }
  | { kind: 'tTestTwoSample'; t: number | null; nA: number; nB: number }
  | { kind: 'smallSample'; rows: SmallSampleRow[] };

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
        rows.filter((row) => row[op.groupColumn] === op.groupA),
        op.valueColumn,
      );
      const sampleB = numericColumn(
        rows.filter((row) => row[op.groupColumn] === op.groupB),
        op.valueColumn,
      );
      if (sampleA.length === 0 || sampleB.length === 0) {
        return fail(
          'NO_DATA',
          `Need at least one numeric "${op.valueColumn}" value in each of "${op.groupA}" and "${op.groupB}".`,
        );
      }
      const t = ss.tTestTwoSample(sampleA, sampleB);
      return ok({ kind: 'tTestTwoSample', t, nA: sampleA.length, nB: sampleB.length });
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
