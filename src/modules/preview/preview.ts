import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { parse } from 'csv-parse/sync';
import type { ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';
import type { FilePreview, PreviewSlide, PreviewTable } from './types';

/** Rows per sheet the preview carries. A preview, not an export: the full data stays queryable through DuckDB. */
export const PREVIEW_MAX_ROWS = 100;
/** Characters of text the preview carries before it truncates. */
export const PREVIEW_MAX_CHARS = 200_000;
/** Sheets of a workbook the preview carries. */
const PREVIEW_MAX_SHEETS = 10;

/** Renders one exceljs cell value as display text: formula results, rich text, hyperlinks and dates included. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return cellText((value as { result?: ExcelJS.CellValue }).result ?? null);
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('error' in value) return String(value.error);
    return '';
  }
  return String(value);
}

export async function previewXlsx(path: string, maxRows: number = PREVIEW_MAX_ROWS): Promise<ToolResult<FilePreview>> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(path);
  } catch (err) {
    return fail('PARSE_FAILED', `Could not open ${basename(path)} as a workbook: ${(err as Error).message}`);
  }

  const sheets: PreviewTable[] = [];
  for (const sheet of workbook.worksheets.slice(0, PREVIEW_MAX_SHEETS)) {
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length > maxRows) return;
      // row.values is 1 indexed with an empty slot 0.
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map((v) => cellText(v as ExcelJS.CellValue)));
    });
    const [header = [], ...body] = rows;
    const width = Math.max(header.length, ...body.map((r) => r.length));
    const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '');
    sheets.push({
      name: sheet.name,
      columns: pad(header),
      rows: body.slice(0, maxRows).map(pad),
      totalRows: Math.max(0, sheet.actualRowCount - 1),
    });
  }
  return ok({ type: 'table', sheets });
}

export async function previewCsv(path: string, maxRows: number = PREVIEW_MAX_ROWS): Promise<ToolResult<FilePreview>> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    return fail('SOURCE_NOT_FOUND', `Could not read ${basename(path)}: ${(err as Error).message}`);
  }
  let records: string[][];
  try {
    records = parse(raw, { to_line: maxRows + 1, relax_column_count: true, skip_empty_lines: true, bom: true });
  } catch (err) {
    return fail('PARSE_FAILED', `Could not parse ${basename(path)} as CSV: ${(err as Error).message}`);
  }
  const [header = [], ...body] = records;
  const lineCount = raw.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
  return ok({
    type: 'table',
    sheets: [{ name: basename(path), columns: header, rows: body, totalRows: Math.max(0, lineCount - 1) }],
  });
}

export async function previewText(path: string, format: 'markdown' | 'plain' | 'json'): Promise<ToolResult<FilePreview>> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    return fail('SOURCE_NOT_FOUND', `Could not read ${basename(path)}: ${(err as Error).message}`);
  }
  let text = raw;
  if (format === 'json') {
    try {
      text = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      // Not valid JSON after all: show it as it is rather than failing the preview.
    }
  }
  const truncated = text.length > PREVIEW_MAX_CHARS;
  return ok({ type: 'text', format, text: truncated ? text.slice(0, PREVIEW_MAX_CHARS) : text, truncated });
}

/**
 * A strict Content-Security-Policy baked into the document itself, on top of the
 * iframe's own `sandbox` attribute: no scripts, no network, only inline styles and
 * data: images. A Word file is user supplied content (AGENTS.md rule 4).
 */
const HTML_PREVIEW_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

const HTML_PREVIEW_STYLE = `
  body { font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #0d0d0d; margin: 24px; }
  h1, h2, h3 { line-height: 1.25; margin: 1.4em 0 0.5em; }
  table { border-collapse: collapse; margin: 1em 0; }
  td, th { border: 1px solid #e5e5e5; padding: 4px 8px; vertical-align: top; }
  img { max-width: 100%; }
`;

export async function previewDocx(path: string): Promise<ToolResult<FilePreview>> {
  try {
    const { value } = await mammoth.convertToHtml({ path });
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}"><style>${HTML_PREVIEW_STYLE}</style></head><body>${value}</body></html>`;
    return ok({ type: 'html', html });
  } catch (err) {
    return fail('PARSE_FAILED', `Could not open ${basename(path)} as a Word document: ${(err as Error).message}`);
  }
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** The text paragraphs of one slide's XML, in document order. */
export function slideParagraphs(xml: string): string[] {
  const paragraphs: string[] = [];
  for (const match of xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
    const runs = [...(match[1] ?? '').matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1] ?? ''));
    const text = runs.join('').trim();
    if (text.length > 0) paragraphs.push(text);
  }
  return paragraphs;
}

/**
 * A .pptx is a zip of one XML file per slide. The preview reads each slide's text
 * in order, first paragraph as its title; charts and images are not drawn, the
 * downloaded file is the faithful version.
 */
export async function previewPptx(path: string): Promise<ToolResult<FilePreview>> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await readFile(path));
  } catch (err) {
    return fail('PARSE_FAILED', `Could not open ${basename(path)} as a presentation: ${(err as Error).message}`);
  }
  const slideFiles = Object.keys(zip.files)
    .map((name) => ({ name, number: Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(name)?.[1]) }))
    .filter((f) => Number.isFinite(f.number) && f.number > 0)
    .sort((a, b) => a.number - b.number);

  const slides: PreviewSlide[] = [];
  for (const file of slideFiles) {
    const entry = zip.file(file.name);
    if (!entry) continue;
    const [title = '', ...body] = slideParagraphs(await entry.async('string'));
    slides.push({ number: file.number, title, body });
  }
  return ok({ type: 'slides', slides });
}

/** Picks the previewer from the file's extension. `.md` covers the extracted text of PDFs and web pages. */
export async function previewFile(path: string): Promise<ToolResult<FilePreview>> {
  try {
    await stat(path);
  } catch {
    return fail('SOURCE_NOT_FOUND', `${basename(path)} is no longer on disk, so it cannot be previewed.`);
  }
  const ext = extname(path).toLowerCase();
  switch (ext) {
    case '.pdf':
      return ok({ type: 'pdf' });
    case '.xlsx':
      return previewXlsx(path);
    case '.csv':
      return previewCsv(path);
    case '.docx':
      return previewDocx(path);
    case '.pptx':
      return previewPptx(path);
    case '.md':
      return previewText(path, 'markdown');
    case '.json':
      return previewText(path, 'json');
    case '.txt':
      return previewText(path, 'plain');
    default:
      return fail('UNSUPPORTED_FORMAT', `${basename(path)} (${ext || 'no extension'}) has no preview. Download it instead.`);
  }
}
