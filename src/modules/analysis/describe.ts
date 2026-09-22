import type { ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';
import type { DuckDBSession } from './session';
import { rowToJsonSafe, type QueryValue } from './values';

export type ColumnProfile = {
  name: string;
  type: string;
  nullRate: number; // 0..1, computed over the full table by SUMMARIZE
  approxUnique: number | null;
  min: QueryValue;
  max: QueryValue;
  avg: number | null;
  std: number | null;
};

export type TableProfile = {
  tableName: string;
  rowCount: number;
  columns: ColumnProfile[];
  /** 20 rows for the agent to eyeball; not the basis for the checks below. */
  sample: Record<string, QueryValue>[];
  /** Exact count over the full table: rows - distinct rows. */
  duplicateRowCount: number;
  /** Columns whose name looks date-like, mapped to every date format found across ALL their values. */
  dateFormatsByColumn: Record<string, string[]>;
};

const DATE_FORMATS: { label: string; test: (v: string) => boolean }[] = [
  { label: 'ISO (YYYY-MM-DD)', test: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) },
  { label: 'US (MM/DD/YYYY)', test: (v) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v) },
  { label: 'text month (e.g. "March 5, 2025")', test: (v) => /^[A-Za-z]+ \d{1,2},? \d{4}$/.test(v) },
];

function looksLikeDateColumn(name: string): boolean {
  return /date/i.test(name);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Profiles a registered table: schema, null rates and summary stats over the
 * FULL table (via DuckDB's own SUMMARIZE, not the sample), an exact duplicate
 * row count, date format diversity per date-like column, and a 20 row sample
 * for the agent to eyeball. docs/04-MODULES.md M2.
 */
export async function describe(session: DuckDBSession, tableName: string): Promise<ToolResult<TableProfile>> {
  const quoted = quoteIdent(tableName);

  let summaryRows: Record<string, string | number | null>[];
  let rowCount: number;
  let sample: Record<string, QueryValue>[];
  let duplicateRowCount: number;

  try {
    const summary = await session.connection.runAndReadAll(`SUMMARIZE ${quoted}`);
    summaryRows = summary.getRowObjectsJson() as Record<string, string | number | null>[];

    const countResult = await session.connection.runAndReadAll(`SELECT COUNT(*) AS n FROM ${quoted}`);
    rowCount = Number(countResult.getRowObjectsJson()[0]?.n ?? 0);

    const sampleResult = await session.connection.runAndReadAll(`SELECT * FROM ${quoted} LIMIT 20`);
    sample = sampleResult.getRowObjectsJS().map(rowToJsonSafe);

    const distinctResult = await session.connection.runAndReadAll(
      `SELECT COUNT(*) AS n FROM (SELECT DISTINCT * FROM ${quoted})`,
    );
    const distinctCount = Number(distinctResult.getRowObjectsJson()[0]?.n ?? rowCount);
    duplicateRowCount = Math.max(0, rowCount - distinctCount);
  } catch (err) {
    return fail('SOURCE_NOT_FOUND', `Could not profile table "${tableName}": ${(err as Error).message}`, {
      suggestion: 'Call describe_dataset only on a table returned by list_datasets.',
    });
  }

  const columns: ColumnProfile[] = summaryRows.map((row) => ({
    name: String(row.column_name),
    type: String(row.column_type),
    nullRate: Number(row.null_percentage ?? 0) / 100,
    approxUnique: row.approx_unique == null ? null : Number(row.approx_unique),
    min: (row.min ?? null) as QueryValue,
    max: (row.max ?? null) as QueryValue,
    avg: row.avg == null ? null : Number(row.avg),
    std: row.std == null ? null : Number(row.std),
  }));

  const dateFormatsByColumn: Record<string, string[]> = {};
  try {
    for (const col of columns) {
      if (!looksLikeDateColumn(col.name) || !/VARCHAR|CHAR|TEXT/i.test(col.type)) continue;

      const valuesResult = await session.connection.runAndReadAll(
        `SELECT DISTINCT ${quoteIdent(col.name)} AS v FROM ${quoted} WHERE ${quoteIdent(col.name)} IS NOT NULL`,
      );
      const values = valuesResult.getRowObjectsJson().map((r) => String(r.v));

      const formatsSeen = new Set<string>();
      for (const value of values) {
        for (const format of DATE_FORMATS) {
          if (format.test(value)) formatsSeen.add(format.label);
        }
      }
      if (formatsSeen.size > 0) dateFormatsByColumn[col.name] = [...formatsSeen];
    }
  } catch (err) {
    return fail('SOURCE_NOT_FOUND', `Could not scan date columns on "${tableName}": ${(err as Error).message}`);
  }

  return ok({ tableName, rowCount, columns, sample, duplicateRowCount, dateFormatsByColumn });
}
