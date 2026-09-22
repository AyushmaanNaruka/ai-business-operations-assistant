import type { ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';
import { raceWithTimeout } from './raceWithTimeout';
import type { DuckDBSession } from './session';
import { disableExternalAccess } from './session';
import { validateSql } from './validateSql';
import { rowToJsonSafe, type QueryValue } from './values';

export type QueryResult = {
  rows: Record<string, QueryValue>[];
  sql: string;
  /** Number of rows actually returned in `rows` (after any truncation). */
  rowCount: number;
  /** True when more rows existed than `maxRows` allowed back. */
  truncated: boolean;
};

const DEFAULT_TIMEOUT_MS = Number(process.env.SQL_TIMEOUT_MS) || 15000;
const DEFAULT_MAX_ROWS = Number(process.env.SQL_MAX_ROWS) || 5000;

export type QueryOptions = {
  timeoutMs?: number;
  maxRows?: number;
};

/**
 * Runs a validated, read only query against the session's DuckDB database.
 * Locks down external file/network access on first use if it has not
 * happened yet (docs/04-MODULES.md M2), so no query ever runs with it open.
 * Every result carries its own SQL text back, which becomes `Evidence.method`.
 * Never throws.
 */
export async function query(session: DuckDBSession, sql: string, options: QueryOptions = {}): Promise<ToolResult<QueryResult>> {
  if (!session.locked) {
    await disableExternalAccess(session);
  }

  const validated = validateSql(sql);
  if (!validated.ok) return validated;

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;

  let outcome: Awaited<ReturnType<DuckDBSession['connection']['runAndReadUntil']>> | 'TIMEOUT';
  try {
    outcome = await raceWithTimeout(
      session.connection.runAndReadUntil(validated.data.sql, maxRows + 1),
      timeoutMs,
      () => session.connection.interrupt(),
    );
  } catch (err) {
    return fail('QUERY_INVALID', `SQL error: ${(err as Error).message}`, {
      suggestion: 'Check column and table names against describe_dataset, then retry.',
    });
  }

  if (outcome === 'TIMEOUT') {
    return fail('QUERY_TIMEOUT', `Query did not finish within ${timeoutMs}ms and was cancelled.`, {
      suggestion: 'Narrow the query: add a WHERE clause, reduce the date range, or aggregate more.',
    });
  }

  const objects = outcome.getRowObjectsJS();
  const truncated = objects.length > maxRows;
  const rows = (truncated ? objects.slice(0, maxRows) : objects).map(rowToJsonSafe);

  return ok({ rows, sql: validated.data.sql, rowCount: rows.length, truncated });
}
