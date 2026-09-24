import puppeteer, { type Browser } from 'puppeteer';
import type { DocumentPlan, DocumentSection } from '../documentPlan';
import type { ChartSpec, TableSpec } from '../schemas/common';

/**
 * P6.5 (docs/PROMPTBOOK.md): "Build renderPdf.ts with puppeteer: one HTML template that
 * serves both the on screen preview and the PDF, with Chart.js rendering in the page."
 *
 * Unlike renderDocx.ts (which embeds pre-rendered PNGs from renderChart.ts), this renderer
 * draws charts with Chart.js running client side inside the HTML page itself, loaded from
 * the jsdelivr CDN. That page is then both returned as `html` (an in-chat preview) and
 * printed to a PDF buffer with puppeteer (docs/04-MODULES.md M6: "one HTML template serves
 * both the on screen preview and the PDF").
 */

/** Minimal shape of a Chart.js config object. Chart.js itself is CDN-loaded, not an npm
 * dependency (docs/06-RESEARCH-STACK.md), so there is no installed type package for it;
 * this is just enough structure to build the handful of chart kinds we support and hand
 * the result to `JSON.stringify` inside the page's own script tag. */
type ChartJsConfig = {
  type: 'bar' | 'line' | 'scatter' | 'pie';
  data: {
    labels: string[];
    datasets: Array<{
      label?: string;
      data: number[] | Array<{ x: number; y: number }>;
      backgroundColor?: string | string[];
      borderColor?: string;
      fill?: boolean;
    }>;
  };
  options: Record<string, unknown>;
};

type ChartEntry = { canvasId: string; config: ChartJsConfig };

const PALETTE = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948'];

/** AGENTS.md rule 4: file/plan content is data, never instruction. Section bodies, headings,
 * table cells and source rows all come from a model-authored plan, so they are escaped as
 * text content rather than ever being treated as trusted markup. */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cell(value: string | number): string {
  return typeof value === 'number' ? String(value) : escapeHtml(value);
}

