import type { ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';
import type { QueryValue } from './values';

// record_evidence re-runs the model's SQL and must record a number DuckDB returned,
// never the one the model typed (AGENTS.md rule 1). A 1x1 result is unambiguous. A
// wider result needs the model to say which cell it means, or its typed value must
// be one of the cells, in which case the cell itself is recorded.

type Row = Record<string, QueryValue>;

export type CellPick = { row: number; column: string };
export type ResolvedValue = { value: number | string; cell: CellPick };

// A typed value matches a cell within half a percent, or exactly once the cell is
// rounded to the precision the value was written with (4.2 matches 4.2381).
const RELATIVE_TOLERANCE = 0.005;

type Candidate = { value: number; decimals: number };

function decimalsOf(text: string): number {
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

function toNumber(value: QueryValue | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** The numbers a typed value may stand for: itself, and a percentage written as a ratio (4.2% is 0.042). */
function candidatesFor(typed: number | string): Candidate[] | null {
  let text: string;
  let percent = false;
  if (typeof typed === 'number') {
    text = String(typed);
  } else {
    text = typed.trim().replace(/[$€£,\s]/g, '');
    if (text.endsWith('%')) {
      percent = true;
      text = text.slice(0, -1);
    }
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text)) return null;
  }
  const value = Number(text);
  const decimals = /e/i.test(text) ? 10 : decimalsOf(text);
  const asIs = { value, decimals };
  const asRatio = { value: value / 100, decimals: decimals + 2 };
  return percent ? [asRatio, asIs] : [asIs, asRatio];
}

function numberMatches(cell: number, candidate: Candidate): boolean {
  if (cell === candidate.value) return true;
  if (cell !== 0 && Math.abs(cell - candidate.value) <= RELATIVE_TOLERANCE * Math.abs(cell)) return true;
  const rounded = Number(cell.toFixed(Math.min(candidate.decimals, 20)));
  // A value written as 0 would match every small rate; only a non-zero rounding counts.
  return rounded !== 0 && rounded === Number(candidate.value.toFixed(Math.min(candidate.decimals, 20)));
}

function scalar(value: QueryValue | undefined): number | string | null {
  return typeof value === 'number' || typeof value === 'string' ? value : null;
}

/**
 * The value record_evidence records for a query result: the only cell of a 1x1
 * result, the cell `pick` names, or the cell the typed value matches. Fails when
 * the result is empty or NULL (a gap to report) or when a wider result has no
 * cell matching the typed value. Never throws.
 */
export function resolveEvidenceValue(rows: Row[], typed: number | string, pick?: CellPick): ToolResult<ResolvedValue> {
  if (rows.length === 0) {
    return fail('NO_DATA', 'The SQL returns no rows, so there is no value to record.', {
      suggestion: 'Report this as a gap rather than recording a number.',
    });
  }

  if (pick) {
    const row = rows[pick.row];
    if (!row) {
      return fail('QUERY_INVALID', `pick.row ${pick.row} is out of range: the SQL returns ${rows.length} rows (0 based).`);
    }
    if (!(pick.column in row)) {
      return fail('QUERY_INVALID', `pick.column "${pick.column}" is not a column of the result: ${Object.keys(row).join(', ')}.`);
    }
    const value = scalar(row[pick.column]);
    if (value === null) {
      return fail('NO_DATA', `Row ${pick.row}, column "${pick.column}" is NULL, so there is no value to record.`, {
        suggestion: 'Report this as a gap rather than recording a number.',
      });
    }
    return ok({ value, cell: pick });
  }

  const columns = Object.keys(rows[0]!);
  if (rows.length === 1 && columns.length === 1) {
    const value = scalar(rows[0]![columns[0]!]);
    if (value === null) {
      return fail('NO_DATA', 'The SQL returns NULL, so there is no value to record.', {
        suggestion: 'Report this as a gap rather than recording a number.',
      });
    }
    return ok({ value, cell: { row: 0, column: columns[0]! } });
  }

  const candidates = candidatesFor(typed);
  const typedText = typeof typed === 'string' ? typed.trim().toLowerCase() : null;
  for (let r = 0; r < rows.length; r++) {
    for (const [column, raw] of Object.entries(rows[r]!)) {
      const value = scalar(raw);
      if (value === null) continue;
      const cellNumber = toNumber(value);
      const matched =
        cellNumber !== null && candidates
          ? candidates.some((c) => numberMatches(cellNumber, c))
          : typedText !== null && typeof value === 'string' && value.trim().toLowerCase() === typedText;
      if (matched) return ok({ value, cell: { row: r, column } });
    }
  }

  return fail(
    'QUERY_INVALID',
    `The value ${JSON.stringify(typed)} is not in the ${rows.length} row x ${columns.length} column result of this SQL, ` +
      'so it cannot be recorded as computed.',
    {
      suggestion:
        'Pass pick {row, column} naming the cell you mean (row is 0 based), or narrow the SQL to return one row and one column.',
    },
  );
}
