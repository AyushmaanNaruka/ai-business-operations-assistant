import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeSession, createSession, disableExternalAccess, registerFile, type DuckDBSession } from './session';

const SAMPLES = join(import.meta.dirname, '..', '..', '..', 'samples');
const FIXTURES = join(import.meta.dirname, '..', 'sources', '__fixtures__');

describe('DuckDB session and registerFile', () => {
  let session: DuckDBSession;

  afterEach(() => {
    if (session) closeSession(session);
  });

  it('registers a real .xlsx and reports its row count and columns', async () => {
    session = await createSession('s1');
    const result = await registerFile(session, join(SAMPLES, 'campaigns.xlsx'), 'campaigns');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tableName).toBe('campaigns');
    expect(result.data.rowCount).toBeGreaterThan(1000);
    const columnNames = result.data.columns.map((c) => c.name);
    expect(columnNames).toContain('channel');
    expect(columnNames).toContain('revenue');
  });

  it('registers a .csv fixture', async () => {
    session = await createSession('s2');
    const result = await registerFile(session, join(FIXTURES, 'sample.csv'), 'campaigns_csv');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rowCount).toBe(2);
  });

  it('registers a .json fixture', async () => {
    session = await createSession('s3');
    const result = await registerFile(session, join(FIXTURES, 'sample.json'), 'campaigns_json');

    expect(result.ok).toBe(true);
  });

  it('reports a plain, honest failure for a file it cannot register, rather than crashing', async () => {
    session = await createSession('s4');
    const result = await registerFile(session, join(FIXTURES, 'does-not-exist.csv'), 'nope');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PARSE_FAILED');
  });

  it('disableExternalAccess blocks DuckDB from reading a local filesystem path afterwards', async () => {
    session = await createSession('s5');
    await disableExternalAccess(session);

    let threw = false;
    try {
      await session.connection.run(`CREATE TABLE t AS SELECT * FROM read_csv_auto('${join(FIXTURES, 'sample.csv').replace(/\\/g, '/')}')`);
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
  });

  it('registerFile refuses to run on a session already locked down', async () => {
    session = await createSession('s6');
    await disableExternalAccess(session);

    const result = await registerFile(session, join(FIXTURES, 'sample.csv'), 'too_late');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('QUERY_INVALID');
  });

  it('disableExternalAccess is idempotent', async () => {
    session = await createSession('s7');
    await disableExternalAccess(session);
    await expect(disableExternalAccess(session)).resolves.toBeUndefined();
    expect(session.locked).toBe(true);
  });
});
