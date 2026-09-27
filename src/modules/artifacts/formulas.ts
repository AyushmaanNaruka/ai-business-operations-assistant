/**
 * Cell references for the workbook's Calculations sheet, resolved by code against the
 * Data sheet the renderer actually builds (skills/excel-workbook: "Calculations contain
 * formulas, not values"). The plan author never sees the rows, so it cannot be trusted
 * to count them: a formula it writes is checked here against the real header and row
 * count, and a whole-column reference by name (`Data!revenue`) is rewritten to the exact
 * A1 range that column occupies (`Data!$E$2:$E$1204`). Anything that would open in Excel
 * as #NAME? or #REF! (an unknown column name, a bare name, a sheet this workbook does
 * not have, a range outside the Data sheet, any reference to an empty Data sheet) is
 * reported as an error instead, so `validatePlan` can hand it back to the author.
 *
 * Pure logic with no exceljs dependency, so `validate.ts` and `renderXlsx.ts` share it.
 */

/** The five sheets `renderXlsx` writes, in order. */
export const WORKBOOK_SHEETS = ['Summary', 'Recommendations', 'Data', 'Calculations', 'Sources'] as const;

/** What a formula can reference on the Data sheet: its headers (columns A, B, ...) and how many data rows follow row 1. */
export type DataSheetShape = { headers: string[]; rowCount: number };

/** Headers are the union of keys across all rows, in order of first appearance, exactly as the Data sheet lays them out. */
export function dataSheetHeaders(dataRows: Record<string, unknown>[]): string[] {
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
  return headers;
}

export function dataSheetShape(dataRows: Record<string, unknown>[]): DataSheetShape {
  return { headers: dataSheetHeaders(dataRows), rowCount: dataRows.length };
}

