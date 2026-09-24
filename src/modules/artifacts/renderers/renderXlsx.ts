import ExcelJS from 'exceljs';
import QuickChart from 'quickchart-js';
import type { WorkbookPlan } from '@/modules/artifacts/schemas/workbook';
import type { ChartSpec } from '@/modules/artifacts/schemas/common';
import type { Evidence } from '@/types/evidence';

/**
 * P6.3, skills/excel-workbook/SKILL.md. Renders a validated `WorkbookPlan` plus the
 * real underlying dataset into an .xlsx buffer, using exceljs. Five sheets, in this
 * exact order: Summary, Recommendations, Data, Calculations, Sources.
 *
 * The rule that matters most (the skill's own words): "Calculations contain formulas,
 * not values." Every Calculations row gets a live exceljs formula value, never a
 * pre-computed number, so a reviewer who opens the file and clicks a cell sees how the
 * number was derived.
 *
 * `evidence` (the full gathered ledger for this artifact) is accepted per the module
 * contract but is not read here: grounding was already enforced by `validatePlan`
 * before this renderer ever runs (docs/04-MODULES.md M6, "eight steps, one model
 * call"), and every Sources row this renderer writes comes straight off
 * `plan.sources`, which is already the authored, validated projection of that ledger.
 * Re-deriving it from `evidence` here would just be re-doing validation this module is
 * not responsible for.
 */
