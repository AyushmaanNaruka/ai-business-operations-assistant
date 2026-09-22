import type { TableProfile } from './describe';
import type { QueryValue } from './values';

const NULL_RATE_THRESHOLD = 0.02;
const NUMERIC_TYPE = /INT|DOUBLE|DECIMAL|FLOAT|HUGEINT|NUMERIC/i;
const OUTLIER_STD_DEVIATIONS = 4;

/**
 * Turns a TableProfile (already computed over the full table, not a sample)
 * into plain language quality warnings a non technical person would
 * understand: high null rates, columns that are entirely empty or constant,
 * duplicate rows, mixed date formats, and implausible numeric outliers.
 * `sampleRows` is used only to attach a concrete example to an outlier
 * warning when one happens to be in the sample; every warning still fires
 * from `profile` alone if it is not. docs/04-MODULES.md M2 / P2.3.
 */
export function detectQualityIssues(
  profile: TableProfile,
  sampleRows: Record<string, QueryValue>[],
): string[] {
  const warnings: string[] = [];

  for (const col of profile.columns) {
    if (col.nullRate >= 1) {
      warnings.push(`"${col.name}" is entirely empty (every row is null).`);
      continue; // already the strongest possible null warning, do not also flag it as "mostly null"
    }
    if (col.nullRate > NULL_RATE_THRESHOLD) {
      const nullCount = Math.round(col.nullRate * profile.rowCount);
      warnings.push(
        `"${col.name}" is ${(col.nullRate * 100).toFixed(1)}% null (${nullCount} of ${profile.rowCount} rows).`,
      );
    }
    if (col.approxUnique !== null && col.approxUnique <= 1) {
      warnings.push(`"${col.name}" has the same value in every non-empty row (only one distinct value seen).`);
    }
  }

  if (profile.duplicateRowCount > 0) {
    const plural = profile.duplicateRowCount === 1 ? '' : 's';
    warnings.push(`${profile.duplicateRowCount} exact duplicate row${plural} found.`);
  }

  for (const [column, formats] of Object.entries(profile.dateFormatsByColumn)) {
    if (formats.length > 1) {
      warnings.push(`"${column}" mixes ${formats.length} different date formats: ${formats.join(', ')}.`);
    }
  }

  for (const col of profile.columns) {
    if (!NUMERIC_TYPE.test(col.type)) continue;
    if (col.avg === null || col.std === null || col.std === 0) continue;

    const max = typeof col.max === 'number' ? col.max : Number(col.max);
    if (!Number.isFinite(max)) continue;

    const deviations = (max - col.avg) / col.std;
    if (deviations <= OUTLIER_STD_DEVIATIONS) continue;

    const example = sampleRows.find((row) => row[col.name] === col.max);
    const exampleNote = example ? ` (see "${describeExampleRow(example)}")` : '';
    warnings.push(
      `"${col.name}" has an outlier: the highest value is ${formatNumber(max)}, versus an average of ` +
        `${formatNumber(col.avg)} (${deviations.toFixed(1)} standard deviations above the mean)${exampleNote}.`,
    );
  }

  return warnings;
}

function describeExampleRow(row: Record<string, QueryValue>): string {
  const nameKey = Object.keys(row).find((key) => /name|campaign/i.test(key));
  const value = nameKey ? row[nameKey] : undefined;
  return typeof value === 'string' ? value : 'one sample row';
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
