import { extname } from 'node:path';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import type { TableRef, ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';

/**
 * One in-memory DuckDB database per session (docs/04-MODULES.md M2). `locked`
 * tracks whether `SET enable_external_access = false` has run: once true, it
 * can never go back to false (DuckDB does not allow re-enabling it), and
 * `registerFile` refuses further direct file reads. `query()` (the only
 * agent-facing execution path) locks the session automatically on its first
 * call, so untrusted SQL can never run while file/network access is open.
 */
export type DuckDBSession = {
  readonly id: string;
  readonly connection: DuckDBConnection;
  readonly instance: DuckDBInstance;
  locked: boolean;
};

export async function createSession(sessionId: string): Promise<DuckDBSession> {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  return { id: sessionId, connection, instance, locked: false };
}

export function closeSession(session: DuckDBSession): void {
  session.connection.closeSync();
  session.instance.closeSync();
}

/**
 * Disables DuckDB's own filesystem and network access for this session. A
 * one-way switch: once called, no further `registerFile` calls will succeed
 * on this session. Called automatically by `query()`; exposed here so the
 * ingestion pipeline can call it explicitly once all known files are loaded.
 */
export async function disableExternalAccess(session: DuckDBSession): Promise<void> {
  if (session.locked) return;
  await session.connection.run('SET enable_external_access = false');
  session.locked = true;
}

const READERS: Record<string, (escapedPath: string) => string> = {
  '.csv': (p) => `read_csv_auto('${p}')`,
  '.json': (p) => `read_json_auto('${p}')`,
  '.xlsx': (p) => `'${p}'`, // the excel extension's replacement scan handles this directly
  '.parquet': (p) => `'${p}'`,
};

/**
 * Registers a CSV, XLSX, JSON or Parquet file as a DuckDB table, reading it
 * directly rather than parsing it in Node first (docs/04-MODULES.md M2).
 * Internal ingestion plumbing only: never exposed to the agent, which only
 * ever sees table names already registered here.
 */
export async function registerFile(
  session: DuckDBSession,
  path: string,
  tableName: string,
): Promise<ToolResult<TableRef>> {
  if (session.locked) {
    return fail(
      'QUERY_INVALID',
      'Cannot register a new file: this session already locked down external file access after running a query.',
      { suggestion: 'Register every known file before the first query, or start a new session.' },
    );
  }

  const ext = extname(path).toLowerCase();
  const reader = READERS[ext];
  if (!reader) {
    return fail('UNSUPPORTED_FORMAT', `registerFile does not read "${ext || 'this file'}" directly.`, {
      suggestion: 'Only .csv, .xlsx, .json and .parquet can be registered directly.',
    });
  }

  const escapedPath = path.replace(/'/g, "''");
  const quotedTable = quoteIdent(tableName);

  try {
    await session.connection.run(`CREATE TABLE ${quotedTable} AS SELECT * FROM ${reader(escapedPath)}`);

    const summary = await session.connection.runAndReadAll(`SUMMARIZE ${quotedTable}`);
    const summaryRows = summary.getRowObjectsJson() as Record<string, string | number | null>[];

    const columns = summaryRows.map((row) => ({
      name: String(row.column_name),
      type: String(row.column_type),
      nullRate: Number(row.null_percentage ?? 0) / 100,
    }));

    const countResult = await session.connection.runAndReadAll(`SELECT COUNT(*) AS n FROM ${quotedTable}`);
    const rowCount = Number(countResult.getRowObjectsJson()[0]?.n ?? 0);

    return ok({ tableName, rowCount, columns, qualityWarnings: [] });
  } catch (err) {
    return fail('PARSE_FAILED', `Could not register "${path}" as a table: ${(err as Error).message}`, {
      recoverable: false,
    });
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
