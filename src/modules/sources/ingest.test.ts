import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { query, closeSession, createSession, type DuckDBSession } from '@/modules/analysis';
import * as contentHash from './contentHash';
import { ingest } from './ingest';
import { createSourceRegistry, type SourceRegistry } from './registry';
import type { Source } from '@/types';

const SAMPLES = join(import.meta.dirname, '..', '..', '..', 'samples');

async function waitForStatus(registry: SourceRegistry, id: string, timeoutMs = 5000): Promise<Source> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const source = registry.getSource(id);
    if (source && source.status !== 'pending') return source;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Source ${id} did not leave 'pending' within ${timeoutMs}ms`);
}

describe('ingest (tabular)', () => {
  let session: DuckDBSession;
  let registry: SourceRegistry;

  afterEach(() => {
    if (session) closeSession(session);
  });

  it('returns a pending Source immediately, before parsing finishes', async () => {
    session = await createSession('ing1');
    registry = createSourceRegistry();

    const source = ingest(session, registry, { path: join(SAMPLES, 'campaigns.xlsx') });

    expect(source.status).toBe('pending');
    expect(source.id).toBe('src_1');

    await waitForStatus(registry, source.id);
  });

  it('transitions pending to ready and the registered table is queryable with correct rows', async () => {
    session = await createSession('ing2');
    registry = createSourceRegistry();

    const source = ingest(session, registry, { path: join(SAMPLES, 'campaigns.xlsx') });
    const finished = await waitForStatus(registry, source.id);

    expect(finished.status).toBe('ready');
    expect(finished.kind).toBe('xlsx');
    expect(finished.tables).toHaveLength(1);

    const tableName = finished.tables![0]!.tableName;
    const result = await query(session, `SELECT COUNT(*) AS n FROM "${tableName}"`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.rows[0]!.n).toBe(finished.tables![0]!.rowCount);
  });

  it('the source card contains the row count, the column list, and the quality warnings', async () => {
    session = await createSession('ing3');
    registry = createSourceRegistry();

    const source = ingest(session, registry, { path: join(SAMPLES, 'campaigns.xlsx') });
    const finished = await waitForStatus(registry, source.id);

    const table = finished.tables![0]!;
    expect(finished.summary).toContain(String(table.rowCount));
    for (const column of table.columns) {
      expect(finished.summary).toContain(column.name);
    }
    expect(table.qualityWarnings.length).toBeGreaterThan(0);
    expect(finished.summary).toContain(table.qualityWarnings[0]);
  });

  it('marks the source failed rather than hanging forever when something throws mid-ingest', async () => {
    session = await createSession('ing6');
    registry = createSourceRegistry();

    // Force an unexpected throw partway through the pipeline (after
    // detectType, which already fails gracefully on its own) to prove the
    // outer safety net in runIngestion catches it, rather than the source
    // being left stuck at 'pending' forever from an unhandled rejection.
    const spy = vi.spyOn(contentHash, 'hashFile').mockRejectedValue(new Error('simulated disk failure'));
    try {
      const source = ingest(session, registry, { path: join(SAMPLES, 'campaigns.xlsx') });
      const finished = await waitForStatus(registry, source.id);

      expect(finished.status).toBe('failed');
      expect(finished.error?.message).toContain('simulated disk failure');
    } finally {
      spy.mockRestore();
    }
  });

  it('marks a non-tabular file as failed rather than crashing, and names why', async () => {
    session = await createSession('ing4');
    registry = createSourceRegistry();

    const source = ingest(session, registry, { path: join(SAMPLES, 'northwind-brief.pdf') });
    const finished = await waitForStatus(registry, source.id);

    expect(finished.status).toBe('failed');
    expect(finished.error?.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('an identical re-upload reuses the already-registered table instead of registering it twice', async () => {
    session = await createSession('ing5');
    registry = createSourceRegistry();

    const first = ingest(session, registry, { path: join(SAMPLES, 'campaigns.xlsx') });
    const firstReady = await waitForStatus(registry, first.id);

    const second = ingest(session, registry, { path: join(SAMPLES, 'campaigns.xlsx') });
    const secondReady = await waitForStatus(registry, second.id);

    expect(secondReady.status).toBe('ready');
    expect(secondReady.tables![0]!.tableName).toBe(firstReady.tables![0]!.tableName);
    expect(secondReady.tables![0]!.rowCount).toBe(firstReady.tables![0]!.rowCount);
  });
});
