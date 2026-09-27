import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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

  it('registerFile still registers a file on a session already locked down (D-64)', async () => {
    session = await createSession('s6');
    await disableExternalAccess(session);

    const result = await registerFile(session, join(FIXTURES, 'sample.csv'), 'after_lock');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.rowCount).toBe(2);
  });
  it('disableExternalAccess is idempotent', async () => {
    session = await createSession('s7');
    await disableExternalAccess(session);
    await expect(disableExternalAccess(session)).resolves.toBeUndefined();
    expect(session.locked).toBe(true);
  });
});

describe('registerFile with workbook options', () => {
  let session: DuckDBSession;
  let dir: string;
  let path: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'session-sheets-'));
    path = join(dir, "two sheets.xlsx");
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('First').addRows([['a', 'b'], [1, 2]]);
    const titled = workbook.addWorksheet("Owner's view");
    titled.addRows([['Owner report'], [], ['name', 'score'], ['x', 1], ['y', 2]]);
    await workbook.xlsx.writeFile(path);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    if (session) closeSession(session);
  });

  it('reads the first sheet by default, the same as before', async () => {
    session = await createSession('w1');
    const result = await registerFile(session, path, 'first');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.columns.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('reads a named sheet (quote in the name included) from a header range', async () => {
    session = await createSession('w2');
    const result = await registerFile(session, path, 'owners', { sheet: "Owner's view", range: 'A3:B5' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.columns.map((c) => c.name)).toEqual(['name', 'score']);
    expect(result.data.rowCount).toBe(2);
  });

  it('fails cleanly for a sheet that does not exist', async () => {
    session = await createSession('w3');
    const result = await registerFile(session, path, 'missing', { sheet: 'Nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PARSE_FAILED');
  });
});
