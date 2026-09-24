import type { Evidence } from '@/types/evidence';
import type { Finding } from '@/types/finding';
import { EvidenceIdSchema, FindingIdSchema, PLAN_SCHEMAS, type ArtifactPlanKind } from './schemas';

/**
 * The house rules the schemas cannot express, applied after a plan has already parsed
 * (docs/03-ARCHITECTURE.md 4.2 step 5, docs/04-MODULES.md M6). A schema can enforce
 * shape: how many slides, whether a formula starts with "=", whether isJudgment is set
 * when evidenceIds is empty. It cannot check that an evidence id actually exists in
 * this run's ledger, that a chart's numbers match the evidence it cites, or that a
 * string is "TBD" rather than real content, because none of that is visible from the
 * plan object alone; it needs the gathered evidence and findings as context. That is
 * exactly the `context` parameter below, and exactly why this function exists
 * separately from the schemas in `./schemas`.
 *
 * Design decisions worth calling out because they are not obvious from the code:
 *
 * - **Why validatePlan does not scan for stray numbers in prose.** Every element that is
 *   inherently numeric already requires `evidenceIds` at the schema level:
 *   `ChartDataPointSchema`, calculation cells, channel mix, budget lines, and headline
 *   stats all carry `.min(1)` on `evidenceIds`. Walking free text for digits on top of
 *   that would flag a week number ("week 3"), a slide count, or a plain date as an
 *   ungrounded figure, which is a false positive, not a caught mistake. The schema
 *   already put the burden of proof on the author for every place a number is meant to
 *   be a claim; this function does not duplicate that by re-deriving "is this string a
 *   number" from scratch.
 *
 * - **Chart tolerance.** A chart value is accepted if it is within an absolute tolerance
 *   of 0.01 or a relative tolerance of 1 percent, whichever is larger. Absolute alone
 *   would reject a legitimate rounding difference on a large number (a revenue figure
 *   rounded to the nearest dollar against a evidence value carried to more decimal
 *   places); relative alone would reject a legitimate rounding difference on a number
 *   near zero (a 0.001 conversion-rate delta). Taking the larger of the two covers both
 *   ends of the range this system's numbers actually span.
 *
 * - **Silent skip when no cited evidence is numeric.** If every evidence id a chart
 *   point cites turns out to have a non numeric `value` (a document quote, a
 *   qualitative claim), the numeric check is skipped rather than failed, because rule
 *   (a) (evidence id existence) already covers whether the citation is grounded at all.
 *   Failing a numeric comparison against evidence that was never a number would be
 *   testing something the author never claimed.
 */
