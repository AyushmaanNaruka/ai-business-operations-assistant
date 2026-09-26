import type { TableRef, ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';
import type { DuckDBSession } from './session';
import { quoteIdent, summarizeTable } from './session';

/** A table already extracted from a document (docs/04-MODULES.md M1 table detection), ready to register. */
export type RowTable = {
  headers: string[];
  rows: string[][];
};

type SqlType = 'DOUBLE' | 'VARCHAR';
type ColumnPlan = { name: string; sqlType: SqlType; values: (number | string | null)[] };

/**
 * Registers a table whose data already lives in memory (a PDF or Word table,
 * as opposed to `registerFile`'s registered-from-disk tabular sources) as a
 * real DuckDB table, so it is queryable exactly like an uploaded spreadsheet.
 *
 * A column becomes DOUBLE only when every one of its cells contains an
 * extractable number ("$299/mo" -> 299); a single cell with no number at all
 * (an "N/A", a "Custom") falls the whole column back to VARCHAR rather than
 * silently dropping the information. This mirrors the tolerance the tabular
 * ingestion path already has for messy real files.
 */
export async function registerRows(session: DuckDBSession, tableName: string, table: RowTable): Promise<ToolResult<TableRef>> {
  if (table.rows.length === 0) {
    return fail('NO_DATA', `"${tableName}" has a header row but no data rows to register.`, { recoverable: false });
  }

  const columns = planColumns(table.headers, table.rows);
  const quotedTable = quoteIdent(tableName);
  const columnDefs = columns.map((c) => `${quoteIdent(c.name)} ${c.sqlType}`).join(', ');
  const valuesSql = table.rows
    .map((_, rowIndex) => `(${columns.map((c) => sqlLiteral(c.values[rowIndex] ?? null, c.sqlType)).join(', ')})`)
    .join(', ');

  try {
    await session.connection.run(`CREATE TABLE ${quotedTable} (${columnDefs})`);
    await session.connection.run(`INSERT INTO ${quotedTable} VALUES ${valuesSql}`);
    const summary = await summarizeTable(session, tableName);
    return ok(summary);
  } catch (err) {
    return fail('PARSE_FAILED', `Could not register table "${tableName}": ${(err as Error).message}`, {
      recoverable: false,
    });
  }
}

function planColumns(headers: string[], rows: string[][]): ColumnPlan[] {
  const seen = new Set<string>();
  return headers.map((header, colIndex) => {
    const name = toColumnName(header, colIndex, seen);
    const cells = rows.map((row) => row[colIndex] ?? '');
    const numbers = cells.map(extractNumber);
    if (numbers.every((n) => n !== null)) {
      return { name, sqlType: 'DOUBLE', values: numbers };
    }
    return { name, sqlType: 'VARCHAR', values: cells };
  });
}

function toColumnName(header: string, index: number, seen: Set<string>): string {
  const base = header.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `col_${index + 1}`;
  let name = base;
  let suffix = 2;
  while (seen.has(name)) name = `${base}_${suffix++}`;
  seen.add(name);
  return name;
}

/** Pulls the first number out of a cell, tolerating currency, tilde and percent formatting ("$3,000" -> 3000). */
function extractNumber(cell: string): number | null {
  const cleaned = cell.replace(/[$~%]/g, '');
  const match = cleaned.match(/\d[\d,]*(\.\d+)?/);
  if (!match) return null;
  const num = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(num) ? num : null;
}

function sqlLiteral(value: number | string | null, sqlType: SqlType): string {
  if (value === null) return 'NULL';
  if (sqlType === 'DOUBLE') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}
