import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { columnLetters, findHeaderRange, inspectWorkbook, sheetSlug } from './workbookSheets';

const SAMPLES = join(import.meta.dirname, '..', '..', '..', 'samples');

describe('inspectWorkbook', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'workbook-sheets-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists the one sheet of samples/campaigns.xlsx with no header override, so it reads as before', async () => {
    const result = await inspectWorkbook(join(SAMPLES, 'campaigns.xlsx'));
    expect(result).toEqual({ ok: true, data: [{ name: 'campaigns', index: 0, empty: false }] });
  });

  it('lists every sheet in tab order, marks empty ones, and finds a header under a title row', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Revenue').addRows([['region', 'amount'], ['EU', 10]]);
    workbook.addWorksheet('Blank');
    const titled = workbook.addWorksheet('Q2 Budget');
    titled.addRow(['Budget report']);
    titled.addRow([]);
    titled.getCell('B3').value = 'team';
    titled.getCell('C3').value = 'budget';
    titled.getCell('B4').value = 'ops';
    titled.getCell('C4').value = 5;
    titled.getCell('B5').value = 'eng';
    titled.getCell('C5').value = 7;
    titled.getCell('C40').style = { font: { bold: true } }; // formatting only, no value: not part of the range
    const path = join(dir, 'multi.xlsx');
    await workbook.xlsx.writeFile(path);

    const result = await inspectWorkbook(path);

    expect(result).toEqual({
      ok: true,
      data: [
        { name: 'Revenue', index: 0, empty: false },
        { name: 'Blank', index: 1, empty: true },
        { name: 'Q2 Budget', index: 2, empty: false, headerRange: 'B3:C5' },
      ],
    });
  });

  it('fails, never throws, for a file that is not a workbook', async () => {
    const path = join(dir, 'not-a-workbook.xlsx');
    await writeFile(path, 'plain text');

    const result = await inspectWorkbook(path);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PARSE_FAILED');
  });
});

describe('findHeaderRange', () => {
  const extent = () => ({ left: 1, right: 4, bottom: 50 });

  it('returns nothing when the header is already the first row', () => {
    expect(findHeaderRange([4, 4, 4], extent)).toBeUndefined();
  });

  it('returns nothing when only blank rows sit above the header, which DuckDB already skips', () => {
    expect(findHeaderRange([0, 0, 4, 4], extent)).toBeUndefined();
  });

  it('starts the range at the header when a title row sits above it', () => {
    expect(findHeaderRange([1, 0, 4, 4], extent)).toBe('A3:D50');
  });

  it('returns nothing for a single-column sheet, where no row has two filled cells', () => {
    expect(findHeaderRange([1, 1, 1], extent)).toBeUndefined();
  });

  it('returns nothing when there is no data under the header', () => {
    expect(findHeaderRange([1, 3], () => ({ left: 1, right: 3, bottom: 2 }))).toBeUndefined();
  });
});

describe('sheet naming helpers', () => {
  it('columnLetters converts 1-based column numbers', () => {
    expect([1, 2, 26, 27, 52, 703].map(columnLetters)).toEqual(['A', 'B', 'Z', 'AA', 'AZ', 'AAA']);
  });

  it('sheetSlug makes a table-safe slug and falls back to the tab position', () => {
    expect(sheetSlug('Q2 Budget', 1)).toBe('q2_budget');
    expect(sheetSlug("  Customers' list (EU) ", 2)).toBe('customers_list_eu');
    expect(sheetSlug('???', 3)).toBe('sheet4');
  });
});
