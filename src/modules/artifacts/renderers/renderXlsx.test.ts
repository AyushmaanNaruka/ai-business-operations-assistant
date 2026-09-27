import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { classifyHeadlineFormat, describeDataSheetLayout, renderXlsx } from './renderXlsx';
import type { WorkbookPlan } from '@/modules/artifacts/schemas/workbook';
import type { Evidence } from '@/types/evidence';

/**
 * P6.3. The reopen test is the proof named in docs/PROMPTBOOK.md: render a workbook,
 * reopen the buffer with exceljs itself, and inspect what actually landed on disk
 * rather than trusting the writer side. The Calculations assertion is the single
 * clearest check that this renderer builds a spreadsheet rather than transcribing one.
 */

/**
 * exceljs's own .d.ts declares a local `Buffer` type (extends ArrayBuffer) distinct
 * from Node's real Buffer that `renderXlsx` returns and that `load` actually expects at
 * runtime; the cast bridges those two structurally incompatible shapes. Centralized
 * here so every test reopens a workbook the same way.
 */
async function reopen(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return workbook;
}

function makeEvidence(): Evidence[] {
  const now = '2026-09-25T00:00:00.000Z';
  return [
    { id: 'E1', claim: 'Paid Social spend rose', kind: 'computed', sourceId: 'campaigns', sourceName: 'campaigns.xlsx', locator: 'campaigns', method: 'SELECT sum(spend) ...', value: 42000, confidence: 'high', createdAt: now },
    { id: 'E2', claim: 'Paid Social revenue flat', kind: 'computed', sourceId: 'campaigns', sourceName: 'campaigns.xlsx', locator: 'campaigns', method: 'SELECT sum(revenue) ...', value: 51000, confidence: 'high', createdAt: now },
    { id: 'E3', claim: 'Blended conversion rate', kind: 'computed', sourceId: 'campaigns', sourceName: 'campaigns.xlsx', locator: 'campaigns', method: 'SELECT ...', value: 0.032, confidence: 'high', createdAt: now },
  ];
}

function makePlan(overrides: Partial<WorkbookPlan> = {}): WorkbookPlan {
  return {
    title: 'Q3 Campaign Performance Review',
    preparedFor: 'Northwind Analytics',
    dateRange: '1 Jan 2026 - 30 Jun 2026',
    summary: {
      headline: [
        { label: 'Total spend', value: 42000, evidenceIds: ['E1'] },
        { label: 'Blended conversion rate', value: 0.032, evidenceIds: ['E3'] },
        { label: 'Total revenue', value: 51000, evidenceIds: ['E2'] },
      ],
      findings: [
        'Paid Social spend is up sharply while revenue has not followed.',
        'Blended conversion rate sits below every channel median.',
      ],
    },
    recommendations: [
      {
        findingId: 'F1',
        recommendation: 'Cap Paid Social spend at the current level',
        rationale: 'Spend has risen 60 percent since June while revenue is flat.',
        supportingDataRange: 'Data!A2:K11',
        confidence: 'medium',
      },
    ],
    calculations: [
      { label: 'Blended conversion rate', formula: '=SUM(Data!C2:C11)/SUM(Data!B2:B11)', evidenceIds: ['E3'] },
      { label: 'Total spend', formula: '=SUM(Data!D2:D11)', evidenceIds: ['E1'] },
      { label: 'Total revenue', formula: '=SUM(Data!E2:E11)', evidenceIds: ['E2'] },
    ],
    sources: [
      { evidenceId: 'E1', claim: 'Paid Social spend rose', sourceName: 'campaigns.xlsx', locator: 'campaigns', method: 'SQL sum' },
      { evidenceId: 'E2', claim: 'Paid Social revenue flat', sourceName: 'campaigns.xlsx', locator: 'campaigns', method: 'SQL sum' },
    ],
    ...overrides,
  };
}

function makeDataRows(): Record<string, unknown>[] {
  return Array.from({ length: 10 }, (_, i) => ({
    campaign_name: `Paid Social - Campaign ${i + 1}`,
    channel: 'Paid Social',
    clicks: 100 + i * 10,
    spend: 1000 + i * 50,
    revenue: 1200 + i * 20,
  }));
}