export function validatePlan(
  plan: unknown,
  kind: ArtifactPlanKind,
  context: { evidence: Evidence[]; findings: Finding[] },
): string[] {
  const schema = PLAN_SCHEMAS[kind];
  const parsed = schema.safeParse(plan);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`);
  }

  const evidenceById = new Map(context.evidence.map((e) => [e.id, e] as const));
  const findingById = new Map(context.findings.map((f) => [f.id, f] as const));

  const errors: string[] = [];
  walk(parsed.data, 'plan', undefined, evidenceById, findingById, errors);

  // Deduplicate while preserving first-seen order (Set iterates in insertion order),
  // so the same missing id referenced from two different places is still reported
  // once per location, but an identical error string is never repeated.
  return Array.from(new Set(errors));
}

/** Builds a "plan.findings[2].statement" style path from a Zod issue's raw path segments. */
function formatPath(path: ReadonlyArray<string | number | symbol>): string {
  let out = 'plan';
  for (const segment of path) {
    out += typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Keys whose string value is a code, not prose, so the placeholder/empty text check
 * (rule d) does not apply to it: an id, a chart or table `kind`, or a controlled
 * vocabulary field like `confidence`. Matched in addition to the id-shape check below,
 * which catches the same values structurally wherever they appear (an `evidenceIds`
 * array element, for instance, has no key of its own worth naming here).
 */
const EXEMPT_LEAF_KEYS = new Set(['id', 'evidenceId', 'findingId', 'kind', 'confidence']);

const PLACEHOLDER_SUBSTRINGS = ['tbd', 'todo', 'lorem ipsum', 'placeholder', 'insert here', 'xxx', 'coming soon'];

function isPlaceholderText(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  const lower = trimmed.toLowerCase();
  if (lower === 'n/a' || lower === '...') return true;
  return PLACEHOLDER_SUBSTRINGS.some((needle) => lower.includes(needle));
}

/** Coerces an Evidence.value to a number if it is one, or a string that parses to one cleanly. */
function toNumeric(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function withinTolerance(candidate: number, target: number): boolean {
  const tolerance = Math.max(0.01, Math.abs(target) * 0.01);
  return Math.abs(candidate - target) <= tolerance;
}

/** Structural duck-type for "this object is a ChartSpec", used during the generic tree walk. */
function looksLikeChartSpec(
  value: Record<string, unknown>,
): value is { title: unknown; data: Array<{ label: unknown; value: unknown; evidenceIds: unknown }> } {
  return (
    typeof value.kind === 'string' &&
    typeof value.title === 'string' &&
    Array.isArray(value.data) &&
    (value.data as unknown[]).every(
      (point) => isRecord(point) && typeof point.label === 'string' && 'value' in point && Array.isArray(point.evidenceIds),
    )
  );
}

function checkChartData(
  chart: { title: unknown; data: Array<{ label: unknown; value: unknown; evidenceIds: unknown }> },
  path: string,
  evidenceById: Map<string, Evidence>,
  errors: string[],
): void {
  const title = typeof chart.title === 'string' ? chart.title : '(untitled chart)';
  chart.data.forEach((point, i) => {
    if (typeof point.value !== 'number' || !Array.isArray(point.evidenceIds)) return;
    const cited = (point.evidenceIds as unknown[])
      .filter((id): id is string => typeof id === 'string')
      .map((id) => evidenceById.get(id))
      .filter((e): e is Evidence => e !== undefined);
    const numericCited = cited.map((e) => toNumeric(e.value)).filter((n): n is number => n !== undefined);
    if (numericCited.length === 0) return; // none of the cited evidence is a number; (a) already covers grounding
    const matches = numericCited.some((n) => withinTolerance(n, point.value as number));
    if (!matches) {
      const label = typeof point.label === 'string' ? point.label : `#${i}`;
      errors.push(
        `Chart "${title}" data point "${label}" value ${point.value as number} does not match any cited evidence value at ${path}.data[${i}].`,
      );
    }
  });
}

/**
 * Walks the parsed plan tree once, collecting every house-rule violation it finds:
 * evidence id existence (a), finding id existence (b), chart-data-matches-evidence (c),
 * and placeholder/empty text (d). `parentKey` is the property name `value` was found
 * under, which is how `evidenceIds` and `findingIds` arrays, and the singular
 * `findingId` field, are recognised regardless of which plan kind they appear in: this
 * is deliberately schema-agnostic, so `report.recommendations[].findingIds`,
 * `workbook.recommendations[].findingId`, and `plan.whyThisNowFindingIds` are all
 * covered by the same few lines rather than one branch per kind.
 */
function walk(
  value: unknown,
  path: string,
  parentKey: string | undefined,
  evidenceById: Map<string, Evidence>,
  findingById: Map<string, Finding>,
  errors: string[],
): void {
  if (Array.isArray(value)) {
    if (parentKey === 'evidenceIds' && value.length > 0) {
      value.forEach((id, i) => {
        if (typeof id === 'string' && !evidenceById.has(id)) {
          errors.push(`Evidence id ${id} referenced at ${path}[${i}] does not exist in the gathered evidence.`);
        }
      });
    }
    if (parentKey === 'findingIds' && value.length > 0) {
      value.forEach((id, i) => {
        if (typeof id === 'string' && !findingById.has(id)) {
          errors.push(`Finding id ${id} referenced at ${path}[${i}] does not exist in the gathered findings.`);
        }
      });
    }
    value.forEach((item, i) => walk(item, `${path}[${i}]`, undefined, evidenceById, findingById, errors));
    return;
  }

  if (isRecord(value)) {
    if (looksLikeChartSpec(value)) {
      checkChartData(value, path, evidenceById, errors);
    }

    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (key === 'findingId' && typeof child === 'string' && !findingById.has(child)) {
        errors.push(`Finding id ${child} referenced at ${childPath} does not exist in the gathered findings.`);
      }
      walk(child, childPath, key, evidenceById, findingById, errors);
    }
    return;
  }

  if (typeof value === 'string') {
    if (EXEMPT_LEAF_KEYS.has(parentKey ?? '')) return;
    if (EvidenceIdSchema.safeParse(value).success || FindingIdSchema.safeParse(value).success) return;
    if (value.trimStart().startsWith('=')) return; // a live formula, not prose
    if (isPlaceholderText(value)) {
      errors.push(`Placeholder or empty text at ${path}: "${value}"`);
    }
  }
}
