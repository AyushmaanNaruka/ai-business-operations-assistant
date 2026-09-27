import { extname } from 'node:path';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import type { TableRef, ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';

/**
 * One in-memory DuckDB database per session (docs/04-MODULES.md M2). `locked`
 * tracks whether `SET enable_external_access = false` has run: once true, it
 * can never go back to false (DuckDB does not allow re-enabling it). `query()`
 * (the only agent-facing execution path) locks the session automatically on
 * its first call, so untrusted SQL can never run while file/network access is
 * open. Registration still works after the lock (D-64).
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
 * one-way switch. Called automatically by `query()`; exposed so a caller can
 * lock a session before handing it to anything untrusted.
 */
export async function disableExternalAccess(session: DuckDBSession): Promise<void> {
  if (session.locked) return;
  await session.connection.run('SET enable_external_access = false');
  session.locked = true;
}

/**
 * Which part of a workbook to read. Unset reads the first sheet from its first
 * non-empty row, exactly as the excel extension's replacement scan does. `sheet`
 * names another sheet; `range` (e.g. "A3:F120") pins the header row and the data
 * block when a sheet has a title above its header. Ignored for non-xlsx files.
 */
export type RegisterFileOptions = { sheet?: string; range?: string };

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const READERS: Record<string, (escapedPath: string, options: RegisterFileOptions) => string> = {
  '.csv': (p) => `read_csv_auto('${p}')`,
  '.json': (p) => `read_json_auto('${p}')`,
  '.xlsx': (p, { sheet, range }) => {
    // the excel extension's replacement scan handles the default case directly
    if (sheet === undefined && range === undefined) return `'${p}'`;
    const args = [`'${p}'`];
    if (sheet !== undefined) args.push(`sheet = ${sqlString(sheet)}`);
    if (range !== undefined) args.push(`range = ${sqlString(range)}`, 'header = true');
    return `read_xlsx(${args.join(', ')})`;
  },
  '.parquet': (p) => `'${p}'`,
};

/**
 * Registers a CSV, XLSX, JSON or Parquet file as a DuckDB table using DuckDB's
 * own readers rather than parsing it in Node (docs/04-MODULES.md M2). One call
 * registers one table: a workbook with several sheets is registered one sheet
 * per call, through `options.sheet`.
 * Internal ingestion plumbing only: never exposed to the agent, which only
 * ever sees table names already registered here.
 *
 * The file is read by a short-lived loader instance that only ever runs this
 * function's fixed SQL, and its rows are appended into the session. The
 * session itself never reads the file, so this works the same before and
 * after `query()` has locked it (D-64).
 */
export async function registerFile(
  session: DuckDBSession,
  path: string,
  tableName: string,
  options: RegisterFileOptions = {},
): Promise<ToolResult<TableRef>> {
  const ext = extname(path).toLowerCase();
  const reader = READERS[ext];
  if (!reader) {
    return fail('UNSUPPORTED_FORMAT', `registerFile does not read "${ext || 'this file'}" directly.`, {
      suggestion: 'Only .csv, .xlsx, .json and .parquet can be registered directly.',
    });
  }

  const escapedPath = path.replace(/'/g, "''");
  const quotedTable = quoteIdent(tableName);

  let loader: DuckDBInstance | undefined;
  let loaderConnection: DuckDBConnection | undefined;
  let created = false;
  try {
    loader = await DuckDBInstance.create(':memory:');
    loaderConnection = await loader.connect();
    await loaderConnection.run(`CREATE TABLE staged AS SELECT * FROM ${reader(escapedPath, options)}`);

    const described = await loaderConnection.runAndReadAll('DESCRIBE staged');
    const columnDefs = (described.getRowObjectsJson() as Record<string, string>[])
      .map((row) => `${quoteIdent(String(row.column_name))} ${String(row.column_type)}`)
      .join(', ');
    await session.connection.run(`CREATE TABLE ${quotedTable} (${columnDefs})`);
    created = true;

    const appender = await session.connection.createAppender(tableName);
    const rows = await loaderConnection.run('SELECT * FROM staged');
    for (let chunk = await rows.fetchChunk(); chunk && chunk.rowCount > 0; chunk = await rows.fetchChunk()) {
      appender.appendDataChunk(chunk);
    }
    appender.closeSync();

    const summary = await summarizeTable(session, tableName);
    return ok(summary);
  } catch (err) {
    if (created) await session.connection.run(`DROP TABLE IF EXISTS ${quotedTable}`).catch(() => undefined);
    return fail('PARSE_FAILED', `Could not register "${path}" as a table: ${(err as Error).message}`, {
      recoverable: false,
    });
  } finally {
    loaderConnection?.closeSync();
    loader?.closeSync();
  }
}

/**
 * Reads DuckDB's own `SUMMARIZE` and row count for an already-created table.
 * Shared by `registerFile` (M1 tabular ingestion) and `registerRows` (M1
 * document table extraction, P3.2): both need the same column/null-rate
 * shape, and only DuckDB's own accounting is trusted for it (rule 1).
 */
export async function summarizeTable(session: DuckDBSession, tableName: string): Promise<TableRef> {
  const quotedTable = quoteIdent(tableName);

  const summary = await session.connection.runAndReadAll(`SUMMARIZE ${quotedTable}`);
  const summaryRows = summary.getRowObjectsJson() as Record<string, string | number | null>[];

  const columns = summaryRows.map((row) => ({
    name: String(row.column_name),
    type: String(row.column_type),
    nullRate: Number(row.null_percentage ?? 0) / 100,
  }));

  const countResult = await session.connection.runAndReadAll(`SELECT COUNT(*) AS n FROM ${quotedTable}`);
  const rowCount = Number(countResult.getRowObjectsJson()[0]?.n ?? 0);

  return { tableName, rowCount, columns, qualityWarnings: [] };
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
