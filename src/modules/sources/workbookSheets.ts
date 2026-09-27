import ExcelJS from 'exceljs';
import type { ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';

/** One sheet of a workbook, as ingestion needs to know it before DuckDB reads it. */
export type SheetLayout = {
  /** The sheet's name exactly as Excel shows it on its tab. */
  name: string;
  /** Position in the workbook's tab order, from 0. */
  index: number;
  /** True when the sheet holds no cell values at all; such a sheet is not registered. */
  empty: boolean;
  /**
   * Set only when the header is not the first row with content: a title or note
   * row (one filled cell) sits above it. The A1 range from the header row to the
   * sheet's last used cell, for read_xlsx's `range` option. Unset means DuckDB's
   * default reading already finds the header.
   */
  headerRange?: string;
};

/** How many rows from the top are scanned for a header before giving up and keeping DuckDB's default. */
const HEADER_SCAN_ROWS = 20;

/**
 * Lists a workbook's sheets in tab order and locates each one's header row, so
 * ingestion can register every non-empty sheet as its own DuckDB table. Reads the
 * file with exceljs, which the xlsx renderer already depends on. Only cell
 * presence is read here; every value that reaches an answer is still read by
 * DuckDB (rule 1). Never throws: an unreadable workbook is a failure the caller
 * treats as "use DuckDB's default reading".
 */
export async function inspectWorkbook(path: string): Promise<ToolResult<SheetLayout[]>> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(path);
  } catch (err) {
    return fail('PARSE_FAILED', `Could not list the sheets of "${path}": ${(err as Error).message}`, { recoverable: false });
  }

  const layouts: SheetLayout[] = [];
  workbook.worksheets.forEach((sheet, index) => {
    const empty = sheet.actualRowCount === 0;
    const filledByRow: number[] = [];
    for (let r = 1; !empty && r <= Math.min(sheet.rowCount, HEADER_SCAN_ROWS); r++) {
      let filled = 0;
      sheet.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
        if (hasValue(cell.value)) filled++;
      });
      filledByRow.push(filled);
    }
    const headerRange = empty ? undefined : findHeaderRange(filledByRow, (fromRow) => usedExtent(sheet, fromRow));
    layouts.push({ name: sheet.name, index, empty, ...(headerRange ? { headerRange } : {}) });
  });

  return ok(layouts);
}

/**
 * The header is the first row with two or more filled cells. A range is only
 * returned when some row above it has content (a title, a "prepared by" note):
 * blank leading rows alone are something DuckDB already skips, so a sheet laid
 * out normally keeps DuckDB's default reading unchanged.
 */
export function findHeaderRange(filledByRow: readonly number[], extent: (fromRow: number) => CellExtent | undefined): string | undefined {
  const headerOffset = filledByRow.findIndex((n) => n >= 2);
  if (headerOffset <= 0) return undefined;
  const hasContentAbove = filledByRow.slice(0, headerOffset).some((n) => n > 0);
  if (!hasContentAbove) return undefined;
  const headerRow = headerOffset + 1;
  const used = extent(headerRow);
  if (!used || used.bottom <= headerRow) return undefined;
  return `${columnLetters(used.left)}${headerRow}:${columnLetters(used.right)}${used.bottom}`;
}

export type CellExtent = { left: number; right: number; bottom: number };

/**
 * The block of cells from `fromRow` down that actually hold values, so a title
 * cell in column A does not widen a table that starts in column B. Not the sheet's stored dimension,
 * which also counts cells that only carry formatting: a range running into those
 * would hand DuckDB trailing rows of nulls.
 */
function usedExtent(sheet: ExcelJS.Worksheet, fromRow: number): CellExtent | undefined {
  let left = Infinity;
  let right = 0;
  let bottom = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < fromRow) return;
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      if (!hasValue(cell.value)) return;
      left = Math.min(left, column);
      right = Math.max(right, column);
      bottom = Math.max(bottom, rowNumber);
    });
  });
  return bottom === 0 ? undefined : { left, right, bottom };
}

/** 1 -> "A", 27 -> "AA". */
export function columnLetters(column: number): string {
  let n = column;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * A sheet name reduced to a table-name-safe slug: "Q2 Budget" -> "q2_budget".
 * Falls back to `sheet<N>` for a name with no letters or digits at all.
 */
export function sheetSlug(name: string, index: number): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || `sheet${index + 1}`;
}

function hasValue(value: ExcelJS.CellValue): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}