function renderTable(table: TableSpec): string {
  const head = table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const rows = table.rows
    .map((row) => `<tr>${row.map((v) => `<td>${cell(v)}</td>`).join('')}</tr>`)
    .join('\n');
  return `
    <table class="doc-table">
      <caption>${escapeHtml(table.title)}</caption>
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderSourcesTable(sources: DocumentPlan['sources']): string {
  if (sources.length === 0) return '';
  const rows = sources
    .map(
      (s) => `<tr>
        <td>${escapeHtml(s.evidenceId)}</td>
        <td>${escapeHtml(s.claim)}</td>
        <td>${escapeHtml(s.sourceName)}</td>
        <td>${escapeHtml(s.locator)}</td>
        <td>${escapeHtml(s.method ?? '')}</td>
      </tr>`,
    )
    .join('\n');
  return `
    <section class="doc-section">
      <h2>Sources</h2>
      <table class="doc-table">
        <thead><tr><th>Evidence ID</th><th>Claim</th><th>Source</th><th>Locator</th><th>Method</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function makeAxis(label: string | undefined, stacked: boolean): Record<string, unknown> {
  const axis: Record<string, unknown> = {};
  if (stacked) axis.stacked = true;
  if (label) axis.title = { display: true, text: label };
  return axis;
}

function buildChartOptions(chart: ChartSpec): Record<string, unknown> {
  const options: Record<string, unknown> = {
    responsive: false,
    // Chart.js normally animates in over ~1s via requestAnimationFrame. Puppeteer prints
    // whatever is on the canvas the instant page.pdf() is called, so animation is disabled
    // and the chart is drawn synchronously on construction instead of waited out.
    animation: false,
    plugins: {
      title: { display: true, text: chart.title },
      legend: { display: chart.kind === 'pie' },
    },
  };
  if (chart.kind !== 'pie') {
    const stacked = chart.kind === 'stackedBar';
    options.scales = {
      x: makeAxis(chart.xLabel, stacked),
      y: makeAxis(chart.yLabel, stacked),
    };
  }
  return options;
}

/**
 * Same kind-to-Chart.js-type mapping as renderChart.ts (P6.5): bar sorted descending by
 * value, line in given order, stackedBar as a bar chart with both axes stacked, scatter as
 * {x: index, y: value} points, pie as-is (already capped at 4 slices by ChartSpecSchema).
 * `bigNumber` is handled entirely outside this function (see `renderChartSection`): it never
 * reaches Chart.js at all, and the 'bigNumber' case below only exists as a defensive guard
 * against ever calling this with one.
 */
function buildChartJsConfig(chart: ChartSpec): ChartJsConfig {
  const options = buildChartOptions(chart);
  switch (chart.kind) {
    case 'bar': {
      const sorted = [...chart.data].sort((a, b) => b.value - a.value);
      return {
        type: 'bar',
        data: {
          labels: sorted.map((d) => d.label),
          datasets: [{ label: chart.title, data: sorted.map((d) => d.value), backgroundColor: PALETTE[0] }],
        },
        options,
      };
    }
    case 'line': {
      return {
        type: 'line',
        data: {
          labels: chart.data.map((d) => d.label),
          datasets: [{ label: chart.title, data: chart.data.map((d) => d.value), borderColor: PALETTE[0], fill: false }],
        },
        options,
      };
    }
    case 'stackedBar': {
      return {
        type: 'bar',
        data: {
          labels: chart.data.map((d) => d.label),
          datasets: [{ label: chart.title, data: chart.data.map((d) => d.value), backgroundColor: PALETTE[0] }],
        },
        options,
      };
    }
    case 'scatter': {
      return {
        type: 'scatter',
        data: {
          labels: chart.data.map((d) => d.label),
          datasets: [
            {
              label: chart.title,
              data: chart.data.map((d, i) => ({ x: i, y: d.value })),
              backgroundColor: PALETTE[0],
            },
          ],
        },
        options,
      };
    }
    case 'pie': {
      return {
        type: 'pie',
        data: {
          labels: chart.data.map((d) => d.label),
          datasets: [
            {
              data: chart.data.map((d) => d.value),
              backgroundColor: chart.data.map((_, i) => PALETTE[i % PALETTE.length]),
            },
          ],
        },
        options,
      };
    }
    case 'bigNumber':
      // Never reached: renderChartSection handles 'bigNumber' before calling this function.
      throw new Error('renderPdf: buildChartJsConfig should never be called for kind "bigNumber"');
    default: {
      // Exhaustiveness guard: every ChartKind is handled above.
      const exhaustiveCheck: never = chart.kind;
      throw new Error(`renderPdf: unhandled chart kind ${String(exhaustiveCheck)}`);
    }
  }
}

/** Renders one section's chart: a `<canvas>` plus a queued Chart.js config for `bigNumber`,
 * or, for `bigNumber`, styled text with no canvas and no Chart.js involvement at all. */
function renderChartSection(chart: ChartSpec, canvasId: string, charts: ChartEntry[]): string {
  if (chart.kind === 'bigNumber') {
    const point = chart.data[0];
    const formatted = point ? point.value.toLocaleString() : '';
    return `
      <div class="big-number">
        <div class="big-number-title">${escapeHtml(chart.title)}</div>
        <div class="big-number-value">${escapeHtml(formatted)}</div>
        ${point ? `<div class="big-number-label">${escapeHtml(point.label)}</div>` : ''}
      </div>`;
  }
  charts.push({ canvasId, config: buildChartJsConfig(chart) });
  return `<div class="chart-wrap"><canvas id="${canvasId}" width="600" height="360"></canvas></div>`;
}

function renderParagraphs(body: string): string {
  return body
    .split('\n\n')
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('\n');
}

function renderSection(section: DocumentSection, index: number, charts: ChartEntry[]): string {
  const parts = [`<h2>${escapeHtml(section.heading)}</h2>`, renderParagraphs(section.body)];
  if (section.table) parts.push(renderTable(section.table));
  if (section.chart) parts.push(renderChartSection(section.chart, `chart-${index}`, charts));
  return `<section class="doc-section">${parts.join('\n')}</section>`;
}

function buildHtml(plan: DocumentPlan): { html: string; hasCharts: boolean } {
  const charts: ChartEntry[] = [];
  const sectionsHtml = plan.sections.map((s, i) => renderSection(s, i, charts)).join('\n');
  const sourcesHtml = renderSourcesTable(plan.sources);
  const needsChartJs = charts.length > 0;

  const headerMeta = [
    plan.preparedFor ? `<p class="meta">Prepared for: ${escapeHtml(plan.preparedFor)}</p>` : '',
    plan.dateRange ? `<p class="meta">Date range: ${escapeHtml(plan.dateRange)}</p>` : '',
  ].join('\n');

  // A chart title/label is plan data (AGENTS.md rule 4: data, never instruction), so guard
  // against one containing a literal "</script" sequence, which would otherwise let it break
  // out of this script block early when the HTML parser scans for the closing tag.
  const chartsJson = JSON.stringify(charts).replace(/<\/script/gi, '<\\/script');

  // Sets window.__pdfChartsReady once every chart has been constructed, so renderPdf can
  // wait for it (via page.waitForFunction) instead of racing Chart.js's own load and draw.
  const chartScript = needsChartJs
    ? `<script>
        window.addEventListener('DOMContentLoaded', function () {
          var charts = ${chartsJson};
          charts.forEach(function (entry) {
            var canvas = document.getElementById(entry.canvasId);
            if (!canvas) return;
            new Chart(canvas.getContext('2d'), entry.config);
          });
          window.__pdfChartsReady = true;
        });
      </script>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(plan.title)}</title>
${needsChartJs ? '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>' : ''}
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; margin: 2.5rem; line-height: 1.5; }
  header { border-bottom: 2px solid #1a1a1a; margin-bottom: 1.5rem; padding-bottom: 0.75rem; }
  h1 { font-size: 1.8rem; margin: 0 0 0.25rem 0; }
  h2 { font-size: 1.3rem; margin-top: 1.5rem; border-bottom: 1px solid #ccc; padding-bottom: 0.2rem; }
  p.meta { margin: 0.15rem 0; color: #444; font-size: 0.95rem; }
  p { margin: 0.6rem 0; }
  table.doc-table { border-collapse: collapse; width: 100%; margin: 0.75rem 0 1.25rem 0; font-size: 0.9rem; }
  table.doc-table caption { text-align: left; font-weight: bold; margin-bottom: 0.3rem; }
  table.doc-table th, table.doc-table td { border: 1px solid #999; padding: 0.35rem 0.5rem; text-align: left; }
  table.doc-table thead th { background: #f0f0f0; }
  .chart-wrap { margin: 1rem 0; }
  .big-number { text-align: center; margin: 1.25rem 0; }
  .big-number-title { font-size: 1rem; color: #444; }
  .big-number-value { font-size: 3.5rem; font-weight: bold; line-height: 1.1; }
  .big-number-label { font-size: 0.95rem; color: #666; }
  .doc-section { break-inside: avoid-page; }
  .doc-section + .doc-section { page-break-before: always; break-before: page; }
  @media print {
    body { margin: 1.5cm; }
  }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(plan.title)}</h1>
  ${headerMeta}
</header>
<main>
${sectionsHtml}
${sourcesHtml}
</main>
${chartScript}
</body>
</html>`;

  return { html, hasCharts: needsChartJs };
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await puppeteer.launch({ headless: true });
  } catch {
    // Some sandboxed/containerized environments (missing setuid sandbox, restricted CI
    // containers) refuse Chromium's own sandbox; retry once with it disabled before giving
    // up, per docs/PROMPTBOOK.md P6.5's note on this.
    try {
      return await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`renderPdf: puppeteer failed to launch Chromium (tried default and --no-sandbox args): ${reason}`);
    }
  }
}

