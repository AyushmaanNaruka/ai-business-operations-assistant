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

function metricKeyId(metric: MetricKey): string {
  return `${metric.name}::${metric.scope}`;
}

/**
 * Compares evidence entries with a matching `metric.name` + `metric.scope`.
 * Entries without a `metric` are never compared (correct for prose claims).
 * A pair whose values differ beyond the unit's tolerance is surfaced as a
 * Conflict with both sides; nothing is resolved or picked. docs/04-MODULES.md
 * M5.
 */
export function detectConflicts(evidence: Evidence[]): Conflict[] {
  const groups = new Map<string, Evidence[]>();

  for (const e of evidence) {
    if (!e.metric) continue;
    const key = metricKeyId(e.metric);
    const group = groups.get(key) ?? [];
    group.push(e);
    groups.set(key, group);
  }

  const conflicts: Conflict[] = [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;

        if (typeof a.value === 'number' && typeof b.value === 'number') {
          if (CONFLICTS[a.metric!.unit](a.value, b.value)) conflicts.push({ metric: a.metric!, a, b });
          continue;
        }

        // A document quoting a qualitative claim (channel notes, a stated ranking)
        // against a computed number under the SAME metric key is exactly the
        // "the notes say strongest, the numbers disagree" case (P5.6, Scenario
        // Paid Social): there is no tolerance to apply to a claim with no number
        // in it, but the pairing itself is the thing rule 10 needs to see, so it
        // is surfaced as a Conflict rather than silently skipped like an
        // unrelated prose claim (which never shares a metric key at all).
        const oneNumericOneQualitative =
          (typeof a.value === 'number' && typeof b.value === 'string' && b.value.length > 0) ||
          (typeof b.value === 'number' && typeof a.value === 'string' && a.value.length > 0);
        if (oneNumericOneQualitative) conflicts.push({ metric: a.metric!, a, b });
      }
    }
  }

  return conflicts;
}