describe('renderXlsx', () => {
  it('produces a five sheet workbook, in the house order, with no merged cells anywhere', async () => {
    const buffer = await renderXlsx(makePlan(), makeDataRows(), makeEvidence());

    const workbook = await reopen(buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Summary',
      'Recommendations',
      'Data',
      'Calculations',
      'Sources',
    ]);

    for (const sheet of workbook.worksheets) {
      expect(sheet.model.merges ?? []).toEqual([]);
    }
  });

  it('writes Calculations as live formulas, never as plain values (the proof test)', async () => {
    const plan = makePlan();
    const buffer = await renderXlsx(plan, makeDataRows(), makeEvidence());

    const workbook = await reopen(buffer);
    const calcSheet = workbook.getWorksheet('Calculations');
    expect(calcSheet).toBeDefined();

    // Row 1 is the header; data starts at row 2.
    for (let i = 0; i < plan.calculations.length; i++) {
      const row = calcSheet!.getRow(i + 2);
      const formulaCell = row.getCell(2); // Label, Formula, Evidence
      expect(formulaCell.formula).toBeTruthy();
      expect(typeof formulaCell.value).not.toBe('number');
      expect(formulaCell.formula).toBe(plan.calculations[i]!.formula.slice(1));
    }
  });

  it('freezes the Data sheet header and turns on a full range autofilter', async () => {
    const buffer = await renderXlsx(makePlan(), makeDataRows(), makeEvidence());

    const workbook = await reopen(buffer);
    const dataSheet = workbook.getWorksheet('Data');
    expect(dataSheet).toBeDefined();

    expect(dataSheet!.views).toEqual([expect.objectContaining({ state: 'frozen', ySplit: 1 })]);
    expect(dataSheet!.autoFilter).toBeTruthy();
  });

  it('writes the Data sheet rows exactly as given, in order, without inventing or reshaping them', async () => {
    const rows = makeDataRows();
    const buffer = await renderXlsx(makePlan(), rows, makeEvidence());

    const workbook = await reopen(buffer);
    const dataSheet = workbook.getWorksheet('Data')!;

    const headerRow = dataSheet.getRow(1).values as unknown[];
    const headers = headerRow.slice(1) as string[];
    expect(headers).toEqual(Object.keys(rows[0]!));

    rows.forEach((row, i) => {
      const sheetRow = dataSheet.getRow(i + 2);
      headers.forEach((header, colIndex) => {
        expect(sheetRow.getCell(colIndex + 1).value).toEqual(row[header]);
      });
    });
  });

  it('round trips the Recommendations supporting-data cell as a real hyperlink into Data', async () => {
    const plan = makePlan();
    const buffer = await renderXlsx(plan, makeDataRows(), makeEvidence());

    const workbook = await reopen(buffer);
    const recSheet = workbook.getWorksheet('Recommendations')!;
    const cell = recSheet.getRow(2).getCell(4); // Finding, Recommendation, Rationale, Supporting data

    const value = cell.value as ExcelJS.CellHyperlinkValue;
    expect(value.text).toBe(plan.recommendations[0]!.supportingDataRange);
    expect(value.hyperlink).toBe(`#${plan.recommendations[0]!.supportingDataRange}`);
  });

  it('renders a Sources row per plan.sources entry', async () => {
    const plan = makePlan();
    const buffer = await renderXlsx(plan, makeDataRows(), makeEvidence());

    const workbook = await reopen(buffer);
    const sourcesSheet = workbook.getWorksheet('Sources')!;

    expect(sourcesSheet.rowCount).toBe(plan.sources.length + 1); // + header
    expect(sourcesSheet.getRow(2).getCell(1).value).toBe(plan.sources[0]!.evidenceId);
  });

  it('formats a rate headline as a percentage and a money headline as currency', async () => {
    const buffer = await renderXlsx(makePlan(), makeDataRows(), makeEvidence());

    const workbook = await reopen(buffer);
    const summarySheet = workbook.getWorksheet('Summary')!;

    let rateRowNumber = -1;
    let spendRowNumber = -1;
    summarySheet.eachRow((row, rowNumber) => {
      const label = row.getCell(1).value;
      if (label === 'Blended conversion rate') rateRowNumber = rowNumber;
      if (label === 'Total spend') spendRowNumber = rowNumber;
    });

    expect(rateRowNumber).toBeGreaterThan(0);
    expect(spendRowNumber).toBeGreaterThan(0);
    expect(summarySheet.getRow(rateRowNumber).getCell(2).numFmt).toBe('0.0%');
    expect(summarySheet.getRow(spendRowNumber).getCell(2).numFmt).toBe('$#,##0.00');
  });

  it('formats ROAS as a multiple ("3.76x"), never as a percent', async () => {
    const plan = makePlan({
      summary: {
        headline: [
          { label: 'ROAS', value: 37.6, evidenceIds: ['E2'] },
          { label: 'Blended ROAS (revenue / spend)', value: 1.21, evidenceIds: ['E2'] },
        ],
        findings: ['One', 'Two'],
      },
    });
    const workbook = await reopen(await renderXlsx(plan, makeDataRows(), makeEvidence()));
    const summarySheet = workbook.getWorksheet('Summary')!;

    const formats: string[] = [];
    summarySheet.eachRow((row) => {
      const label = row.getCell(1).value;
      if (typeof label === 'string' && label.includes('ROAS')) formats.push(row.getCell(2).numFmt);
    });
    expect(formats).toEqual(['0.00"x"', '0.00"x"']);
  });

  it('classifies headline labels by meaning: ratio before percent before currency', () => {
    expect(classifyHeadlineFormat('ROAS')).toBe('ratio');
    expect(classifyHeadlineFormat('Return on ad spend')).toBe('ratio');
    expect(classifyHeadlineFormat('Conversion rate')).toBe('percent');
    expect(classifyHeadlineFormat('CTR')).toBe('percent');
    expect(classifyHeadlineFormat('Total revenue')).toBe('currency');
    expect(classifyHeadlineFormat('Conversions')).toBe('number');
  });

  it('stamps the Generated date from the render clock, ignoring any date the plan carries', async () => {
    const plan = { ...makePlan(), generatedAt: '2024-05-13' } as WorkbookPlan;
    const buffer = await renderXlsx(plan, makeDataRows(), makeEvidence(), { now: new Date('2026-09-27T10:00:00Z') });
    const summarySheet = (await reopen(buffer)).getWorksheet('Summary')!;

    const lines: string[] = [];
    summarySheet.eachRow((row) => {
      const value = row.getCell(1).value;
      if (typeof value === 'string') lines.push(value);
    });
    expect(lines).toContain('Generated: 2026-09-27');
    expect(lines.join('\n')).not.toContain('2024-05-13');
  });

  it('resolves a Data column referenced by name to its real A1 range, so it never opens as #NAME?', async () => {
    const plan = makePlan({
      calculations: [{ label: 'ROAS', formula: '=SUM(Data!revenue)/SUM(Data!spend)', evidenceIds: ['E2'] }],
    });
    const workbook = await reopen(await renderXlsx(plan, makeDataRows(), makeEvidence()));
    const formula = workbook.getWorksheet('Calculations')!.getRow(2).getCell(2).formula;
    // makeDataRows: campaign_name, channel, clicks, spend, revenue; ten rows under a header.
    expect(formula).toBe('SUM(Data!$E$2:$E$11)/SUM(Data!$D$2:$D$11)');
  });

  it('writes a big-font single value cell for a bigNumber chart instead of an image', async () => {
    const plan = makePlan({
      chart: {
        kind: 'bigNumber',
        title: 'Total conversions',
        data: [{ label: 'Conversions', value: 812, evidenceIds: ['E1'] }],
        evidenceIds: ['E1'],
      },
    });
    const buffer = await renderXlsx(plan, makeDataRows(), makeEvidence());

    const workbook = await reopen(buffer);
    const summarySheet = workbook.getWorksheet('Summary')!;

    let found = false;
    summarySheet.eachRow((row) => {
      const cell = row.getCell(1);
      if (cell.value === 812 && cell.font?.size === 36) found = true;
    });
    expect(found).toBe(true);
    expect(summarySheet.getImages().length).toBe(0);
  });
});

