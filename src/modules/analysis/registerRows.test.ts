import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractTablesFromPdf } from '@/modules/documents';
import { closeSession, createSession, query, type DuckDBSession } from './index';
import { registerRows } from './registerRows';

const SAMPLES = join(import.meta.dirname, '..', '..', '..', 'samples');

describe('registerRows', () => {
  let session: DuckDBSession;

  afterEach(() => {
    if (session) closeSession(session);
  });

  it('registers a table with plain rows and infers text vs numeric columns', async () => {
    session = await createSession('rr1');

    const result = await registerRows(session, 'channels', {
      headers: ['Channel', 'Spend'],
      rows: [
        ['Email', '$1,200'],
        ['Paid Social', '$4,800'],
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rowCount).toBe(2);
    const spendColumn = result.data.columns.find((c) => c.name === 'spend');
    expect(spendColumn?.type.toUpperCase()).toContain('DOUBLE');

    const total = await query(session, 'SELECT SUM(spend) AS total FROM channels');
    expect(total.ok).toBe(true);
    if (total.ok) expect(total.data.rows[0]!.total).toBe(6000);
  });

  it('falls a column back to text when even one cell has no extractable number', async () => {
    session = await createSession('rr2');

    const result = await registerRows(session, 'plans', {
      headers: ['Plan', 'Tracked users'],
      rows: [
        ['Self-Serve', 'Up to 50,000'],
        ['Enterprise', 'Custom'],
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const trackedUsers = result.data.columns.find((c) => c.name === 'tracked_users');
    expect(trackedUsers?.type.toUpperCase()).toContain('VARCHAR');
  });

  it('rejects a table with no data rows rather than registering an empty one', async () => {
    session = await createSession('rr3');
    const result = await registerRows(session, 'empty', { headers: ['A', 'B'], rows: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NO_DATA');
  });

  it('end to end: the brief\'s pricing table extracts, registers, and sums correctly', async () => {
    session = await createSession('rr4');

    const extracted = await extractTablesFromPdf(join(SAMPLES, 'northwind-brief.pdf'));
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const pricing = extracted.data.find((t) => t.headers.includes('Plan'));
    expect(pricing).toBeDefined();

    const registered = await registerRows(session, 'northwind_brief_t1', pricing!);
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;

    expect(registered.data.rowCount).toBe(3);

    // Monthly price: $299/mo, $799/mo, and the Enterprise range's low end,
    // "$3,000 to $12,000/mo" -> the first number found, 3000. 299+799+3000 = 4098.
    const sum = await query(session, 'SELECT SUM(monthly_price) AS total FROM northwind_brief_t1');
    expect(sum.ok).toBe(true);
    if (sum.ok) expect(sum.data.rows[0]!.total).toBe(4098);
  });
});
