import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeSession, computeStats, createSession, registerRows, twoProportionZTest, type DuckDBSession } from '@/modules/analysis';
import { createSourceRegistry } from '@/modules/sources/registry';
import type { Evidence, Source, ToolResult } from '@/types';

// 250 visits, alternating arms A and B, so a t test has real groups and run_sql has
// more rows than it may hand back.
const VISITS = Array.from({ length: 250 }, (_, i) => [String(i), i % 2 === 0 ? 'A' : 'B', String((i * 7) % 31)]);

function source(id: string, name: string, tableName: string, rowCount: number): Source {
  return {
    id,
    name,
    kind: 'xlsx',
    origin: 'upload',
    status: 'ready',
    summary: '',
    addedAt: '2026-09-27T00:00:00.000Z',
    tables: [{ tableName, rowCount, columns: [], qualityWarnings: [] }],
  };
}

// A stubbed runtime, not the shared one: getRuntime() loads the samples into a named
// in-memory DuckDB that parallel test files would also be registering into. src_7 and
// src_8 stand for this conversation's uploads, src_9 for another conversation's.
let session: DuckDBSession | undefined;
vi.mock('../runtime', () => ({
  getRuntime: async () => {
    if (!session) {
      session = await createSession('analysis-tool-test');
      await registerRows(session, 'campaigns', { headers: ['channel', 'spend'], rows: [['Email', '10'], ['Webinar', '5']] });
      await registerRows(session, 'visits', { headers: ['id', 'arm', 'value'], rows: VISITS });
      await registerRows(session, 'other_chat', { headers: ['secret'], rows: [['42']] });
      await registerRows(session, 'ads', {
        headers: ['channel', 'clicks', 'conversions'],
        rows: [
          ['Email', '1000', '45'],
          ['Email', '10', '5'],
          ['Social', '1000', '30'],
        ],
      });
    }
    const registry = createSourceRegistry();
    registry.addSource(source('src_7', 'campaigns.xlsx', 'campaigns', 2));
    registry.addSource(source('src_8', 'visits.csv', 'visits', VISITS.length));
    registry.addSource(source('src_9', 'someone-else.xlsx', 'other_chat', 1));
    const ledger = {
      addEvidence: async (entry: Omit<Evidence, 'id' | 'confidence' | 'createdAt'>) => ({
        ...entry,
        id: 'E1',
        confidence: 'high',
        createdAt: '2026-09-27T00:00:00.000Z',
      }),
    };
    return { session, registry, ledger };
  },
}));

const { computeStatsTool, describeDatasetTool, listDatasetsTool, recordEvidenceTool, runSqlTool, RUN_SQL_MAX_ROWS } =
  await import('./analysis');

/** The second execute argument a delegated call carries: its task's source ids on the RequestContext. */
function scoped(...sourceIds: string[]) {
  return { requestContext: { get: (k: string) => (k === 'sourceIds' ? sourceIds : undefined) } } as never;
}
const unscoped = {} as never;

// execute() is typed to also return void or a ValidationError; these tools only ever
// return their ToolResult, so the narrowing below is a cast, not a check.
type Rows = { rows: Record<string, unknown>[]; rowCount: number; truncated: boolean; note?: string };
const runSql = async (sql: string, context: never) => (await runSqlTool.execute!({ sql }, context)) as ToolResult<Rows>;
const listDatasets = async (context: never) =>
  (await listDatasetsTool.execute!({}, context)) as ToolResult<{ tables: { tableName: string }[] }>;
const describeDataset = async (tableName: string, context: never) =>
  (await describeDatasetTool.execute!({ tableName }, context)) as ToolResult<{ tableName: string; sample: unknown[] }>;

afterAll(() => {
  if (session) closeSession(session);
});

