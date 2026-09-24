import PptxGenJS from 'pptxgenjs';
import type { DeckPlan } from '@/modules/artifacts/schemas';
import type { ChartSpec, TableSpec } from '@/modules/artifacts/schemas/common';
import type { Evidence } from '@/types/evidence';

/**
 * Renders a `DeckPlan` (P6.2) to a real `.pptx` file with `pptxgenjs`, per P6.4 and
 * skills/client-presentation/SKILL.md. This is a pure rendering step: `validatePlan`
 * (`src/modules/artifacts/validate.ts`) has already checked grounding before a plan
 * reaches this function, so nothing here re-derives or second-guesses a number, per
 * rule 3 ("artifacts are built, not transcribed") — this file only lays out what the
 * plan already says, in the shapes the skill prescribes.
 *
 * Design decisions worth calling out because they are not obvious from the code:
 *
 * - **Slide master defined once, in code.** pptxgenjs cannot open a `.pptx` template
 *   file (there is no "load an existing deck's theme" API), so the one title
 *   placeholder position/font, the background, and the slide-number footer are all
 *   declared through `pptx.defineSlideMaster` and reused for every slide.
 *
 * - **Charts are always native (`slide.addChart`), never an image.** skills/
 *   client-presentation: "native PowerPoint charts... stay editable, look sharper".
 *   `renderChart.ts` (a sibling module, P6.5) renders PNGs for Word/PDF only; a deck
 *   never touches it. `bigNumber` is the one chart kind that renders no chart object
 *   at all, per the skill's own table ("A single number that matters: No chart. Large
 *   text").
 *
 * - **Scatter charts and the schema's single-value data points.** `ChartDataPoint` is
 *   `{ label, value, evidenceIds }`, one number per point. A scatter chart natively
 *   needs two numbers per point (x and y). pptxgenjs's own convention for a scatter
 *   chart is: the first data series' `values` are the X coordinates, every later
 *   series' `values` are Y coordinates plotted against them (there is no category/
 *   `labels` axis for a scatter chart at all). Since the schema does not carry a second
 *   number, a numeric `label` (e.g. "14.2") is read as that point's X coordinate; a
 *   non numeric `label` (a category name) falls back to its 1-based position so the
 *   point still plots, just without a meaningful X value. This is a deliberate,
 *   documented trade-off, not a bug: the alternative (refusing to render scatter at
 *   all) would silently drop a chart the model was asked to produce.
 *
 * - **Table auto-paging.** `TableProps.autoPage` is a real option on the pptxgenjs
 *   4.0.1 that ships in this repo (`node_modules/pptxgenjs/types/index.d.ts`): it
 *   creates additional slides when a table overflows its region rather than clipping
 *   rows silently. It is used as documented there, with `autoPageRepeatHeader` so a
 *   paged table keeps its header row.
 */

const MASTER_NAME = 'BOA_DECK_MASTER';

// Layout, in inches, on pptxgenjs's built-in 'LAYOUT_WIDE' canvas (13.33 x 7.5),
// the modern 16:9 widescreen size and the one most client decks are built to.
const SLIDE_W = 13.33;
const MARGIN_X = 0.5;
const TITLE_Y = 0.35;
const TITLE_H = 0.9;
const CONTENT_Y = 1.45;
const FOOTER_Y = 7.05;
const CONTENT_H = FOOTER_Y - 0.2 - CONTENT_Y;
const GUTTER = 0.35;
const VISUAL_GAP = 0.25;

const COLORS = {
  background: 'FFFFFF',
  title: '111827',
  rule: '2563EB',
  body: '374151',
  bigNumber: '2563EB',
  bigNumberCaption: '6B7280',
  tableHeaderFill: 'EEF2FF',
  tableHeaderText: '1E3A8A',
  tableBody: '374151',
  tableBorder: 'E5E7EB',
  footer: '9CA3AF',
  chartPalette: ['2563EB', '7C3AED', '059669', 'D97706', 'DC2626', '0891B2'],
};

type Region = { x: number; y: number; w: number; h: number };

/** The one master this deck uses for every slide: title placeholder, background, slide number. */
function defineMaster(pptx: PptxGenJS): void {
  pptx.defineSlideMaster({
    title: MASTER_NAME,
    background: { color: COLORS.background },
    objects: [
      {
        placeholder: {
          options: {
            name: 'title',
            type: 'title',
            x: MARGIN_X,
            y: TITLE_Y,
            w: SLIDE_W - MARGIN_X * 2,
            h: TITLE_H,
            fontFace: 'Calibri',
            fontSize: 26,
            bold: true,
            color: COLORS.title,
            align: 'left',
            valign: 'top',
          },
          text: 'Click to add title',
        },
      },
      // A thin accent rule under the title band, the only decoration the master adds.
      {
        line: {
          x: MARGIN_X,
          y: TITLE_Y + TITLE_H,
          w: SLIDE_W - MARGIN_X * 2,
          h: 0,
          line: { color: COLORS.rule, width: 1.5 },
        },
      },
    ],
    slideNumber: {
      x: SLIDE_W - MARGIN_X - 0.6,
      y: FOOTER_Y,
      w: 0.6,
      h: 0.3,
      fontFace: 'Calibri',
      fontSize: 10,
      color: COLORS.footer,
      align: 'right',
    },
  });
}