/** 1 -> "A", 27 -> "AA". */
export function columnLetter(index: number): string {
  let letters = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

/** "A" -> 1, "AA" -> 27. */
function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/**
 * The Data sheet in words a plan author can write formulas against. Empty when there
 * are no rows, since there is then nothing for a formula to reference.
 */
export function describeDataSheetLayout(dataRows: Record<string, unknown>[]): string {
  const { headers } = dataSheetShape(dataRows);
  if (headers.length === 0) return '';
  const lastRow = dataRows.length + 1;
  const lastLetter = columnLetter(headers.length);
  const columns = headers.map((header, i) => `${columnLetter(i + 1)} = ${header}`).join(', ');
  return (
    `The Data sheet has a header in row 1 and data in rows 2 to ${lastRow}. Columns: ${columns}. ` +
    `Calculations formulas reference it either with A1 ranges inside A1:${lastLetter}${lastRow}, e.g. =SUM(Data!${lastLetter}2:${lastLetter}${lastRow}), ` +
    `or with a whole column by its exact name, e.g. =SUM(Data!${headers[headers.length - 1]}), which the renderer converts to that column's A1 range. ` +
    'Never reference a name that is not one of these columns, and never another sheet by name.'
  );
}

type RefPart = { kind: 'cell'; col: number; row: number } | { kind: 'col'; col: number } | { kind: 'row'; row: number } | { kind: 'name' };

function parsePart(raw: string): RefPart {
  const plain = raw.replace(/\$/g, '');
  const cell = /^([A-Za-z]{1,3})(\d+)$/.exec(plain);
  if (cell) return { kind: 'cell', col: columnNumber(cell[1]!), row: Number(cell[2]) };
  if (/^[A-Za-z]{1,3}$/.test(plain)) return { kind: 'col', col: columnNumber(plain) };
  if (/^\d+$/.test(plain)) return { kind: 'row', row: Number(plain) };
  return { kind: 'name' };
}

// A sheet-qualified reference: `Data!A2:A10`, `'Data'!revenue`, `data!$B$2`. The sheet
// name is quoted or a plain identifier; the reference is one part or a `part:part` range.
const SHEET_REFERENCE = /(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!([A-Za-z0-9_.$]+(?::[A-Za-z0-9_.$]+)?)/g;
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_.]*/g;

export type ResolvedFormula = { formula: string; errors: string[] };

/**
 * Checks every reference in `formula` and rewrites whole-column-by-name references to
 * A1 ranges. `shape` undefined means the Data sheet is not known to the caller: A1
 * references are then accepted without a bounds check and names are rejected, since
 * nothing can resolve them.
 */
export function resolveFormula(formula: string, shape?: DataSheetShape): ResolvedFormula {
  const errors: string[] = [];
  // String literals ("...", with "" as an escaped quote) are data, never references.
  const segments = formula.split(/("(?:[^"]|"")*")/);
  const out = segments.map((segment, i) => (i % 2 === 1 ? segment : resolveSegment(segment, shape, errors)));
  return { formula: out.join(''), errors };
}

function resolveSegment(segment: string, shape: DataSheetShape | undefined, errors: string[]): string {
  const rewritten = segment.replace(SHEET_REFERENCE, (match: string, quoted: string | undefined, bare: string | undefined, ref: string) => {
    const sheetName = (quoted ?? bare ?? '').replace(/''/g, "'");
    const sheet = WORKBOOK_SHEETS.find((s) => s.toLowerCase() === sheetName.toLowerCase());
    if (!sheet) {
      errors.push(`"${match}" refers to a sheet "${sheetName}" this workbook does not have (sheets: ${WORKBOOK_SHEETS.join(', ')})`);
      return match;
    }
    return `${sheet}!${resolveReference(match, sheet, ref, shape, errors)}`;
  });

  // Whatever is left outside sheet-qualified references: a bare identifier that is not a
  // function call, a same-sheet A1 cell, a column range or a boolean is a defined name
  // this workbook does not have, i.e. #NAME? on open.
  const remainder = segment.replace(SHEET_REFERENCE, '0').replace(/\$/g, '');
  for (const m of remainder.matchAll(IDENTIFIER)) {
    const token = m[0];
    const start = m.index ?? 0;
    const next = remainder.slice(start + token.length).trimStart()[0];
    const prev = remainder.slice(0, start).trimEnd().slice(-1);
    if (next === '(') continue; // a function name
    if (/^[A-Za-z]{1,3}\d+$/.test(token)) continue; // an A1 cell on the same sheet
    if (/^(TRUE|FALSE)$/i.test(token)) continue;
    if (/^[A-Za-z]{1,3}$/.test(token) && (next === ':' || prev === ':')) continue; // a column range like A:A
    if (/\d/.test(prev)) continue; // the exponent of a number like 1E5
    errors.push(`"${token}" is not a cell reference; reference the Data sheet with an A1 range or Data!<column name>`);
  }
  return rewritten;
}

function resolveReference(match: string, sheet: string, ref: string, shape: DataSheetShape | undefined, errors: string[]): string {
  const [first, second] = ref.split(':') as [string, string | undefined];
  const a = parsePart(first);
  const b = second === undefined ? undefined : parsePart(second);

  // A lone part must be a cell; `Data!CPA` is a name, not a column reference.
  const isName = b === undefined ? a.kind !== 'cell' : a.kind === 'name' || b.kind === 'name' || a.kind !== b.kind;

  if (sheet !== 'Data') {
    if (isName) errors.push(`"${match}" is not a cell reference; the ${sheet} sheet defines no names`);
    return ref;
  }

  if (shape && shape.headers.length === 0) {
    errors.push(`"${match}" references the Data sheet, but it has no rows for this workbook`);
    return ref;
  }

  if (isName) {
    const header = b === undefined ? shape?.headers.find((h) => h.toLowerCase() === first.replace(/\$/g, '').toLowerCase()) : undefined;
    if (!shape || header === undefined) {
      const known = shape ? ` (Data columns: ${shape.headers.join(', ')})` : '';
      errors.push(`"${match}" is not a cell reference or a Data column name${known}; use an A1 range from the Data sheet layout, e.g. Data!K2:K1204`);
      return ref;
    }
    const letter = columnLetter(shape.headers.indexOf(header) + 1);
    return `$${letter}$2:$${letter}$${shape.rowCount + 1}`;
  }

  if (shape) {
    const lastCol = shape.headers.length;
    const lastRow = shape.rowCount + 1;
    const outside = [a, b].some(
      (part) => part !== undefined && (('col' in part && part.col > lastCol) || ('row' in part && part.row > lastRow)),
    );
    if (outside) {
      errors.push(`"${match}" is outside the Data sheet, which spans A1:${columnLetter(lastCol)}${lastRow}`);
    }
  }
  return ref;
}