describe('record_evidence (analysis)', () => {
  it('records the source that owns the table, not the table name, as the evidence source', async () => {
    const result = await recordEvidenceTool.execute!(
      { claim: 'The campaigns table has two rows', value: 0, sql: 'SELECT COUNT(*) AS n FROM campaigns', tableName: 'campaigns' },
      unscoped,
    );

    expect(result).toMatchObject({
      ok: true,
      data: { value: 2, evidence: { sourceId: 'src_7', sourceName: 'campaigns.xlsx', locator: 'campaigns' } },
    });
  });

  it('falls back to the table name for a table no source owns', async () => {
    const result = await recordEvidenceTool.execute!(
      { claim: 'Constant', value: 1, sql: 'SELECT 1 AS n', tableName: 'scratch' },
      unscoped,
    );

    expect(result).toMatchObject({ ok: true, data: { evidence: { sourceId: 'scratch', sourceName: 'scratch' } } });
  });

  it('refuses to re-run SQL over another conversation\'s table when scoped', async () => {
    const result = await recordEvidenceTool.execute!(
      { claim: 'Secret', value: 0, sql: 'SELECT secret FROM other_chat', tableName: 'campaigns' },
      scoped('src_7'),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'SOURCE_NOT_FOUND', recoverable: true } });
  });
});

describe('compute_stats (analysis)', () => {
  it('runs the SQL itself and analyses every row it returns', async () => {
    const op = { kind: 'tTestTwoSample' as const, valueColumn: 'value', groupColumn: 'arm', groupA: 'A', groupB: 'B' };
    const result = await computeStatsTool.execute!({ sql: 'SELECT arm, value FROM visits', op }, unscoped);

    // The same test over the same rows built by hand: the tool must match it exactly.
    const expected = computeStats(
      VISITS.map(([, arm, value]) => ({ arm: arm!, value: Number(value) })),
      op,
    );
    expect(expected.ok).toBe(true);
    expect(result).toEqual(expected);
    expect(result).toMatchObject({ ok: true, data: { kind: 'tTestTwoSample', nA: 125, nB: 125 } });
  });

  it('turns a SQL error into a ToolResult failure', async () => {
    const result = await computeStatsTool.execute!(
      { sql: 'SELECT no_such_column FROM visits', op: { kind: 'correlation', columnA: 'a', columnB: 'b' } },
      unscoped,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'QUERY_INVALID' } });
  });

  it('refuses SQL over an out-of-scope table when scoped', async () => {
    const result = await computeStatsTool.execute!(
      { sql: 'SELECT secret AS a, secret AS b FROM other_chat', op: { kind: 'correlation', columnA: 'a', columnB: 'b' } },
      scoped('src_7', 'src_8'),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'SOURCE_NOT_FOUND' } });
  });
});

