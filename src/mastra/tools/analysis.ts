import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Source, ToolResult } from '@/types';
import {
  AVERAGE_OF_PER_ROW,
  computeStats,
  describe as describeTable,
  lintRatioAverages,
  query,
  referencedTables,
  resolveEvidenceValue,
  scopeViolations,
  validateSql,
  type CellPick,
  type DuckDBSession,
  type StatsOp,
} from '@/modules/analysis';
import type { SourceRegistry } from '@/modules/sources';
import { fail } from '@/modules/reliability';
import { getRuntime } from '../runtime';
import { inScope, sourceScope, type SourceScope } from './scope';

const toolResultSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data: dataSchema }),
    z.object({
      ok: z.literal(false),
      error: z.object({
        code: z.string(),
        message: z.string(),
        recoverable: z.boolean(),
        suggestion: z.string().optional(),
      }),
    }),
  ]);

const rowSchema = z.record(z.string(), z.any());

/**
 * Wraps a tool's execute body so an unexpected throw (a DuckDB/libsql error
 * that isn't already a ToolResult, a dropped connection, etc.) becomes a
 * ToolResult failure instead of reaching the agent loop. AGENTS.md rule 5:
 * tools return ToolResult<T>, they never throw.
 */
function safe<T>(fn: () => Promise<ToolResult<T>>): () => Promise<ToolResult<T>> {
  return async () => {
    try {
      return await fn();
    } catch (err) {
      return fail('PARSE_FAILED', `Unexpected error: ${(err as Error).message}`, { recoverable: false });
    }
  };
}

// Rows run_sql hands back to the model. Every row returned is input tokens on every
// later step of the loop, so anything bigger belongs in an aggregate or in
// compute_stats, which reads the full result itself and returns only the statistic.
export const RUN_SQL_MAX_ROWS = 200;

// describe_dataset's sample is there to show value formats; 5 rows show them as
// well as 20 at a quarter of the tokens. The describe module keeps 20 for its
// other callers.
const DESCRIBE_SAMPLE_ROWS = 5;

function ownsTable(source: Source, tableName: string): boolean {
  const name = tableName.toLowerCase();
  return (source.tables ?? []).some((t) => t.tableName.toLowerCase() === name);
}

/**
 * The source a table belongs to, from this call's point of view. A scoped call only
 * ever sees in-scope owners, so another conversation's source id and file name never
 * end up in this one's evidence. Undefined when no visible source owns the table.
 */
function ownerOf(registry: SourceRegistry, tableName: string, scope: SourceScope): Source | undefined {
  return registry.listSources().find((s) => ownsTable(s, tableName) && inScope(scope, s.id));
}

/**
 * Refuses SQL that reads outside this call's source scope (docs/DECISIONS.md D-72):
 * a registered table no in-scope source owns, or a catalog schema, view or function
 * that lists every conversation's tables. Returns null when the query may run, which
 * every unscoped call may. Uses DuckDB's own parser, so a table named inside a
 * subquery, join or CTE body is caught the same as one in the outer FROM. SQL that
 * fails validation is let through for query() to reject with its own message.
 */
async function refuseOutOfScopeSql(
  session: DuckDBSession,
  registry: SourceRegistry,
  scope: SourceScope,
  sql: string,
): Promise<ToolResult<never> | null> {
  if (scope === null || !validateSql(sql).ok) return null;

  const refs = await referencedTables(session, sql);
  if (!refs.ok) return refs;

  const allowed = new Set<string>();
  const blocked = new Set<string>();
  for (const source of registry.listSources()) {
    for (const table of source.tables ?? []) {
      (scope.has(source.id) ? allowed : blocked).add(table.tableName.toLowerCase());
    }
  }

  const violations = scopeViolations(refs.data, { allowed, blocked });
  if (violations.length === 0) return null;
  return fail('SOURCE_NOT_FOUND', `This query reads tables that are not available to this task: ${violations.join(', ')}.`, {
    recoverable: true,
    suggestion: 'Query only the tables list_datasets returns.',
  });
}

export const listDatasetsTool = createTool({
  id: 'list_datasets',
  description: 'Lists every table available to query in this session, with row counts. Call this before writing any SQL.',
  inputSchema: z.object({}),
  outputSchema: toolResultSchema(
    z.object({
      tables: z.array(z.object({ tableName: z.string(), rowCount: z.number(), sourceName: z.string() })),
    }),
  ),
  execute: async (_inputData: Record<string, never>, context: unknown) =>
    safe(async () => {
      const { registry } = await getRuntime();
      const scope = sourceScope(context);
      const tables = registry
        .listSources()
        .filter((s) => s.status === 'ready' && inScope(scope, s.id))
        .flatMap((s) => (s.tables ?? []).map((t) => ({ tableName: t.tableName, rowCount: t.rowCount, sourceName: s.name })));
      return { ok: true as const, data: { tables } };
    })(),
});

