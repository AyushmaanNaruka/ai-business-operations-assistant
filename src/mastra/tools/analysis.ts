import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ToolResult } from '@/types';
import {
  computeStats,
  createSession,
  describe as describeTable,
  query,
  type DuckDBSession,
  type StatsOp,
} from '@/modules/analysis';
import { openLedger, type EvidenceLedger } from '@/modules/evidence';
import { fail } from '@/modules/reliability';
import { createSourceRegistry, ingest, type SourceRegistry } from '@/modules/sources';

// mastra dev runs with its cwd set to src/mastra/public, not the project root
// (see docs/DECISIONS.md D-09); INIT_CWD is npm's original invocation
// directory and the one thing that reliably points back at the project root.
const PROJECT_ROOT = process.env.INIT_CWD || process.cwd();

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

/**
 * One shared DuckDB session and evidence ledger for the whole process.
 *
 * This is a deliberate Phase 2 stand-in, not the real design: M8 (session
 * manifest, Phase 5) will scope a session per conversation, and the chat
 * UI's upload flow (Phase 7) will call `ingest()` per file a user actually
 * uploads. Until then, this loads samples/campaigns.xlsx once on first tool
 * call so the Data Analyst has something to query in Mastra Studio.
 * docs/DECISIONS.md D-15.
 */
let sessionPromise: Promise<{ session: DuckDBSession; registry: SourceRegistry; ledger: EvidenceLedger }> | null = null;

async function getRuntime() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const session = await createSession('phase2-shared-session');
      const registry = createSourceRegistry();
      const ledger = await openLedger(resolveDatabaseUrl(process.env.DATABASE_URL || 'file:./data/app.db'));

      const samplePath = resolve(PROJECT_ROOT, 'samples/campaigns.xlsx');
      if (existsSync(samplePath)) {
        const source = ingest(session, registry, { path: samplePath });
        await waitForReady(registry, source.id);
      }

      return { session, registry, ledger };
    })().catch((err: unknown) => {
      // Do not cache a rejected promise: a single transient init failure
      // (a locked db file, a bad sample row) would otherwise permanently
      // break every tool call for the rest of the process. Let the next
      // call retry from scratch.
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

function resolveDatabaseUrl(raw: string): string {
  if (!raw.startsWith('file:')) return raw;
  const filePath = raw.slice('file:'.length);
  const isAbsolute = filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath);
  return isAbsolute ? raw : `file:${resolve(PROJECT_ROOT, filePath)}`;
}

async function waitForReady(registry: SourceRegistry, id: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const source = registry.getSource(id);
    if (source && source.status !== 'pending') return;
    await new Promise((r) => setTimeout(r, 10));
  }
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
  execute: safe(async () => {
    const { registry } = await getRuntime();
    const tables = registry
      .listSources()
      .filter((s) => s.status === 'ready')
      .flatMap((s) => (s.tables ?? []).map((t) => ({ tableName: t.tableName, rowCount: t.rowCount, sourceName: s.name })));
    return { ok: true as const, data: { tables } };
  }),
});

export const describeDatasetTool = createTool({
  id: 'describe_dataset',
  description:
    'Returns a table\'s columns, types, null rates, summary statistics, a 20 row sample, and its data quality warnings. ' +
    'Call this before every run_sql, every time; it is the single biggest defence against hallucinated column names.',
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
  execute: async (inputData: { tableName: string }) =>
    safe(async () => {
      const { session, registry } = await getRuntime();
      const result = await describeTable(session, inputData.tableName);
      if (!result.ok) return { ok: false as const, error: result.error };

      const source = registry.listSources().find((s) => s.tables?.some((t) => t.tableName === inputData.tableName));
      const qualityWarnings = source?.tables?.find((t) => t.tableName === inputData.tableName)?.qualityWarnings ?? [];

      return { ok: true as const, data: { ...result.data, qualityWarnings } };
    })(),
});

