import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { referencedTables, scopeViolations, type ReferencedTables } from './referencedTables';
import { registerRows } from './registerRows';
import { closeSession, createSession, disableExternalAccess, type DuckDBSession } from './session';

let session: DuckDBSession;

beforeAll(async () => {
  session = await createSession('referenced-tables-test');
  await registerRows(session, 'mine', { headers: ['id', 'v'], rows: [['1', '10']] });
  await registerRows(session, 'theirs', { headers: ['id', 'v'], rows: [['1', '20']] });
  // The tools only ever see a locked session; parsing must work on one.
  await disableExternalAccess(session);
});

afterAll(() => {
  closeSession(session);
});

async function refs(sql: string): Promise<ReferencedTables> {
  const result = await referencedTables(session, sql);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

const names = (r: ReferencedTables) => r.tables.map((t) => t.tableName).sort();

describe('referencedTables', () => {
  it('finds tables in joins, subqueries, set operations and CTE bodies', async () => {
    const r = await refs(
      `WITH x AS (SELECT * FROM mine) SELECT * FROM x JOIN "Theirs" t ON x.id = t.id
       WHERE x.id IN (SELECT id FROM other_one) UNION SELECT * FROM (SELECT * FROM fourth)`,
    );
    // The CTE name "x" is a BASE_TABLE to the parser too; the scope check lets it through.
    expect(names(r)).toEqual(['Theirs', 'fourth', 'mine', 'other_one', 'x']);
  });

  it('keeps schema and catalog qualifiers', async () => {
    const r = await refs('SELECT * FROM information_schema.tables, memory.main.mine');
    expect(r.tables).toContainEqual({ tableName: 'tables', schemaName: 'information_schema', catalogName: '' });
    expect(r.tables).toContainEqual({ tableName: 'mine', schemaName: 'main', catalogName: 'memory' });
  });

  it('lists table functions and SHOW targets', async () => {
    const r = await refs("SELECT * FROM duckdb_tables() UNION ALL SELECT * FROM pragma_table_info('mine')");
    expect(r.tableFunctions).toEqual(['duckdb_tables', 'pragma_table_info']);

    const show = await refs('SELECT * FROM (SHOW TABLES)');
    expect(show.showTargets).toEqual(['tables']);

    // DESCRIBE of a real table wraps a query over it, so the table itself is found.
    const describeRef = await refs('SELECT * FROM (DESCRIBE theirs)');
    expect(names(describeRef)).toEqual(['theirs']);
  });

  it('keeps a quote inside a string literal from breaking the parse', async () => {
    const r = await refs("SELECT * FROM mine WHERE v = 'O''Brien'");
    expect(names(r)).toEqual(['mine']);
  });

  it('returns nothing for a syntax error, leaving the error to the query itself', async () => {
    const result = await referencedTables(session, 'SELEC * FROM mine');
    expect(result).toEqual({ ok: true, data: { tables: [], tableFunctions: [], showTargets: [] } });
  });

  it('fails for a statement it cannot serialise, since what it reads is unknown', async () => {
    const result = await referencedTables(session, 'WITH p AS (PIVOT theirs ON id USING sum(v)) SELECT * FROM p');
    expect(result).toMatchObject({ ok: false, error: { code: 'QUERY_INVALID' } });
  });
});

describe('scopeViolations', () => {
  const scope = { allowed: new Set(['mine']), blocked: new Set(['theirs']) };

  it('allows in-scope tables, CTE names and unknown names', async () => {
    expect(scopeViolations(await refs('WITH x AS (SELECT * FROM MINE) SELECT * FROM x, no_such_table'), scope)).toEqual([]);
    expect(scopeViolations(await refs('SELECT * FROM range(3)'), scope)).toEqual([]);
  });

  it('rejects a table owned only by an out-of-scope source, case-insensitively', async () => {
    expect(scopeViolations(await refs('SELECT * FROM mine JOIN "THEIRS" USING (id)'), scope)).toEqual(['THEIRS']);
  });

  it('allows a table name an in-scope source also owns', async () => {
    const shared = { allowed: new Set(['mine', 'theirs']), blocked: new Set(['theirs']) };
    expect(scopeViolations(await refs('SELECT * FROM theirs'), shared)).toEqual([]);
  });

  it('rejects catalog schemas, catalog views and catalog table functions', async () => {
    expect(scopeViolations(await refs('SELECT * FROM information_schema.tables'), scope)).toEqual([
      'information_schema.tables',
    ]);
    expect(scopeViolations(await refs('SELECT * FROM pg_catalog.pg_class'), scope)).toEqual(['pg_catalog.pg_class']);
    expect(scopeViolations(await refs('SELECT * FROM sqlite_master'), scope)).toEqual(['sqlite_master']);
    expect(scopeViolations(await refs('SELECT * FROM duckdb_tables()'), scope)).toEqual(['duckdb_tables()']);
    expect(scopeViolations(await refs("SELECT * FROM pragma_table_info('theirs')"), scope)).toEqual([
      'pragma_table_info()',
    ]);
    expect(scopeViolations(await refs("SELECT * FROM query_table('theirs')"), scope)).toEqual(['query_table()']);
    expect(scopeViolations(await refs('SELECT * FROM (SHOW TABLES)'), scope)).toEqual(['SHOW tables']);
  });
});