/** Splits the region below a stack of `count` visuals into equal, gap-separated bands. */
function stackVertical(region: Region, count: number): Region[] {
  if (count <= 1) return [region];
  const h = (region.h - VISUAL_GAP * (count - 1)) / count;
  return Array.from({ length: count }, (_, i) => ({
    x: region.x,
    y: region.y + i * (h + VISUAL_GAP),
    w: region.w,
    h,
  }));
}

/**
 * Lays out the content band under the title: bullets get a left column when a chart
 * and/or table shares the slide, and the full width when they are the only content.
 * A chart and a table on the same slide with no bullets stack top/bottom instead.
 */
function computeRegions(hasBullets: boolean, visualCount: number): { bullets?: Region; visuals: Region[] } {
  const fullWidth = SLIDE_W - MARGIN_X * 2;
  const fullRegion: Region = { x: MARGIN_X, y: CONTENT_Y, w: fullWidth, h: CONTENT_H };

  if (!hasBullets && visualCount === 0) return { visuals: [] };
  if (hasBullets && visualCount === 0) return { bullets: fullRegion, visuals: [] };
  if (!hasBullets) return { visuals: stackVertical(fullRegion, visualCount) };

  const leftW = (fullWidth - GUTTER) * 0.42;
  const rightW = fullWidth - GUTTER - leftW;
  const bullets: Region = { x: MARGIN_X, y: CONTENT_Y, w: leftW, h: CONTENT_H };
  const rightRegion: Region = { x: MARGIN_X + leftW + GUTTER, y: CONTENT_Y, w: rightW, h: CONTENT_H };
  return { bullets, visuals: stackVertical(rightRegion, visualCount) };
}

/** skills/client-presentation: "Five bullets maximum" (already enforced by the schema) and never more. */
function addBullets(slide: PptxGenJS.Slide, bullets: string[], region: Region): void {
  if (bullets.length === 0) return;
  slide.addText(
    bullets.map((text, i) => ({ text, options: { bullet: { indent: 18 }, breakLine: i < bullets.length - 1 } })),
    {
      x: region.x,
      y: region.y,
      w: region.w,
      h: region.h,
      fontFace: 'Calibri',
      fontSize: 16,
      color: COLORS.body,
      valign: 'top',
      align: 'left',
      lineSpacingMultiple: 1.15,
    },
  );
}

function formatBigNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** skills/client-presentation table: "A single number that matters: No chart. Large text." */
function addBigNumber(slide: PptxGenJS.Slide, chart: ChartSpec, region: Region): void {
  const point = chart.data[0];
  slide.addText(formatBigNumber(point.value), {
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h * 0.65,
    fontFace: 'Calibri',
    fontSize: 60,
    bold: true,
    color: COLORS.bigNumber,
    align: 'center',
    valign: 'bottom',
  });
  slide.addText(point.label, {
    x: region.x,
    y: region.y + region.h * 0.65,
    w: region.w,
    h: region.h * 0.35,
    fontFace: 'Calibri',
    fontSize: 14,
    color: COLORS.bigNumberCaption,
    align: 'center',
    valign: 'top',
  });
}

function addChartForSlide(pptx: PptxGenJS, slide: PptxGenJS.Slide, chart: ChartSpec, region: Region): void {
  if (chart.kind === 'bigNumber') {
    addBigNumber(slide, chart, region);
    return;
  }

  const baseOptions: PptxGenJS.IChartOpts = {
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    chartColors: COLORS.chartPalette,
    showTitle: true,
    title: chart.title,
    titleFontSize: 12,
    titleColor: COLORS.title,
    showLegend: false,
    legendPos: 'b',
    showValue: true,
    dataLabelFontSize: 9,
    catAxisTitle: chart.xLabel,
    showCatAxisTitle: Boolean(chart.xLabel),
    valAxisTitle: chart.yLabel,
    showValAxisTitle: Boolean(chart.yLabel),
    catAxisLabelFontSize: 9,
    valAxisLabelFontSize: 9,
  };

  switch (chart.kind) {
    case 'bar': {
      // skills/client-presentation: "Comparing categories -> Horizontal bar, sorted by value".
      const sorted = [...chart.data].sort((a, b) => b.value - a.value);
      slide.addChart(pptx.ChartType.bar, [{ name: chart.title, labels: sorted.map((d) => d.label), values: sorted.map((d) => d.value) }], {
        ...baseOptions,
        barDir: 'bar',
      });
      break;
    }
    case 'line': {
      // skills/client-presentation: "Change over time -> Line".
      slide.addChart(
        pptx.ChartType.line,
        [{ name: chart.title, labels: chart.data.map((d) => d.label), values: chart.data.map((d) => d.value) }],
        { ...baseOptions, lineSmooth: false, lineDataSymbol: 'circle' },
      );
      break;
    }
    case 'stackedBar': {
      // skills/client-presentation: "Composition -> Stacked bar, never a pie with more than four slices".
      slide.addChart(
        pptx.ChartType.bar,
        [{ name: chart.title, labels: chart.data.map((d) => d.label), values: chart.data.map((d) => d.value) }],
        { ...baseOptions, barDir: 'col', barGrouping: 'stacked' },
      );
      break;
    }
    case 'scatter': {
      // See the module doc comment for why the X series is derived this way.
      const xValues = chart.data.map((d, i) => {
        const parsed = Number(d.label);
        return Number.isFinite(parsed) ? parsed : i + 1;
      });
      slide.addChart(
        pptx.ChartType.scatter,
        [
          { name: chart.xLabel ?? 'X', values: xValues },
          { name: chart.yLabel ?? chart.title, values: chart.data.map((d) => d.value) },
        ],
        { ...baseOptions, showLegend: true, lineDataSymbol: 'circle' },
      );
      break;
    }
    case 'pie': {
      // ChartSpecSchema already refines a pie to at most 4 categories; sliced again here
      // so this renderer never relies on the schema alone for a rule this visible to a client.
      const data = chart.data.slice(0, 4);
      slide.addChart(pptx.ChartType.pie, [{ name: chart.title, labels: data.map((d) => d.label), values: data.map((d) => d.value) }], {
        ...baseOptions,
        showLegend: true,
        showPercent: true,
        dataLabelFormatCode: '0%',
      });
      break;
    }
    default: {
      // Exhaustiveness guard: if `ChartKind` ever grows a new member, this fails to
      // compile rather than silently rendering nothing for it.
      const exhaustiveCheck: never = chart.kind;
      void exhaustiveCheck;
    }
  }
}