describe('run_sql (analysis)', () => {
  it(`returns at most ${RUN_SQL_MAX_ROWS} rows, flags the cut and says how to read the rest`, async () => {
    const result = await runSql('SELECT * FROM visits', unscoped);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rows).toHaveLength(RUN_SQL_MAX_ROWS);
    expect(result.data.rowCount).toBe(RUN_SQL_MAX_ROWS);
    expect(result.data.truncated).toBe(true);
    expect(result.data.note).toContain(`first ${RUN_SQL_MAX_ROWS} rows`);
    expect(result.data.note).toContain('compute_stats');
  });

  it('adds no note when every row fits', async () => {
    const result = await runSql('SELECT COUNT(*) AS n FROM visits', unscoped);

    expect(result).toMatchObject({ ok: true, data: { rows: [{ n: 250 }], truncated: false } });
    expect(result.ok && 'note' in result.data).toBe(false);
  });

  it('refuses a query on an out-of-scope table, however it is nested', async () => {
    for (const sql of [
      'SELECT * FROM other_chat',
      'SELECT * FROM campaigns WHERE spend IN (SELECT secret FROM OTHER_CHAT)',
      'WITH x AS (SELECT * FROM other_chat) SELECT * FROM x',
    ]) {
      const result = await runSql(sql, scoped('src_7'));
      expect(result, sql).toMatchObject({ ok: false, error: { code: 'SOURCE_NOT_FOUND', recoverable: true } });
      expect(result.ok ? '' : result.error.message.toLowerCase(), sql).toContain('other_chat');
    }
  });

  it('refuses catalog queries that would list every conversation\'s tables', async () => {
    for (const sql of [
      'SELECT table_name FROM information_schema.tables',
      'SELECT * FROM duckdb_tables()',
      'SELECT * FROM sqlite_master',
    ]) {
      const result = await runSql(sql, scoped('src_7'));
      expect(result, sql).toMatchObject({ ok: false, error: { code: 'SOURCE_NOT_FOUND' } });
    }
  });

  it('allows an in-scope table and a CTE over it', async () => {
    const direct = await runSql('SELECT SUM(spend) AS s FROM campaigns', scoped('src_7'));
    expect(direct).toMatchObject({ ok: true, data: { rows: [{ s: 15 }] } });

    const cte = await runSql(
      "WITH e AS (SELECT * FROM campaigns WHERE channel = 'Email') SELECT spend FROM e",
      scoped('src_7'),
    );
    expect(cte).toMatchObject({ ok: true, data: { rows: [{ spend: 10 }] } });
  });

  it('leaves unscoped calls unchanged: every table is readable', async () => {
    const result = await runSql('SELECT secret FROM other_chat', unscoped);
    expect(result).toMatchObject({ ok: true, data: { rows: [{ secret: 42 }] } });
  });

  it('still reports a SQL error in its own words when scoped', async () => {
    const result = await runSql('SELECT * FROM no_such_table', scoped('src_7'));
    expect(result).toMatchObject({ ok: false, error: { code: 'QUERY_INVALID' } });
  });
});

describe('list_datasets (analysis)', () => {
  it('lists only the tables of in-scope sources when scoped', async () => {
    const result = await listDatasets(scoped('src_7', 'src_8'));

    expect(result).toMatchObject({ ok: true });
    const names = result.ok ? result.data.tables.map((t) => t.tableName) : [];
    expect(names).toEqual(['campaigns', 'visits']);
  });

  it('lists nothing for an empty scope and everything when unscoped', async () => {
    const none = await listDatasets(scoped());
    expect(none).toEqual({ ok: true, data: { tables: [] } });

    const all = await listDatasets(unscoped);
    expect(all.ok ? all.data.tables.map((t) => t.tableName) : []).toEqual(['campaigns', 'visits', 'other_chat']);
  });
});

describe('describe_dataset (analysis)', () => {
  it('sends only a 5 row sample to the model', async () => {
    const result = await describeDataset('visits', unscoped);

    expect(result).toMatchObject({ ok: true, data: { tableName: 'visits', rowCount: 250 } });
    expect(result.ok ? result.data.sample : []).toHaveLength(5);
  });

  it('refuses a table that belongs to an out-of-scope source', async () => {
    const result = await describeDataset('other_chat', scoped('src_7'));

    expect(result).toMatchObject({ ok: false, error: { code: 'SOURCE_NOT_FOUND', recoverable: true } });
    expect(result.ok ? '' : result.error.message).toContain('other_chat');
  });

  it('describes an in-scope table when scoped', async () => {
    const result = await describeDataset('campaigns', scoped('src_7'));
    expect(result).toMatchObject({ ok: true, data: { tableName: 'campaigns', rowCount: 2 } });
  });
});

