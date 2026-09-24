import QuickChart from 'quickchart-js';
import type { ChartSpec } from '@/modules/artifacts/schemas';

/**
 * Wraps `quickchart-js` (confirmed against the installed package at
 * node_modules/quickchart-js/build/typescript/index.d.ts: `new QuickChart()`,
 * `.setConfig(chartConfig)`, `.toBinary(): Promise<Buffer>`) to turn a `ChartSpec` into a
 * static PNG.
 *
 * Per docs/04-MODULES.md M6 and docs/PROMPTBOOK.md P6.5: "Used by the Word and PDF
 * renderers only; decks use native charts [pptxgenjs], and the xlsx renderer embeds its
 * own Summary-sheet chart image independently inline (a separate agent's concern, not
 * this file's)." This is the one place quickchart-js is wrapped in the whole module.
 */

/**
 * The subset of a Chart.js config this file actually builds. quickchart-js itself types
 * the config it accepts as `Record<string, any>` (it is deliberately version agnostic,
 * see its index.d.ts), but nothing here needs to touch `any`: we build a concrete plain
 * object and let structural typing hand it to `setConfig`.
 */
type ChartJsConfig = {
  type: 'bar' | 'line' | 'scatter' | 'pie';
  data: {
    labels?: string[];
    datasets: Array<{
      label?: string;
      data: number[] | { x: number; y: number }[];
    }>;
  };
  options?: Record<string, unknown>;
};

/** Title plugin plus, when present, axis titles. Shared by bar/line/scatter/stackedBar. */
function baseOptions(spec: ChartSpec): Record<string, unknown> {
  const scales: Record<string, unknown> = {};
  if (spec.xLabel) scales.x = { title: { display: true, text: spec.xLabel } };
  if (spec.yLabel) scales.y = { title: { display: true, text: spec.yLabel } };
  return {
    // Never 3D (skills/client-presentation), and QuickChart/Chart.js only renders flat
    // charts unless a 3D plugin is explicitly configured, which nothing here does.
    plugins: { title: { display: true, text: spec.title }, legend: { display: false } },
    ...(Object.keys(scales).length > 0 ? { scales } : {}),
  };
}

/** A stacked axis: `stacked: true` plus an optional title, for the `stackedBar` case. */
function stackedScale(axisLabel: string | undefined): Record<string, unknown> {
  return {
    stacked: true,
    ...(axisLabel ? { title: { display: true, text: axisLabel } } : {}),
  };
}

function buildConfig(spec: ChartSpec): ChartJsConfig {
  switch (spec.kind) {
    case 'bar': {
      // "Comparing categories -> horizontal bar, sorted by value" (skills/client-presentation).
      // Sort a COPY by value descending; never mutate the caller's spec.data.
      const sorted = [...spec.data].sort((a, b) => b.value - a.value);
      return {
        type: 'bar',
        data: {
          labels: sorted.map((d) => d.label),
          datasets: [{ label: spec.title, data: sorted.map((d) => d.value) }],
        },
        options: baseOptions(spec),
      };
    }

    case 'line':
      // Time series: keep the given order, do not sort.
      return {
        type: 'line',
        data: {
          labels: spec.data.map((d) => d.label),
          datasets: [{ label: spec.title, data: spec.data.map((d) => d.value) }],
        },
        options: baseOptions(spec),
      };

    case 'stackedBar':
      // ChartSpec carries one flat array of points, not multiple series. With only one
      // series, a "stacked" bar is a single bar per category with one segment each: a
      // degenerate but valid rendering, not a reason to fabricate additional series.
      return {
        type: 'bar',
        data: {
          labels: spec.data.map((d) => d.label),
          datasets: [{ label: spec.title, data: spec.data.map((d) => d.value) }],
        },
        options: {
          plugins: { title: { display: true, text: spec.title }, legend: { display: false } },
          scales: { x: stackedScale(spec.xLabel), y: stackedScale(spec.yLabel) },
        },
      };

    case 'scatter': {
      // ChartSpec has no explicit per-point x value (it is a flat label/value list, not an
      // {x, y} pair). Documented choice: use `value` as y, and for x use the point's label
      // parsed as a number when it parses cleanly (e.g. a numeric label like "2024"),
      // otherwise fall back to the point's index in the array.
      const points = spec.data.map((d, i) => {
        const parsed = Number(d.label);
        const x = d.label.trim() !== '' && Number.isFinite(parsed) ? parsed : i;
        return { x, y: d.value };
      });
      return {
        type: 'scatter',
        data: { datasets: [{ label: spec.title, data: points }] },
        options: baseOptions(spec),
      };
    }

    case 'pie':
      // Already capped at 4 entries by ChartSpecSchema's refine (docs: "never a pie with
      // more than 4 slices"); render exactly what was given, do not re-slice or re-cap.
      return {
        type: 'pie',
        data: {
          labels: spec.data.map((d) => d.label),
          datasets: [{ data: spec.data.map((d) => d.value) }],
        },
        options: { plugins: { title: { display: true, text: spec.title }, legend: { display: true } } },
      };

    case 'bigNumber': {
      // There is no Chart.js chart type for "one big number". Per skills/client-presentation
      // ("A single number that matters -> No chart. Large text"), callers (renderDocx,
      // renderPdf) should prefer NOT to call renderChart for a bigNumber spec at all, and
      // instead render the value as large text directly. This function must still handle
      // whatever spec it is given without throwing, so if asked for a bigNumber anyway it
      // renders a minimal single-bar placeholder rather than crashing.
      const [first] = spec.data;
      return {
        type: 'bar',
        data: {
          labels: [first.label],
          datasets: [{ label: spec.title, data: [first.value] }],
        },
        options: baseOptions(spec),
      };
    }
  }
}

/**
 * Renders a `ChartSpec` to a PNG image buffer via the hosted QuickChart API. Network or
 * non-200 failures are allowed to propagate as a rejected promise: this module is pure
 * logic, not a Mastra tool boundary (rule 5's `ToolResult` contract belongs to the
 * workflow step in P6.6 that calls this function and turns a rejection into a tool
 * failure), so nothing here swallows the error.
 */
export async function renderChart(spec: ChartSpec): Promise<Buffer> {
  const qc = new QuickChart();
  qc.setConfig(buildConfig(spec));
  qc.setBackgroundColor('white'); // embedded into white docx/pdf pages, never transparent
  qc.setWidth(600);
  qc.setHeight(400);
  qc.setDevicePixelRatio(2); // sharper when embedded at print resolution
  return qc.toBinary();
}