export const describeDatasetTool = createTool({
  id: 'describe_dataset',
  description:
    'Returns a table\'s columns, types, null rates, summary statistics, a 5 row sample, and its data quality warnings. ' +
    'Call this before the first run_sql against each table; it is the single biggest defence against hallucinated ' +
    'column names. The schema does not change within a task, so once per table is enough.',
  inputSchema: z.object({ tableName: z.string() }),
  outputSchema: toolResultSchema(
    z.object({
      tableName: z.string(),
      rowCount: z.number(),
      columns: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          nullRate: z.number(),
          approxUnique: z.number().nullable(),
          min: z.any(),
          max: z.any(),
          avg: z.number().nullable(),
          std: z.number().nullable(),
        }),
      ),
      sample: z.array(rowSchema),
      duplicateRowCount: z.number(),
      dateFormatsByColumn: z.record(z.string(), z.array(z.string())),
      qualityWarnings: z.array(z.string()),
    }),
  ),
  execute: async (inputData: { tableName: string }, context: unknown) =>
    safe(async () => {
      const { session, registry } = await getRuntime();
      const scope = sourceScope(context);

      // Checked before DuckDB is touched, so a scoped call learns nothing about a
      // table outside its scope, not even whether it exists.
      const source = ownerOf(registry, inputData.tableName, scope);
      if (scope !== null && !source) {
        return fail('SOURCE_NOT_FOUND', `Table "${inputData.tableName}" is not one of the tables available to this task.`, {
          recoverable: true,
          suggestion: 'Call list_datasets and describe one of the tables it returns.',
        });
      }

      const result = await describeTable(session, inputData.tableName);
      if (!result.ok) return { ok: false as const, error: result.error };

      const name = inputData.tableName.toLowerCase();
      const qualityWarnings = source?.tables?.find((t) => t.tableName.toLowerCase() === name)?.qualityWarnings ?? [];

      return {
        ok: true as const,
        data: { ...result.data, sample: result.data.sample.slice(0, DESCRIBE_SAMPLE_ROWS), qualityWarnings },
      };
    })(),
});

export const runSqlTool = createTool({
  id: 'run_sql',
  description:
    'Runs a validated, read only SELECT or WITH query against the tables from list_datasets/describe_dataset. ' +
    'Returns the rows AND the exact SQL text, which is what becomes the evidence for any number you report. ' +
    `At most ${RUN_SQL_MAX_ROWS} rows come back, so aggregate in SQL; for a statistic over many rows, pass the SQL ` +
    'to compute_stats instead, which reads every row itself.',
  inputSchema: z.object({ sql: z.string() }),
  outputSchema: toolResultSchema(
    z.object({
      rows: z.array(rowSchema),
      sql: z.string(),
      rowCount: z.number(),
      truncated: z.boolean(),
      note: z.string().optional(),
      // Deterministic lints over the SQL text (ratioLint): the query still ran, but
      // its numbers are probably not the ones the question asks for.
      warnings: z.array(z.string()).optional(),
    }),
  ),
  execute: async (inputData: { sql: string }, context: unknown) =>
    safe(async () => {
      const { session, registry } = await getRuntime();
      const refused = await refuseOutOfScopeSql(session, registry, sourceScope(context), inputData.sql);
      if (refused) return refused;

      const result = await query(session, inputData.sql, { maxRows: RUN_SQL_MAX_ROWS });
      if (!result.ok) return { ok: false as const, error: result.error };
      // An average of per row ratios is not blocked (it is sometimes the question),
      // but the analyst is told, and record_evidence will not accept it unlabelled.
      const warnings = lintRatioAverages(inputData.sql);
      return {
        ok: true as const,
        data: {
          ...result.data,
          ...(result.data.truncated
            ? {
                note:
                  `Only the first ${RUN_SQL_MAX_ROWS} rows are shown. Aggregate in SQL (GROUP BY, SUM, COUNT) instead of ` +
                  'reading rows, or pass this SQL to compute_stats, which reads every row.',
              }
            : {}),
          ...(warnings.length > 0 ? { warnings } : {}),
        },
      };
    })(),
});

const statsOpSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('linearRegression'), xColumn: z.string(), yColumn: z.string() }),
  z.object({ kind: z.literal('correlation'), columnA: z.string(), columnB: z.string() }),
  z.object({
    kind: z.literal('tTestTwoSample'),
    valueColumn: z.string(),
    groupColumn: z.string(),
    groupA: z.string(),
    groupB: z.string(),
  }),
  z.object({
    kind: z.literal('smallSample'),
    clicksColumn: z.string(),
    conversionsColumn: z.string(),
    labelColumn: z.string().optional(),
  }),
  z
    .object({
      kind: z.literal('twoProportionZTest'),
      successesColumn: z.string().describe('e.g. "conversions"'),
      trialsColumn: z.string().describe('e.g. "clicks"'),
      groupColumn: z.string(),
      groupA: z.string(),
      groupB: z.string(),
    })
    .describe(
      'Compares two rates such as conversion rate between two segments: sums successes and trials per group ' +
        'over the rows, then runs a pooled two proportion z test.',
    ),
]);

const statsResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('linearRegression'), slope: z.number(), intercept: z.number(), rSquared: z.number(), n: z.number() }),
  z.object({ kind: z.literal('correlation'), r: z.number(), n: z.number() }),
  z.object({
    kind: z.literal('tTestTwoSample'),
    method: z.literal('welch'),
    t: z.number().nullable(),
    df: z.number().nullable(),
    pValue: z.number().nullable(),
    meanA: z.number(),
    meanB: z.number(),
    nA: z.number(),
    nB: z.number(),
  }),
  z.object({
    kind: z.literal('twoProportionZTest'),
    z: z.number().nullable(),
    pValue: z.number().nullable(),
    significantAt05: z.boolean().nullable(),
    rateA: z.number(),
    rateB: z.number(),
    pooledRate: z.number(),
    successesA: z.number(),
    trialsA: z.number(),
    successesB: z.number(),
    trialsB: z.number(),
  }),
  z.object({
    kind: z.literal('smallSample'),
    rows: z.array(
      z.object({
        label: z.string(),
        clicks: z.number(),
        conversions: z.number(),
        rate: z.number().nullable(),
        reportable: z.boolean(),
        reason: z.string().optional(),
      }),
    ),
  }),
]);

export const computeStatsTool = createTool({
  id: 'compute_stats',
  description:
    'Regression, correlation, a Welch two sample t test (t, df, p value), a two proportion z test for comparing two ' +
    'segments\' conversion rates or CTRs (z, p value), or a small-sample-size check. Pass the SQL whose rows to analyse, ' +
    'never the rows themselves: this tool runs that query and reads every row it returns, so the columns "op" names ' +
    'must be columns of that query. Never compute these by hand; always call this.',
  inputSchema: z.object({
    sql: z.string().describe('A SELECT or WITH query returning the columns "op" names, one row per observation'),
    op: statsOpSchema,
  }),
  outputSchema: toolResultSchema(statsResultSchema),
  execute: async (inputData: { sql: string; op: StatsOp }, context: unknown) =>
    safe(async () => {
      const { session, registry } = await getRuntime();
      const refused = await refuseOutOfScopeSql(session, registry, sourceScope(context), inputData.sql);
      if (refused) return refused;

      const rows = await query(session, inputData.sql);
      if (!rows.ok) return { ok: false as const, error: rows.error };
      // A statistic over the first N rows of a longer result is a wrong number, not
      // an approximate one, so a capped result is refused rather than analysed.
      if (rows.data.truncated) {
        return fail('QUERY_INVALID', `The query returned more than ${rows.data.rowCount} rows, too many to analyse in full.`, {
          suggestion: 'Aggregate first, for example one row per day or per campaign, then pass that SQL.',
        });
      }

      const result = computeStats(rows.data.rows, inputData.op);
      return result.ok ? { ok: true as const, data: result.data } : { ok: false as const, error: result.error };
    })(),
});

