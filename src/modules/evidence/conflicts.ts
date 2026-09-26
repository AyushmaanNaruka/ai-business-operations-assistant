import type { Evidence, MetricKey } from '@/types';

export type Conflict = {
  metric: MetricKey;
  a: Evidence;
  b: Evidence;
};

function relativeDiff(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / denom;
}

// Two numbers count as "the same fact" up to this much disagreement, tuned
// per unit (docs/05-DATA-MODEL.md: "tolerance by unit"). A ratio (e.g. a
// conversion rate) uses an absolute percentage-point tolerance, since a
// relative comparison would treat 1% vs 2% (double!) as noise.
const CONFLICTS: Record<MetricKey['unit'], (a: number, b: number) => boolean> = {
  ratio: (a, b) => Math.abs(a - b) > 0.01,
  currency: (a, b) => relativeDiff(a, b) > 0.05,
  count: (a, b) => relativeDiff(a, b) > 0.05,
  duration: (a, b) => relativeDiff(a, b) > 0.05,
};

// A "_rank" name holds a position (1 = best), so any difference is a
// disagreement; the count unit's 5% tolerance would call rank 20 and 21 equal.
function isRank(metric: MetricKey): boolean {
  return normalise(metric.name).endsWith('_rank');
}

function normalise(part: string): string {
  return part
    .trim()
    .toLowerCase()
    .replace(/\s*=\s*/g, '=')
    .replace(/[\s-]+/g, '_');
}

function metricKeyId(metric: MetricKey): string {
  return `${normalise(metric.name)}::${normalise(metric.scope)}`;
}

// DuckDB hands some numeric types (DECIMAL, HUGEINT) back as digit strings, and
// models often pass a stated figure as "0.22" rather than 0.22.
export function numericValue(value: Evidence['value']): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?(e[+-]?\d+)?\s*$/i.test(value)) return Number(value);
  return undefined;
}

function disagree(metric: MetricKey, a: number, b: number): boolean {
  return isRank(metric) ? Math.round(a) !== Math.round(b) : CONFLICTS[metric.unit](a, b);
}

/**
 * Compares evidence entries with a matching `metric.name` + `metric.scope`
 * (case, spacing and hyphens normalised). Entries without a `metric`, or
 * without a numeric value, are never compared: code cannot tell whether a
 * quoted phrase agrees with a number. A qualitative ranking claim ("our
 * strongest channel") becomes comparable as a "_rank" metric, position 1,
 * against the SQL computed rank. A pair that disagrees is surfaced as a
 * Conflict with both sides; nothing is resolved or picked. docs/04-MODULES.md
 * M5.
 */
export function detectConflicts(evidence: Evidence[]): Conflict[] {
  const groups = new Map<string, { e: Evidence; metric: MetricKey; n: number }[]>();

  for (const e of evidence) {
    const n = numericValue(e.value);
    if (!e.metric || n === undefined) continue;
    const key = metricKeyId(e.metric);
    const group = groups.get(key) ?? [];
    group.push({ e, metric: e.metric, n });
    groups.set(key, group);
  }

  const conflicts: Conflict[] = [];

  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        if (disagree(a.metric, a.n, b.n)) conflicts.push({ metric: a.metric, a: a.e, b: b.e });
      }
    }
  }

  return conflicts;
}