export const runSqlTool = createTool({
  id: 'run_sql',
  description:
    'Runs a validated, read only SELECT or WITH query against the tables from list_datasets/describe_dataset. ' +
    'Returns the rows AND the exact SQL text, which is what becomes the evidence for any number you report.',
  inputSchema: z.object({ sql: z.string() }),
  outputSchema: toolResultSchema(
    z.object({
      rows: z.array(rowSchema),
      sql: z.string(),
      rowCount: z.number(),
      truncated: z.boolean(),
    }),
  ),
  execute: async (inputData: { sql: string }) =>
    safe(async () => {
      const { session } = await getRuntime();
      const result = await query(session, inputData.sql);
      return result.ok ? { ok: true as const, data: result.data } : { ok: false as const, error: result.error };
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
]);

const statsResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('linearRegression'), slope: z.number(), intercept: z.number(), rSquared: z.number(), n: z.number() }),
  z.object({ kind: z.literal('correlation'), r: z.number(), n: z.number() }),
  z.object({ kind: z.literal('tTestTwoSample'), t: z.number().nullable(), nA: z.number(), nB: z.number() }),
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
    'Regression, correlation, a two sample t test, or a small-sample-size check, over rows already returned by run_sql. ' +
    'Never compute these by hand; always call this.',
  inputSchema: z.object({ rows: z.array(rowSchema), op: statsOpSchema }),
  outputSchema: toolResultSchema(statsResultSchema),
  execute: async (inputData: { rows: Record<string, unknown>[]; op: StatsOp }) =>
    safe(async () => {
      const result = computeStats(inputData.rows as never, inputData.op);
      return result.ok ? { ok: true as const, data: result.data } : { ok: false as const, error: result.error };
    })(),
});

export const recordEvidenceTool = createTool({
  id: 'record_evidence',
  description:
    'Records one computed fact in the evidence ledger: a claim, its value, and the SQL that produced it. ' +
    'This tool RE-RUNS the SQL itself and uses the number it actually returns, not the value you pass in, ' +
    'when the query returns exactly one row and one column: you cannot record an estimate or a misremembered ' +
    'figure this way. Call this for every number that will appear in your answer, then cite the returned evidence id.',
  inputSchema: z.object({
    claim: z.string().describe('Human readable statement of the fact, e.g. "Email conversion rate is 4.2%"'),
    value: z.union([z.number(), z.string()]).describe('Your best recollection of the value; overridden if it can be re-verified'),
    sql: z.string().describe('The exact SQL that produced this value; re-executed here and becomes Evidence.method'),
    tableName: z.string().describe('The table this was computed from; becomes Evidence.sourceName'),
    metric: z
      .object({
        name: z.string(),
        scope: z.string(),
        unit: z.enum(['ratio', 'currency', 'count', 'duration']),
      })
      .optional()
      .describe('Set this when the value is a comparable metric, so conflict detection can find it.'),
  }),
  outputSchema: toolResultSchema(
    z.object({ id: z.string(), confidence: z.enum(['high', 'medium', 'low']), value: z.union([z.number(), z.string()]) }),
  ),
  execute: async (inputData: {
    claim: string;
    value: number | string;
    sql: string;
    tableName: string;
    metric?: { name: string; scope: string; unit: 'ratio' | 'currency' | 'count' | 'duration' };
  }) =>
    safe(async () => {
      const { session, ledger } = await getRuntime();

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

      const rows = verification.data.rows;
      const singleValue =
        rows.length === 1 && Object.keys(rows[0]!).length === 1 ? Object.values(rows[0]!)[0] : undefined;
      const value =
        typeof singleValue === 'number' || typeof singleValue === 'string' ? singleValue : inputData.value;

      const evidence = await ledger.addEvidence({
        claim: inputData.claim,
        kind: 'computed',
        sourceId: inputData.tableName,
        sourceName: inputData.tableName,
        locator: inputData.tableName,
        method: inputData.sql,
        value,
        ...(inputData.metric ? { metric: inputData.metric } : {}),
      });
      return { ok: true as const, data: { id: evidence.id, confidence: evidence.confidence, value } };
    })(),
});
