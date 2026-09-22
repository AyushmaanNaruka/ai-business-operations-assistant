import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { PDFParse, type TableArray } from 'pdf-parse';
import mammoth from 'mammoth';
import type { ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';

/**
 * A table found inside a document (docs/03-ARCHITECTURE.md Part 9, gap A): a
 * document and tabular data are not exclusive, so a PDF or Word file can
 * register both prose (M3) and one or more tables (M1) from the same source.
 */
export type ExtractedTable = {
  headers: string[];
  rows: string[][];
  /** PDF only: the 1-based page the table was found on. */
  page?: number;
};

/**
 * A detected grid is only worth registering if it is rectangular and its
 * header row actually has header-shaped content, not detector noise (a
 * stray pair of crossing lines). Per docs/PROMPTBOOK.md P3.2: "a borderline
 * layout that is not really a table can be missed; that is acceptable and
 * better than producing a garbage table."
 */
function isRealTable(rows: TableArray): boolean {
  if (rows.length < 2) return false;
  const width = rows[0]!.length;
  if (width < 2) return false;
  if (!rows.every((row) => row.length === width)) return false;
  return rows[0]!.every((cell) => cell.trim().length > 0);
}

/** Uses pdf-parse v2's `getTable()`, which scans each page's vector drawing operators for a grid. */
export async function extractTablesFromPdf(path: string): Promise<ToolResult<ExtractedTable[]>> {
  const name = basename(path);

  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch (err) {
    return fail('PARSE_FAILED', `Could not read "${name}": ${(err as Error).message}`, { recoverable: false });
  }

  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getTable();
    const tables: ExtractedTable[] = [];
    for (const page of result.pages) {
      for (const rows of page.tables) {
        if (!isRealTable(rows)) continue;
        tables.push({ headers: rows[0]!.map(cleanCell), rows: rows.slice(1).map((row) => row.map(cleanCell)), page: page.num });
      }
    }
    return ok(tables);
  } catch (err) {
    return fail('PARSE_FAILED', `Could not scan "${name}" for tables: ${(err as Error).message}`, {
      recoverable: false,
    });
  } finally {
    await parser.destroy();
  }
}

/** Uses mammoth's HTML output (its markdown output does not carry table structure) and a small local `<table>` parser. */
export async function extractTablesFromDocx(path: string): Promise<ToolResult<ExtractedTable[]>> {
  const name = basename(path);

  let result: { value: string };
  try {
    result = await mammoth.convertToHtml({ path });
  } catch (err) {
    return fail('PARSE_FAILED', `Could not read "${name}" as a Word document: ${(err as Error).message}`, {
      recoverable: false,
    });
  }

  const tables = parseHtmlTables(result.value).filter((table) => isRealTable([table.headers, ...table.rows]));
  return ok(tables);
}

function cleanCell(cell: string): string {
  return cell.replace(/\s+/g, ' ').trim();
}

/**
 * A deliberately minimal `<table>` parser: this system only ever feeds it
 * mammoth's own HTML output, which does not nest tables or use colspan for
 * the document tables this project handles, so a full HTML parser (jsdom is
 * already approved for Phase 4, but pulling it in here would be a new,
 * unnecessary dependency edge for something this contained) is not worth it.
 */
export function parseHtmlTables(html: string): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;

  while ((tableMatch = tableRe.exec(html))) {
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    const rows: string[][] = [];
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(tableMatch[1]!))) {
      const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
      const cells: string[] = [];
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRe.exec(rowMatch[1]!))) {
        cells.push(cleanCell(cellMatch[1]!.replace(/<[^>]+>/g, ' ')));
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length >= 2) tables.push({ headers: rows[0]!, rows: rows.slice(1) });
  }

  return tables;
}