export const recordEvidenceTool = createTool({
  id: 'record_evidence',
  description:
    'Records one computed fact in the evidence ledger: a claim, its value, and the SQL that produced it. ' +
    'This tool RE-RUNS the SQL itself and records the number it actually returns, never the value you pass in: ' +
    'the only cell of a one row, one column result; the cell "pick" names; or else the cell your value matches ' +
    '(within 0.5%). A value not in the result is refused, so you cannot record an estimate or a misremembered ' +
    'figure. SQL that averages a per-row ratio (AVG(a / b)) is refused unless the claim says "average of per-row". ' +
    'Call this for every number that will appear in your answer, then cite the returned evidence id.',
  inputSchema: z.object({
    claim: z.string().describe('Human readable statement of the fact, e.g. "Email conversion rate is 4.2%"'),
    value: z.union([z.number(), z.string()]).describe('Your best recollection of the value; overridden if it can be re-verified'),
    sql: z.string().describe('The exact SQL that produced this value; re-executed here and becomes Evidence.method'),
    pick: z
      .object({ row: z.number().int().min(0), column: z.string() })
      .optional()
      .describe('For a result wider than one cell: the 0 based row and the column holding this value'),
    tableName: z.string().describe('The table this was computed from; becomes Evidence.sourceName'),
    metric: z
      .object({
        name: z.string(),
        scope: z.string(),
        unit: z.enum(['ratio', 'currency', 'count', 'duration']),
      })
      .optional()
      .describe(
        'Set this when the value is a comparable metric, so conflict detection can find it. Lowercase snake case, ' +
        'e.g. name "conversion_rate", scope "channel=paid_social"; a "<metric>_rank" name with unit "count" holds a position, 1 = best.',
      ),
  }),
  outputSchema: toolResultSchema(
    z.object({
      id: z.string(),
      confidence: z.enum(['high', 'medium', 'low']),
      value: z.union([z.number(), z.string()]),
      // The full Evidence object this call just wrote to the ledger. P5.2:
      // a specialist's structured SpecialistResult.evidence array must be
      // populated from facts it actually recorded, not retyped from memory,
      // so this tool hands back the exact object to echo, rather than
      // asking the model to reconstruct id/kind/sourceId/confidence/createdAt
      // itself from what it recalls of this call.
      evidence: z.object({
        id: z.string(),
        claim: z.string(),
        kind: z.enum(['computed', 'document', 'web']),
        sourceId: z.string(),
        sourceName: z.string(),
        locator: z.string(),
        method: z.string().optional(),
        value: z.union([z.number(), z.string()]).optional(),
        confidence: z.enum(['high', 'medium', 'low']),
        retrievedAt: z.string().optional(),
        metric: z
          .object({ name: z.string(), scope: z.string(), unit: z.enum(['ratio', 'currency', 'count', 'duration']) })
          .optional(),
        createdAt: z.string(),
      }),
    }),
  ),
  execute: async (
    inputData: {
      claim: string;
      value: number | string;
      sql: string;
      pick?: CellPick;
      tableName: string;
      metric?: { name: string; scope: string; unit: 'ratio' | 'currency' | 'count' | 'duration' };
    },
    context: unknown,
  ) =>
    safe(async () => {
      const { session, ledger, registry } = await getRuntime();
      const scope = sourceScope(context);
      const refused = await refuseOutOfScopeSql(session, registry, scope, inputData.sql);
      if (refused) return refused;

      // A group's rate is SUM(a) / SUM(b). An average of per row ratios is a
      // different number, so it only enters the ledger labelled as what it is.
      const ratioWarnings = lintRatioAverages(inputData.sql);
      if (ratioWarnings.length > 0 && !AVERAGE_OF_PER_ROW.test(inputData.claim)) {
        return fail('QUERY_INVALID', `Cannot record evidence: ${ratioWarnings.join(' ')}`, {
          suggestion:
            'Rewrite the SQL as SUM(numerator) / SUM(denominator). If you really mean the mean of per-row values, ' +
            'say "average of per-row ..." (or per-day, per-campaign) in the claim.',
        });
      }

      // Re-run the SQL rather than trusting the model's transcription of an
      // earlier run_sql result: a number is only "computed, never estimated"
      // (AGENTS.md rule 1) if the last thing that touched it was DuckDB, not
      // the model's memory of DuckDB's output two turns ago.
      const verification = await query(session, inputData.sql);
      if (!verification.ok) {
        return fail(
          'QUERY_INVALID',
          `Cannot record evidence: the SQL that supposedly produced it does not run: ${verification.error.message}`,
        );
      }

      // The recorded value always comes from a cell of the result, never from the
      // model's typed value; a typed value the result does not contain is refused.
      const resolved = resolveEvidenceValue(verification.data.rows, inputData.value, inputData.pick);
      if (!resolved.ok) {
        return fail(resolved.error.code, `Cannot record evidence: ${resolved.error.message}`, {
          ...(resolved.error.suggestion !== undefined ? { suggestion: resolved.error.suggestion } : {}),
        });
      }
      const value = resolved.data.value;

      // Evidence.sourceId is a source id ("src_3"), not a table name: the workbook's
      // Data sheet and every citation look the source up by it. Falls back to the
      // table name only for a table no registered source (in scope, when the call
      // is scoped) owns.
      const owner = ownerOf(registry, inputData.tableName, scope);

      const evidence = await ledger.addEvidence({
        claim: inputData.claim,
        kind: 'computed',
        sourceId: owner?.id ?? inputData.tableName,
        sourceName: owner?.name ?? inputData.tableName,
        locator: inputData.tableName,
        method: inputData.sql,
        value,
        ...(inputData.metric ? { metric: inputData.metric } : {}),
      });
      return { ok: true as const, data: { id: evidence.id, confidence: evidence.confidence, value, evidence } };
    })(),
});
