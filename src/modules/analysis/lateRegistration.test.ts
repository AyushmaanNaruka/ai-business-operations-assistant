import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { query } from './query';
import { registerRows } from './registerRows';
import { closeSession, createSession, registerFile, type DuckDBSession } from './session';

const SAMPLES = join(import.meta.dirname, '..', '..', '..', 'samples');
const FIXTURES = join(import.meta.dirname, '..', 'sources', '__fixtures__');

describe('registering a source after the first query has run', () => {
  let session: DuckDBSession;

  afterEach(() => {
    if (session) closeSession(session);
  });

  it('a second spreadsheet uploaded after a query still registers and is queryable', async () => {
    session = await createSession('late1');
    const first = await registerFile(session, join(SAMPLES, 'campaigns.xlsx'), 'campaigns');
    expect(first.ok).toBe(true);

    const firstQuery = await query(session, 'SELECT COUNT(*) AS n FROM campaigns');
    expect(firstQuery.ok).toBe(true);

    const second = await registerFile(session, join(SAMPLES, 'campaigns.xlsx'), 'campaigns_again');
    expect(second.ok).toBe(true);

    const secondQuery = await query(session, 'SELECT COUNT(*) AS n FROM campaigns_again');
    expect(secondQuery.ok).toBe(true);
    if (!secondQuery.ok || !firstQuery.ok) return;
    expect(secondQuery.data.rows[0]!.n).toBe(firstQuery.data.rows[0]!.n);
  });

  it('a late .csv registers too', async () => {
    session = await createSession('late2');
    await registerFile(session, join(SAMPLES, 'campaigns.xlsx'), 'campaigns');
    await query(session, 'SELECT 1 AS one');

    const late = await registerFile(session, join(FIXTURES, 'sample.csv'), 'late_csv');
    expect(late.ok).toBe(true);
    if (late.ok) expect(late.data.rowCount).toBe(2);
  });

  it('a document table extracted after a query still registers', async () => {
    session = await createSession('late3');
    await query(session, 'SELECT 1 AS one');

    const late = await registerRows(session, 'late_rows', { headers: ['Plan', 'Price'], rows: [['Basic', '$10']] });
    expect(late.ok).toBe(true);
  });

  it('model SQL still cannot read the filesystem after a late registration', async () => {
    session = await createSession('late4');
    await query(session, 'SELECT 1 AS one');
    await registerFile(session, join(FIXTURES, 'sample.csv'), 'late_csv');

    const path = join(FIXTURES, 'sample.csv').replace(/\\/g, '/');
    let threw = false;
    try {
      await session.connection.run(`SELECT * FROM read_csv_auto('${path}')`);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