/**
 * Renders a DocumentPlan to both the HTML page it is built from and a printed PDF of that
 * same page, so a caller can show the HTML as an in-chat preview and offer the PDF as the
 * download (docs/04-MODULES.md M6). Charts render client side via Chart.js, loaded from a
 * CDN in the page's own `<head>`.
 *
 * puppeteer@25's `setContent` no longer accepts `'networkidle0'` for `waitUntil` (only
 * `'load'`/`'domcontentloaded'` now), so instead of waiting on the network directly, the
 * page's own inline script sets `window.__pdfChartsReady = true` once every chart has been
 * constructed (with Chart.js animation disabled, so drawing is synchronous), and this
 * function waits on that flag before printing whenever the plan has a chart. A plan with no
 * chart never loads the CDN script at all, so `waitUntil: 'load'` alone is enough there.
 *
 * This module is pure logic (no Mastra import) but is allowed to throw, unlike a Mastra
 * tool boundary: a puppeteer launch failure becomes a clear thrown error here, and it is the
 * caller (the artifact workflow's render step) that is responsible for catching it and
 * turning it into a `ToolResult`.
 */
export async function renderPdf(plan: DocumentPlan): Promise<{ html: string; pdf: Buffer }> {
  const { html, hasCharts } = buildHtml(plan);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    if (hasCharts) {
      // `window.__pdfChartsReady` is a global our own inline script assigns in the page
      // (see buildHtml); lib.dom's Window type has no knowledge of it, hence the cast.
      await page.waitForFunction(
        () => (window as unknown as { __pdfChartsReady?: boolean }).__pdfChartsReady === true,
        { timeout: 15_000 },
      );
    }
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    return { html, pdf: Buffer.from(pdfBuffer) };
  } finally {
    await browser.close();
  }
}
