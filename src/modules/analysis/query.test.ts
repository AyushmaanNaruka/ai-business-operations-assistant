import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { query } from './query';
import { raceWithTimeout } from './raceWithTimeout';
import { closeSession, createSession, registerFile, type DuckDBSession } from './session';

const SAMPLES = join(import.meta.dirname, '..', '..', '..', 'samples');

describe('query', () => {
  let session: DuckDBSession;

  afterEach(() => {
    if (session) closeSession(session);
  });

  it('runs a validated query and returns rows plus the SQL that produced them', async () => {
    session = await createSession('q1');
    await registerFile(session, join(SAMPLES, 'campaigns.xlsx'), 'campaigns');

    const result = await query(session, "SELECT channel, COUNT(*) AS n FROM campaigns GROUP BY channel ORDER BY channel");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sql).toContain('GROUP BY channel');
    expect(result.data.rows.length).toBeGreaterThan(0);
    // COUNT(*) is BIGINT under the hood; it must come back as a real number.
    expect(typeof result.data.rows[0]!.n).toBe('number');
  });

  it('locks the session down on first use even if the caller never called disableExternalAccess', async () => {
    session = await createSession('q2');
    await registerFile(session, join(SAMPLES, 'campaigns.xlsx'), 'campaigns');
    expect(session.locked).toBe(false);

    await query(session, 'SELECT COUNT(*) AS n FROM campaigns');

    expect(session.locked).toBe(true);
  });

  it('rejects invalid SQL as QUERY_INVALID before it reaches DuckDB', async () => {
    session = await createSession('q3');
    await registerFile(session, join(SAMPLES, 'campaigns.xlsx'), 'campaigns');

    const result = await query(session, 'DROP TABLE campaigns');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('QUERY_INVALID');

    // Proof the table really is untouched: still queryable afterwards.
    const followUp = await query(session, 'SELECT COUNT(*) AS n FROM campaigns');
    expect(followUp.ok).toBe(true);
  });

  it('reports a real SQL error (unknown column) as QUERY_INVALID, not a crash', async () => {
    session = await createSession('q4');
    await registerFile(session, join(SAMPLES, 'campaigns.xlsx'), 'campaigns');

    const result = await query(session, 'SELECT this_column_does_not_exist FROM campaigns');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('QUERY_INVALID');
  });

  it('truncates results beyond maxRows and reports it', async () => {
    session = await createSession('q5');
    await registerFile(session, join(SAMPLES, 'campaigns.xlsx'), 'campaigns');

    const result = await query(session, 'SELECT * FROM campaigns', { maxRows: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rows).toHaveLength(10);
    expect(result.data.truncated).toBe(true);
  });

  it('does not report truncation when the result fits under the cap', async () => {
    session = await createSession('q6');
    await registerFile(session, join(SAMPLES, 'campaigns.xlsx'), 'campaigns');

    const result = await query(session, 'SELECT DISTINCT channel FROM campaigns', { maxRows: 1000 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.truncated).toBe(false);
  });
});

describe('raceWithTimeout', () => {
  it('resolves to the promise value when it finishes before the timeout', async () => {
    const result = await raceWithTimeout(Promise.resolve('done'), 1000, () => {});
    expect(result).toBe('done');
  });

  it('resolves to TIMEOUT and calls onTimeout when the promise never settles in time', async () => {
    let interrupted = false;
    const neverResolves = new Promise<string>(() => {});

    const result = await raceWithTimeout(neverResolves, 20, () => {
      interrupted = true;
    });

    expect(result).toBe('TIMEOUT');
    expect(interrupted).toBe(true);
  });
});