export async function renderXlsx(
  plan: WorkbookPlan,
  dataRows: Record<string, unknown>[],
  // Not read: part of the module's fixed contract; see doc comment above for why.
  evidence: Evidence[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet('Summary');
  const recommendationsSheet = workbook.addWorksheet('Recommendations');
  const dataSheet = workbook.addWorksheet('Data');
  const calculationsSheet = workbook.addWorksheet('Calculations');
  const sourcesSheet = workbook.addWorksheet('Sources');

  await buildSummarySheet(workbook, summarySheet, plan);
  buildRecommendationsSheet(recommendationsSheet, plan);
  buildDataSheet(dataSheet, dataRows);
  buildCalculationsSheet(calculationsSheet, plan);
  buildSourcesSheet(sourcesSheet, plan);

  for (const sheet of [summarySheet, recommendationsSheet, dataSheet, calculationsSheet, sourcesSheet]) {
    autoSizeColumns(sheet);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * skills/excel-workbook, "Summary sheet header" (added P6.1): before the headline
 * numbers, a reviewer opening the file cold needs the title, the client name, the date
 * range the data covers, and the date the workbook was generated, so they never have to
 * ask what this is or how current it is. `preparedFor` and `dateRange` are optional on
 * the schema; when absent, their header line is simply skipped rather than printed
 * blank.
 */
async function buildSummarySheet(workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet, plan: WorkbookPlan): Promise<void> {
  let row = 1;

  const titleCell = sheet.getCell(row, 1);
  titleCell.value = plan.title;
  titleCell.font = { bold: true, size: 16 };
  row += 1;

  if (plan.preparedFor) {
    sheet.getCell(row, 1).value = `Prepared for: ${plan.preparedFor}`;
    row += 1;
  }
  if (plan.dateRange) {
    sheet.getCell(row, 1).value = `Date range: ${plan.dateRange}`;
    row += 1;
  }
  sheet.getCell(row, 1).value = `Generated: ${plan.generatedAt}`;
  row += 1;

  row += 1; // spacer

  sheet.getCell(row, 1).value = 'Metric';
  sheet.getCell(row, 2).value = 'Value';
  sheet.getRow(row).font = { bold: true };
  row += 1;

  for (const stat of plan.summary.headline) {
    sheet.getCell(row, 1).value = stat.label;
    const valueCell = sheet.getCell(row, 2);
    valueCell.value = stat.value;
    if (typeof stat.value === 'number') {
      const format = classifyHeadlineFormat(stat.label);
      if (format === 'percent') valueCell.numFmt = '0.0%';
      else if (format === 'currency') valueCell.numFmt = '$#,##0.00';
    }
    row += 1;
  }

  row += 1; // spacer

  sheet.getCell(row, 1).value = 'Key findings';
  sheet.getCell(row, 1).font = { bold: true };
  row += 1;

  for (const finding of plan.summary.findings) {
    sheet.getCell(row, 1).value = `• ${finding}`;
    row += 1;
  }

  if (!plan.chart) return;

  row += 1; // spacer before the chart

  if (plan.chart.kind === 'bigNumber') {
    // QuickChart has no "big number" chart type; write the single value as a large
    // font cell instead of embedding an image, per P6.3.
    const point = plan.chart.data[0];
    sheet.getCell(row, 1).value = plan.chart.title;
    sheet.getCell(row, 1).font = { bold: true };
    row += 1;
    const bigCell = sheet.getCell(row, 1);
    bigCell.value = point.value;
    bigCell.font = { bold: true, size: 36 };
    return;
  }

  const imageBuffer = await renderChartImage(plan.chart);
  // exceljs's own .d.ts declares a local `Buffer` type (extends ArrayBuffer) distinct
  // from Node's real Buffer that quickchart-js hands back and that `addImage` actually
  // expects at runtime; the cast bridges those two structurally incompatible shapes.
  const imageId = workbook.addImage({ buffer: imageBuffer, extension: 'png' } as unknown as Parameters<typeof workbook.addImage>[0]);
  sheet.addImage(imageId, {
    tl: { col: 0, row }, // exceljs anchors are zero based; `row` is the next free 1-based row
    ext: { width: 600, height: 360 },
  });
}

type HeadlineFormat = 'percent' | 'currency' | 'number';

const PERCENT_LABEL_SIGNALS = ['rate', '%', 'ctr', 'cvr', 'roas'];
const CURRENCY_LABEL_SIGNALS = ['spend', 'revenue', 'cpa', 'cpc', 'aov', '$'];

/**
 * Decides how a headline number should be formatted purely from its label text, never
 * from its magnitude (a 4.2 could be "4.2%" or "$4.20"; the label is the only reliable
 * signal). A label matching a percent signal is assumed to already carry its decimal
 * form (0.042, not 4.2), which is how this system's evidence values are produced.
 */
function classifyHeadlineFormat(label: string): HeadlineFormat {
  const lower = label.toLowerCase();
  if (PERCENT_LABEL_SIGNALS.some((signal) => lower.includes(signal))) return 'percent';
  if (CURRENCY_LABEL_SIGNALS.some((signal) => lower.includes(signal))) return 'currency';
  return 'number';
}

/**
 * Builds a Chart.js config from a `ChartSpec` and renders it to a PNG via QuickChart's
 * hosted API. Used for the Summary sheet's embedded chart image only: skills/excel-
 * workbook is explicit that "Excel charts must be embedded as images, no JavaScript
 * library writes native ones", which is why this is a small inline concern of this
 * renderer rather than a call into `../renderChart` (that module is scoped to the Word
 * and PDF renderers per P6.5, and is owned by a different in-flight task).
 */
async function renderChartImage(chart: ChartSpec): Promise<Buffer> {
  const quickChart = new QuickChart();
  quickChart.setWidth(600);
  quickChart.setHeight(360);
  quickChart.setBackgroundColor('#ffffff');
  quickChart.setVersion('3.9.1');
  quickChart.setConfig(buildChartConfig(chart));
  return quickChart.toBinary();
}

function buildChartConfig(chart: ChartSpec): Record<string, unknown> {
  const labels = chart.data.map((point) => point.label);
  const values = chart.data.map((point) => point.value);
  const titlePlugin = { title: { display: true, text: chart.title } };
  const axisTitles = {
    x: { title: { display: Boolean(chart.xLabel), text: chart.xLabel ?? '' } },
    y: { title: { display: Boolean(chart.yLabel), text: chart.yLabel ?? '' } },
  };

  switch (chart.kind) {
    case 'bar':
      return {
        type: 'bar',
        data: { labels, datasets: [{ label: chart.title, data: values }] },
        options: { plugins: titlePlugin, scales: axisTitles },
      };
    case 'line':
      return {
        type: 'line',
        data: { labels, datasets: [{ label: chart.title, data: values, fill: false }] },
        options: { plugins: titlePlugin, scales: axisTitles },
      };
    case 'stackedBar':
      // "map 'stackedBar' to a Chart.js bar chart with scales.x.stacked / scales.y.stacked true" (P6.3).
      return {
        type: 'bar',
        data: { labels, datasets: [{ label: chart.title, data: values }] },
        options: {
          plugins: titlePlugin,
          scales: {
            x: { ...axisTitles.x, stacked: true },
            y: { ...axisTitles.y, stacked: true },
          },
        },
      };
    case 'scatter':
      return {
        type: 'scatter',
        data: {
          datasets: [
            {
              label: chart.title,
              data: chart.data.map((point, i) => ({ x: Number(point.label) || i, y: point.value })),
            },
          ],
        },
        options: { plugins: titlePlugin, scales: axisTitles },
      };
    case 'pie':
      return {
        type: 'pie',
        data: { labels, datasets: [{ data: values }] },
        options: { plugins: titlePlugin },
      };
    case 'bigNumber':
      // Never reached: buildSummarySheet handles 'bigNumber' before calling this.
      throw new Error('bigNumber charts are not rendered as images');
  }
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

/**
 * skills/excel-workbook, "Recommendations sheet shape": Finding / Recommendation /
 * Rationale / Supporting data / Confidence, one row per finding. The supporting data
 * cell is written as a real Excel hyperlink into the Data sheet's own range ("a real
 * range reference so the reader can jump to the rows"), not just a text label that
 * happens to look like one.
 */
function buildRecommendationsSheet(sheet: ExcelJS.Worksheet, plan: WorkbookPlan): void {
  sheet.columns = [
    { header: 'Finding', key: 'finding' },
    { header: 'Recommendation', key: 'recommendation' },
    { header: 'Rationale', key: 'rationale' },
    { header: 'Supporting data', key: 'supportingData' },
    { header: 'Confidence', key: 'confidence' },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const recommendation of plan.recommendations) {
    const newRow = sheet.addRow({
      finding: recommendation.findingId,
      recommendation: recommendation.recommendation,
      rationale: recommendation.rationale,
      confidence: recommendation.confidence,
    });
    newRow.getCell('supportingData').value = {
      text: recommendation.supportingDataRange,
      hyperlink: `#${recommendation.supportingDataRange}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/**
 * skills/excel-workbook, "Data" sheet: the underlying rows, exactly as gathered, never
 * invented or reshaped. Headers are the union of keys across all rows (order of first
 * appearance), so a sparse row never loses a column another row defines. Frozen header
 * row and a full-range autofilter, per the skill and P6.3.
 */
function buildDataSheet(sheet: ExcelJS.Worksheet, dataRows: Record<string, unknown>[]): void {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of dataRows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  sheet.columns = headers.map((header) => ({ header, key: header }));
  sheet.getRow(1).font = { bold: true };

  for (const row of dataRows) {
    sheet.addRow(row);
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  if (headers.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(dataRows.length + 1, 1), column: headers.length },
    };
  }
}

// ---------------------------------------------------------------------------
// Calculations
// ---------------------------------------------------------------------------

/**
 * skills/excel-workbook, "the rule that matters most": Calculations holds live
 * formulas, never values. `WorkbookPlanSchema` already enforces that every
 * `calc.formula` starts with "="; exceljs formula cell values take the formula text
 * WITHOUT that leading "=", so it is stripped here before assigning. Leaving `result`
 * unset is fine and intentional: Excel computes the value itself on open, this module
 * has no formula engine of its own.
 */
function buildCalculationsSheet(sheet: ExcelJS.Worksheet, plan: WorkbookPlan): void {
  sheet.columns = [
    { header: 'Label', key: 'label' },
    { header: 'Formula', key: 'formula' },
    { header: 'Evidence', key: 'evidence' },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const calculation of plan.calculations) {
    const newRow = sheet.addRow({
      label: calculation.label,
      evidence: calculation.evidenceIds.join(', '),
    });
    newRow.getCell('formula').value = { formula: calculation.formula.slice(1) };
  }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** skills/excel-workbook, "Sources": one row per evidence entry, per skills/evidence-citation's citation format. */
function buildSourcesSheet(sheet: ExcelJS.Worksheet, plan: WorkbookPlan): void {
  sheet.columns = [
    { header: 'Evidence ID', key: 'evidenceId' },
    { header: 'Claim', key: 'claim' },
    { header: 'Source', key: 'sourceName' },
    { header: 'Locator', key: 'locator' },
    { header: 'Method', key: 'method' },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const source of plan.sources) {
    sheet.addRow({
      evidenceId: source.evidenceId,
      claim: source.claim,
      sourceName: source.sourceName,
      locator: source.locator,
      method: source.method ?? '',
    });
  }
}

// ---------------------------------------------------------------------------
// Shared formatting
// ---------------------------------------------------------------------------

/**
 * skills/excel-workbook, "Formatting": "Column widths set, no truncated headers", kept
 * to a min of 10 and a max of 40 (P6.3), so a long rationale does not blow the sheet out
 * while a short header never gets cut off. Works for every sheet in this file, whether
 * its columns were declared via `sheet.columns` (Recommendations, Data, Calculations,
 * Sources) or written cell by cell (Summary's header block).
 */
function autoSizeColumns(sheet: ExcelJS.Worksheet, minWidth = 10, maxWidth = 40): void {
  const widthByColumn = new Map<number, number>();
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const length = cellDisplayText(cell.value).length + 2;
      const current = widthByColumn.get(columnNumber) ?? minWidth;
      if (length > current) widthByColumn.set(columnNumber, length);
    });
  });
  for (const [columnNumber, width] of widthByColumn) {
    sheet.getColumn(columnNumber).width = Math.min(maxWidth, Math.max(minWidth, width));
  }
}

/** Renders any exceljs `CellValue` shape as plain text, for width measurement only. */
function cellDisplayText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text; // hyperlink value
    if ('formula' in value && typeof value.formula === 'string') return `=${value.formula}`; // formula value
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((run) => run.text).join('');
    }
    return '';
  }
  return String(value);
}
