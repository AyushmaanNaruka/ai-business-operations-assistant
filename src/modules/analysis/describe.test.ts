import { join } from 'node:path';
import { afterEach, describe as suite, expect, it } from 'vitest';
import { describe } from './describe';
import { closeSession, createSession, registerFile, type DuckDBSession } from './session';

const SAMPLES = join(import.meta.dirname, '..', '..', '..', 'samples');

suite('describe', () => {
  let session: DuckDBSession;

  afterEach(() => {
    if (session) closeSession(session);
  });

  it('profiles the real campaigns.xlsx: schema, sample, duplicates, date formats', async () => {
    session = await createSession('d1');
    await registerFile(session, join(SAMPLES, 'campaigns.xlsx'), 'campaigns');

    const result = await describe(session, 'campaigns');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const profile = result.data;
    expect(profile.rowCount).toBeGreaterThan(1000);
    expect(profile.sample).toHaveLength(20);

    const revenue = profile.columns.find((c) => c.name === 'revenue');
    expect(revenue?.nullRate).toBeGreaterThan(0);
    expect(revenue?.nullRate).toBeLessThan(0.1); // planted at ~3%

    // Planted: 12-18 exact duplicate rows.
    expect(profile.duplicateRowCount).toBeGreaterThanOrEqual(12);
    expect(profile.duplicateRowCount).toBeLessThanOrEqual(18);

    // Planted: start_date written in three different formats; end_date is
    // always ISO, so it must show at most one format (not mixed).
    expect(profile.dateFormatsByColumn.start_date?.length).toBe(3);
    expect(profile.dateFormatsByColumn.end_date?.length ?? 1).toBe(1);
  });

  it('reports a clean failure for an unknown table rather than crashing', async () => {
    session = await createSession('d2');
    const result = await describe(session, 'does_not_exist');

    expect(result.ok).toBe(false);
  });
});
