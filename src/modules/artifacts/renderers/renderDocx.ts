import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { DocumentPlan, DocumentSection } from '../documentPlan';
import type { SourcesRow, TableSpec } from '../schemas/common';
import { renderChart } from './renderChart';

/**
 * P6.5: docx package, per docs/04-MODULES.md M6 ("headings, tables, images, table of
 * contents with `features: { updateFields: true }`") and skills/campaign-report/SKILL.md's
 * structure (exec summary first, findings, what is not working, recommendations, method,
 * sources). This renderer walks the shared `DocumentPlan` shape produced by
 * `documentPlan.ts`'s `toDocumentPlan`, so it never has to know which of the five
 * prose-artifact kinds it came from.
 */

// A fixed, reasonable embed width. `renderChart` returns a PNG whose native pixel
// dimensions QuickChart controls; introspecting the PNG header for its own aspect ratio
// is possible but not worth the extra code here, so a 16:9 default is used, matching the
// aspect ratio QuickChart renders charts at by default.
const IMAGE_WIDTH_PX = 500;
const IMAGE_ASPECT_RATIO = 16 / 9;
const IMAGE_HEIGHT_PX = Math.round(IMAGE_WIDTH_PX / IMAGE_ASPECT_RATIO);

const SOURCES_HEADERS = ['Evidence ID', 'Claim', 'Source', 'Locator', 'Method'];

function heading1(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
}

/** `DocumentSection.body` carries '\n\n' as the paragraph separator (documentPlan.ts). */
function bodyParagraphs(body: string): Paragraph[] {
  return body.split('\n\n').map((text) => new Paragraph({ children: [new TextRun(text)] }));
}

function headerCell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
  });
}

function bodyCell(value: string | number): TableCell {
  return new TableCell({ children: [new Paragraph({ text: String(value) })] });
}

/** Renders any `TableSpec` (or the ad hoc sources table) as a real docx `Table`. */
function docxTable(headers: string[], rows: (string | number)[][]): Table {
  const headerRow = new TableRow({ children: headers.map(headerCell), tableHeader: true });
  const bodyRows = rows.map((row) => new TableRow({ children: row.map(bodyCell) }));
  return new Table({ rows: [headerRow, ...bodyRows], width: { size: 100, type: WidthType.PERCENTAGE } });
}

function tableSpecToDocxTable(table: TableSpec): Table {
  return docxTable(table.headers, table.rows);
}

function sourcesRowsToTableRows(sources: readonly SourcesRow[]): (string | number)[][] {
  return sources.map((s) => [s.evidenceId, s.claim, s.sourceName, s.locator, s.method ?? '']);
}

async function renderSectionChildren(section: DocumentSection): Promise<(Paragraph | Table)[]> {
  const children: (Paragraph | Table)[] = [heading1(section.heading), ...bodyParagraphs(section.body)];

  if (section.table) {
    children.push(tableSpecToDocxTable(section.table));
  }

  if (section.chart) {
    const png = await renderChart(section.chart);
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            type: 'png',
            data: png,
            transformation: { width: IMAGE_WIDTH_PX, height: IMAGE_HEIGHT_PX },
          }),
        ],
      }),
    );
  }

  return children;
}

function titleBlock(plan: DocumentPlan): Paragraph[] {
  const paragraphs = [new Paragraph({ text: plan.title, heading: HeadingLevel.TITLE })];
  const subtitleParts: string[] = [];
  if (plan.preparedFor) subtitleParts.push(`Prepared for: ${plan.preparedFor}`);
  if (plan.dateRange) subtitleParts.push(`Date range: ${plan.dateRange}`);
  for (const line of subtitleParts) {
    paragraphs.push(new Paragraph({ children: [new TextRun({ text: line, italics: true })] }));
  }
  return paragraphs;
}

function tableOfContentsBlock(): (Paragraph | TableOfContents)[] {
  // Word opens this document with a prompt to "update fields" (from `features.updateFields`
  // below); the reader must accept it once for the TOC to fill in with real page numbers.
  // Headless docx-to-anything converters that never run Word's field update pass (e.g. some
  // preview pipelines) will render this TOC empty. Both are expected, not bugs: a real page
  // number cannot exist until something lays the document out.
  return [
    heading1('Table of Contents'),
    new TableOfContents('Table of Contents', { headingStyleRange: '1-2' }),
  ];
}

function sourcesSection(sources: readonly SourcesRow[]): (Paragraph | Table)[] {
  if (sources.length === 0) return [];
  return [heading1('Sources'), docxTable(SOURCES_HEADERS, sourcesRowsToTableRows(sources))];
}

export async function renderDocx(plan: DocumentPlan): Promise<Buffer> {
  const sectionChildrenLists = await Promise.all(plan.sections.map(renderSectionChildren));

  const children: (Paragraph | Table)[] = [
    ...titleBlock(plan),
    ...tableOfContentsBlock(),
    ...sectionChildrenLists.flat(),
    ...sourcesSection(plan.sources),
  ];

  const doc = new Document({
    features: { updateFields: true },
    sections: [{ children }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