// ads: Email 1000 clicks/45 conversions plus a 10 click/5 conversion row, Social 1000/30.
// Email's rate is 50/1010 = 4.95%; the mean of its per-row rates is (4.5% + 50%) / 2 = 27.25%.
describe('ratio of sums guard', () => {
  const record = async (input: Record<string, unknown>) =>
    (await recordEvidenceTool.execute!({ tableName: 'ads', value: 0, ...input } as never, unscoped)) as ToolResult<{
      value: number | string;
    }>;

  it('run_sql still runs an average of per-row ratios but returns a warning', async () => {
    const result = await runSql(
      "SELECT AVG(conversions / clicks) AS cr FROM ads WHERE channel = 'Email'",
      unscoped,
    );
    expect(result).toMatchObject({ ok: true, data: { rows: [{ cr: 0.2725 }] } });
    const warnings = result.ok ? (result.data as Rows & { warnings?: string[] }).warnings : undefined;
    expect(warnings).toHaveLength(1);
    expect(warnings![0]).toContain('SUM(conversions) / SUM(clicks)');
  });

  it('run_sql adds no warning to a ratio of sums', async () => {
    const result = await runSql('SELECT channel, SUM(conversions) / SUM(clicks) AS cr FROM ads GROUP BY channel', unscoped);
    expect(result.ok && 'warnings' in result.data).toBe(false);
  });

  it('record_evidence refuses an unlabelled average of per-row ratios', async () => {
    const result = await record({
      claim: 'Email conversion rate is 27.25%',
      value: 0.2725,
      sql: "SELECT AVG(conversions / clicks) FROM ads WHERE channel = 'Email'",
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'QUERY_INVALID', recoverable: true } });
    expect(result.ok ? '' : result.error.suggestion).toContain('SUM(numerator) / SUM(denominator)');
  });

  it('record_evidence accepts it when the claim says it is an average of per-row values', async () => {
    const result = await record({
      claim: 'The average of per-row Email conversion rates is 27.25%',
      value: 0.2725,
      sql: "SELECT AVG(conversions / clicks) FROM ads WHERE channel = 'Email'",
    });
    expect(result).toMatchObject({ ok: true, data: { value: 0.2725 } });
  });
});

describe('record_evidence on a result wider than one cell', () => {
  const BY_CHANNEL = 'SELECT channel, SUM(conversions) / SUM(clicks) AS cr FROM ads GROUP BY channel ORDER BY channel';
  const record = async (input: Record<string, unknown>) =>
    (await recordEvidenceTool.execute!({ tableName: 'ads', sql: BY_CHANNEL, ...input } as never, unscoped)) as ToolResult<{
      value: number | string;
    }>;

  it('records the matching cell from the result, not the typed value', async () => {
    const result = await record({ claim: 'Social conversion rate is 3.0%', value: '3.0%' });
    expect(result).toMatchObject({ ok: true, data: { value: 0.03 } });
  });

  it('records the picked cell', async () => {
    const result = await record({ claim: 'Email conversion rate', value: 0.9, pick: { row: 0, column: 'cr' } });
    expect(result.ok && result.data.value).toBeCloseTo(50 / 1010, 12);
  });

  it('refuses a typed value the result does not contain', async () => {
    const result = await record({ claim: 'Email conversion rate is 6%', value: 0.06 });
    expect(result).toMatchObject({ ok: false, error: { code: 'QUERY_INVALID' } });
    expect(result.ok ? '' : result.error.suggestion).toContain('pick');
  });

  it('refuses an empty result as a gap', async () => {
    const result = await record({ claim: 'x', value: 1, sql: "SELECT clicks FROM ads WHERE channel = 'Webinar'" });
    expect(result).toMatchObject({ ok: false, error: { code: 'NO_DATA' } });
  });
});

describe('compute_stats twoProportionZTest (analysis)', () => {
  it('sums per group from the SQL and matches the module on the same totals', async () => {
    const op = {
      kind: 'twoProportionZTest' as const,
      successesColumn: 'conversions',
      trialsColumn: 'clicks',
      groupColumn: 'channel',
      groupA: 'Email',
      groupB: 'Social',
    };
    const result = await computeStatsTool.execute!({ sql: 'SELECT channel, clicks, conversions FROM ads', op }, unscoped);
    const expected = twoProportionZTest(50, 1010, 30, 1000);
    expect(result).toEqual({ ok: true, data: { kind: 'twoProportionZTest', ...expected } });
    expect(expected.pValue).toBeGreaterThan(0.01);
    expect(expected.pValue).toBeLessThan(0.05);
  });
});
