import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { extractTextItems, getDocumentProxy, type StructuredTextItem } from 'unpdf';
import mammoth from 'mammoth';
import type { SourceKind, ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';
import { formatPageMarker, formatSourceMarker } from './marker';
import { warmUpPdfJs } from './pdfWarmup';

// mammoth's bundled .d.ts predates its own markdown output support: the
// function exists at runtime (lib/index.js exports it) but is missing from
// the `Mammoth` interface, so it is typed here rather than cast with `any`.
type MammothWithMarkdown = typeof mammoth & {
  convertToMarkdown: (input: { path: string }) => Promise<{ value: string }>;
};
const mammothMd = mammoth as MammothWithMarkdown;

/**
 * A page with under this many characters of extracted text is treated as
 * having no real text layer (a scan, or an image-only page). More than half
 * of a PDF's pages like this means the whole file is a scan (docs/04-MODULES.md M1).
 */
const SCANNED_PAGE_CHAR_THRESHOLD = 100;

export type DocumentMarkdown = {
  markdown: string;
  pageCount?: number;
};

/**
 * Converts a document to markdown with inline citation markers, per
 * docs/04-MODULES.md M3. PDF and DOCX only here; xlsx/csv/json are the
 * tabular path (M1) and web sources get their own marker in Phase 4.
 */
export async function toMarkdown(path: string, kind: SourceKind): Promise<ToolResult<DocumentMarkdown>> {
  switch (kind) {
    case 'pdf':
      return toMarkdownPdf(path);
    case 'docx':
      return toMarkdownDocx(path);
    case 'txt':
      return toMarkdownText(path);
    default:
      return fail('UNSUPPORTED_FORMAT', `"${kind}" is not a document type; toMarkdown handles pdf, docx and txt only.`, {
        recoverable: false,
      });
  }
}

async function toMarkdownPdf(path: string): Promise<ToolResult<DocumentMarkdown>> {
  const name = basename(path);

  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch (err) {
    return fail('PARSE_FAILED', `Could not read "${name}": ${(err as Error).message}`, { recoverable: false });
  }

  await warmUpPdfJs(new Uint8Array(buffer));

  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    doc = await getDocumentProxy(new Uint8Array(buffer));
  } catch (err) {
    const error = err as Error & { name?: string };
    if (error.name === 'PasswordException' || /password/i.test(error.message ?? '')) {
      return fail('ENCRYPTED', `"${name}" is password protected and cannot be read.`, {
        recoverable: false,
        suggestion: 'Remove the password and re-upload the file.',
      });
    }
    return fail('PARSE_FAILED', `Could not open "${name}" as a PDF: ${error.message}`, { recoverable: false });
  }

  let extracted: { totalPages: number; items: StructuredTextItem[][] };
  try {
    extracted = await extractTextItems(doc);
  } catch (err) {
    return fail('PARSE_FAILED', `Could not extract text from "${name}": ${(err as Error).message}`, {
      recoverable: false,
    });
  }

  const pageTexts = extracted.items.map(itemsToText);
  const scannedPages = pageTexts.filter((text) => text.length < SCANNED_PAGE_CHAR_THRESHOLD).length;
  if (extracted.totalPages > 0 && scannedPages / extracted.totalPages > 0.5) {
    return fail(
      'SCANNED_PDF',
      `"${name}" has no extractable text on most pages (${scannedPages} of ${extracted.totalPages}); it looks like a scan with no text layer.`,
      { recoverable: false, suggestion: 'Run this file through OCR, or upload a text based PDF instead.' },
    );
  }

  const markdown = pageTexts.map((text, i) => `${formatPageMarker(name, i + 1)}\n\n${text}`).join('\n\n');
  return ok({ markdown, pageCount: extracted.totalPages });
}

/**
 * Text items arrive in reading order with a flag for end of line, but not
 * grouped into lines. Joins them into readable lines using `hasEOL`, and
 * collapses the PDF's own line-wrap breaks into paragraphs.
 */
function itemsToText(items: StructuredTextItem[]): string {
  let text = '';
  for (const item of items) {
    text += item.str;
    text += item.hasEOL ? '\n' : item.str.endsWith(' ') ? '' : ' ';
  }
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function toMarkdownDocx(path: string): Promise<ToolResult<DocumentMarkdown>> {
  const name = basename(path);

  let result: { value: string };
  try {
    result = await mammothMd.convertToMarkdown({ path });
  } catch (err) {
    return fail('PARSE_FAILED', `Could not read "${name}" as a Word document: ${(err as Error).message}`, {
      recoverable: false,
    });
  }

  const body = result.value.trim();
  if (!body) {
    return fail('PARSE_FAILED', `"${name}" produced no readable text.`, { recoverable: false });
  }

  return ok({ markdown: `${formatSourceMarker(name)}\n\n${body}` });
}

async function toMarkdownText(path: string): Promise<ToolResult<DocumentMarkdown>> {
  const name = basename(path);

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    return fail('PARSE_FAILED', `Could not read "${name}": ${(err as Error).message}`, { recoverable: false });
  }

  return ok({ markdown: `${formatSourceMarker(name)}\n\n${raw.trim()}` });
}