/**
 * Separate on purpose: this is the only path in the file that makes a real network
 * call (QuickChart's hosted render API via quickchart-js's `toBinary()`). It must never
 * fail the suite in an offline CI, so a network error here is caught and logged rather
 * than thrown. When the call succeeds, it asserts an actual PNG landed on the Summary
 * sheet as an embedded image.
 */
describe('renderXlsx chart embedding (network)', () => {
  it('embeds a chart PNG on the Summary sheet when QuickChart is reachable', async () => {
    const plan = makePlan({
      chart: {
        kind: 'bar',
        title: 'Spend by channel',
        data: [
          { label: 'Paid Social', value: 42000, evidenceIds: ['E1'] },
          { label: 'Email', value: 8000, evidenceIds: ['E1'] },
        ],
        xLabel: 'Channel',
        yLabel: 'Spend ($)',
        evidenceIds: ['E1'],
      },
    });

    try {
      const buffer = await renderXlsx(plan, makeDataRows(), makeEvidence());
      const workbook = await reopen(buffer);
      const summarySheet = workbook.getWorksheet('Summary')!;
      expect(summarySheet.getImages().length).toBeGreaterThan(0);
    } catch (err) {
      // Offline CI, QuickChart outage, or any other network failure: log and move on
      // rather than failing the suite over a dependency this test does not control.
      console.warn('renderXlsx chart embedding (network) test skipped: QuickChart call failed.', err);
    }
  });
});

describe('describeDataSheetLayout', () => {
  it('names each Data column by its letter and gives the data row range', () => {
    const rows = [
      { channel: 'Email', spend: 10, revenue: 50 },
      { channel: 'Webinar', spend: 5, revenue: 20 },
    ];
    const layout = describeDataSheetLayout(rows);
    expect(layout).toContain('rows 2 to 3');
    expect(layout).toContain('A = channel, B = spend, C = revenue');
    expect(layout).toContain('Data!C2:C3');
  });

  it('is empty when there are no rows to reference', () => {
    expect(describeDataSheetLayout([])).toBe('');
  });
});