function addTableForSlide(slide: PptxGenJS.Slide, table: TableSpec, region: Region): void {
  const headerRow: PptxGenJS.TableRow = table.headers.map((h) => ({
    text: h,
    options: { bold: true, color: COLORS.tableHeaderText, fill: { color: COLORS.tableHeaderFill }, fontSize: 11 },
  }));
  const bodyRows: PptxGenJS.TableRow[] = table.rows.map((row) =>
    row.map((cell) => ({ text: String(cell), options: { fontSize: 10, color: COLORS.tableBody } })),
  );
  slide.addTable([headerRow, ...bodyRows], {
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    fontFace: 'Calibri',
    border: { type: 'solid', color: COLORS.tableBorder, pt: 0.75 },
    autoPage: true,
    autoPageRepeatHeader: true,
    autoPageHeaderRows: 1,
  });
}

/** A small, optional footer naming the sources behind a slide's cited evidence. */
function addSourceFooter(slide: PptxGenJS.Slide, evidenceIds: string[], evidenceById: Map<string, Evidence>): void {
  if (evidenceIds.length === 0) return;
  const names = [...new Set(evidenceIds.map((id) => evidenceById.get(id)?.sourceName).filter((n): n is string => Boolean(n)))];
  if (names.length === 0) return;
  slide.addText(`Source: ${names.join(', ')}`, {
    x: MARGIN_X,
    y: FOOTER_Y,
    w: SLIDE_W - MARGIN_X * 2 - 1,
    h: 0.3,
    fontFace: 'Calibri',
    fontSize: 8,
    italic: true,
    color: COLORS.footer,
    align: 'left',
    valign: 'middle',
  });
}

export async function renderPptx(plan: DeckPlan, evidence: Evidence[]): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = plan.title;
  defineMaster(pptx);

  const evidenceById = new Map(evidence.map((e) => [e.id, e] as const));

  for (const s of plan.slides) {
    const slide = pptx.addSlide({ masterName: MASTER_NAME });

    // The slide title IS the message, per skills/client-presentation.md ("the slide
    // title is the message, not the topic"): rendered exactly as authored, never
    // rewritten or shortened here.
    slide.addText(s.title, { placeholder: 'title' });

    const hasChart = Boolean(s.chart);
    const hasTable = Boolean(s.table);
    const regions = computeRegions(s.bullets.length > 0, (hasChart ? 1 : 0) + (hasTable ? 1 : 0));

    if (regions.bullets) addBullets(slide, s.bullets, regions.bullets);

    let visualIndex = 0;
    if (s.chart) {
      addChartForSlide(pptx, slide, s.chart, regions.visuals[visualIndex]);
      visualIndex += 1;
    }
    if (s.table) {
      addTableForSlide(slide, s.table, regions.visuals[visualIndex]);
      visualIndex += 1;
    }

    addSourceFooter(slide, s.evidenceIds, evidenceById);

    // Speaker notes on every slide, always: `DeckPlanSchema` already requires `notes` to
    // be a non empty string, but this call is unconditional regardless of that guarantee,
    // per P6.4's instruction not to silently skip it if it were ever violated upstream.
    slide.addNotes(s.notes);
  }

  // pptxgenjs's `write()` return type spans every possible `outputType`; with
  // 'nodebuffer' selected it always resolves a real Node `Buffer` at runtime, which is
  // a guarantee this cast expresses that the library's own generic signature cannot.
  const output = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
  return Buffer.from(output);
}
