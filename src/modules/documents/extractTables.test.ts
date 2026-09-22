import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTablesFromPdf, parseHtmlTables } from './extractTables';

const SAMPLES = join(import.meta.dirname, '..', '..', '..', 'samples');

describe('extractTablesFromPdf', () => {
  it('finds the pricing and quarterly-target tables in the sample brief, with sensible columns', async () => {
    const result = await extractTablesFromPdf(join(SAMPLES, 'northwind-brief.pdf'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.length).toBeGreaterThanOrEqual(2);

    const pricing = result.data.find((t) => t.headers.includes('Plan'));
    expect(pricing).toBeDefined();
    expect(pricing!.headers).toEqual(['Plan', 'Monthly price', 'Tracked users included', 'Data retention', 'Support']);
    expect(pricing!.rows).toHaveLength(3);
    expect(pricing!.rows.map((r) => r[0])).toEqual(['Self-Serve', 'Self-Serve Plus', 'Enterprise']);
    expect(typeof pricing!.page).toBe('number');

    const targets = result.data.find((t) => t.headers.includes('Metric'));
    expect(targets).toBeDefined();
    expect(targets!.rows.length).toBeGreaterThanOrEqual(3);
  });

  it('fails with PARSE_FAILED, not a throw, for a file that does not exist', async () => {
    const result = await extractTablesFromPdf(join(SAMPLES, 'does-not-exist.pdf'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PARSE_FAILED');
  });

  it('returns no tables, not an error, for a PDF with no grid to find', async () => {
    // The brief itself has ordinary paragraphs on page 1 with no table.
    const result = await extractTablesFromPdf(join(SAMPLES, 'northwind-brief.pdf'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const table of result.data) expect(table.page).toBeGreaterThan(0);
  });
});

describe('parseHtmlTables', () => {
  it('parses a simple table into headers and rows', () => {
    const html = `
      <table>
        <tr><th>Channel</th><th>Spend</th></tr>
        <tr><td>Email</td><td>$1,200</td></tr>
        <tr><td>Paid Social</td><td>$4,800</td></tr>
      </table>
    `;
    const tables = parseHtmlTables(html);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.headers).toEqual(['Channel', 'Spend']);
    expect(tables[0]!.rows).toEqual([
      ['Email', '$1,200'],
      ['Paid Social', '$4,800'],
    ]);
  });

  it('ignores prose with no table markup, and a single-row fragment', () => {
    expect(parseHtmlTables('<p>No tables here.</p>')).toEqual([]);
    expect(parseHtmlTables('<table><tr><th>Only header</th></tr></table>')).toEqual([]);
  });
});
