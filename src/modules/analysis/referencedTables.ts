import type { ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';
import { disableExternalAccess, type DuckDBSession } from './session';

/** One table a query reads, as DuckDB's own parser saw it. CTE names appear here too. */
export type TableReference = { tableName: string; schemaName: string; catalogName: string };

export type ReferencedTables = {
  tables: TableReference[];
  /** Every table function in a FROM clause, e.g. "range", "duckdb_tables". */
  tableFunctions: string[];
  /**
   * SHOW / DESCRIBE refs that name their target directly instead of wrapping a
   * query: `SELECT * FROM (SHOW TABLES)` lands here as "tables". A DESCRIBE of a
   * real table wraps a query, so its table shows up in `tables` instead.
   */
  showTargets: string[];
};

type JsonNode = { [key: string]: unknown };

function isNode(value: unknown): value is JsonNode {
  return typeof value === 'object' && value !== null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function unquote(name: string): string {
  return name.length >= 2 && name.startsWith('"') && name.endsWith('"') ? name.slice(1, -1).replace(/""/g, '"') : name;
}

function collect(node: unknown, into: ReferencedTables): void {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, into);
    return;
  }
  if (!isNode(node)) return;

  if (node.type === 'BASE_TABLE') {
    into.tables.push({
      tableName: text(node.table_name),
      schemaName: text(node.schema_name),
      catalogName: text(node.catalog_name),
    });
  } else if (node.type === 'TABLE_FUNCTION' && isNode(node.function)) {
    into.tableFunctions.push(text(node.function.function_name));
  } else if (node.type === 'SHOW_REF' && node.query === null && text(node.table_name) !== '') {
    into.showTargets.push(unquote(text(node.table_name)));
  }

  for (const child of Object.values(node)) collect(child, into);
}

/**
 * Lists every table, table function and SHOW target a query reads, using
 * DuckDB's own parser (`json_serialize_sql`) rather than a regex, so subqueries,
 * joins, set operations and CTE bodies are all covered the way DuckDB itself
 * resolves them. Parses only; nothing is executed, and it works on a session
 * whose external access is already locked.
 *
 * A syntax error comes back ok with nothing referenced: the query cannot run
 * either, and `query()` reports its own error. A statement DuckDB parses but
 * cannot serialise (a PIVOT statement) is a failure, because what it reads is
 * then unknown and a scope check must not treat unknown as nothing. Never throws.
 */
export async function referencedTables(session: DuckDBSession, sql: string): Promise<ToolResult<ReferencedTables>> {
  const empty: ReferencedTables = { tables: [], tableFunctions: [], showTargets: [] };

  let serialised: unknown;
  try {
    // Same one-way lock query() applies: nothing agent-written reaches the
    // connection while file and network access are still open.
    if (!session.locked) await disableExternalAccess(session);
    const result = await session.connection.runAndReadAll(
      `SELECT json_serialize_sql('${sql.replace(/'/g, "''")}') AS j`,
    );
    serialised = JSON.parse(String(result.getRowObjectsJS()[0]?.j ?? ''));
  } catch (err) {
    return fail('QUERY_INVALID', `Could not parse the query to check which tables it reads: ${(err as Error).message}`, {
      suggestion: 'Rewrite it as a plain SELECT or WITH query.',
    });
  }

  if (!isNode(serialised)) {
    return fail('QUERY_INVALID', 'Could not parse the query to check which tables it reads.', {
      suggestion: 'Rewrite it as a plain SELECT or WITH query.',
    });
  }

  if (serialised.error === true) {
    if (serialised.error_type === 'parser') return ok(empty);
    return fail(
      'QUERY_INVALID',
      `This query form cannot be checked for which tables it reads (${text(serialised.error_message) || 'unsupported statement'}).`,
      { suggestion: 'Rewrite it as a plain SELECT or WITH query; use conditional aggregation instead of PIVOT.' },
    );
  }

  const found: ReferencedTables = { tables: [], tableFunctions: [], showTargets: [] };
  collect(serialised.statements, found);
  return ok(found);
}

/** Lowercased table names a scoped caller may read, and those it may not. */
export type TableScope = { allowed: ReadonlySet<string>; blocked: ReadonlySet<string> };

// Catalog schemas and the built-in views/functions over them: every one of these
// lists table names or columns across the whole database, not just the caller's.
const CATALOG_SCHEMAS = new Set(['information_schema', 'pg_catalog']);
const CATALOG_DATABASES = new Set(['system', 'temp']);
const CATALOG_VIEW_PREFIX = /^(duckdb_|pragma_|sqlite_|pg_)/i;
const CATALOG_FUNCTION_PREFIX = /^(duckdb_|pragma_)/i;
// Table functions that take a table name or SQL text as a string, which the
// parser cannot see through, or that suggest names from the catalog.
const OPAQUE_TABLE_FUNCTIONS = new Set(['query', 'query_table', 'sql_auto_complete']);

/**
 * Every reference in `refs` a scoped caller must not read, as a readable name;
 * empty when the query stays inside its scope. A registered table is readable
 * only when an in-scope source owns it. Catalog schemas, catalog views and
 * catalog table functions are never readable, since they list other
 * conversations' tables. A name that is neither (a CTE, a typo) passes: DuckDB
 * reports an unknown table itself.
 */
export function scopeViolations(refs: ReferencedTables, scope: TableScope): string[] {
  const violations: string[] = [];

  for (const ref of refs.tables) {
    const name = ref.tableName.toLowerCase();
    const qualified = [ref.catalogName, ref.schemaName, ref.tableName].filter(Boolean).join('.');
    if (CATALOG_SCHEMAS.has(ref.schemaName.toLowerCase()) || CATALOG_DATABASES.has(ref.catalogName.toLowerCase())) {
      violations.push(qualified);
    } else if (scope.allowed.has(name)) {
      continue;
    } else if (scope.blocked.has(name) || CATALOG_VIEW_PREFIX.test(name)) {
      violations.push(qualified);
    }
  }

  for (const fn of refs.tableFunctions) {
    const name = fn.toLowerCase();
    if (CATALOG_FUNCTION_PREFIX.test(name) || OPAQUE_TABLE_FUNCTIONS.has(name)) violations.push(`${fn}()`);
  }

  for (const target of refs.showTargets) {
    if (!scope.allowed.has(target.toLowerCase())) violations.push(`SHOW ${target}`);
  }

  return [...new Set(violations)];
}
