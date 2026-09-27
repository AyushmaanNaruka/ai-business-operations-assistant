import { sqlCodeText } from './validateSql';

// A rate by group is SUM(numerator) / SUM(denominator). AVG(conversions / clicks)
// weights a 3 click row the same as a 3,000 click row and, on samples/campaigns.xlsx,
// inflates the conversion rate by about a quarter. This lint finds that pattern in
// model written SQL so run_sql can warn and record_evidence can refuse
// (skills/campaign-analytics). It runs on code only: string literals, quoted
// identifiers and comments are blanked first, by the same scanner validateSql uses.

const AVERAGE_CALL = /\b(AVG|MEAN)\s*\(/gi;
const ALIAS = /\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi;
// The keywords an expression before "AS alias" can follow at its own nesting level.
const EXPRESSION_START =
  /\b(SELECT|DISTINCT|FROM|WHERE|JOIN|ON|BY|HAVING|AS|WITH|UNION|QUALIFY|WINDOW|LIMIT|THEN|ELSE)\b/gi;
// Dividing by a numeric constant (spend / 1000) is scaling, not a ratio of columns.
const NUMERIC_CONSTANT = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?(?![A-Za-z0-9_.(])/i;

/** Paren depth at every character; an opening or closing paren carries its outer depth. */
function depths(code: string): number[] {
  const out: number[] = new Array(code.length);
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === ')') depth = Math.max(0, depth - 1);
    out[i] = depth;
    if (code[i] === '(') depth += 1;
  }
  return out;
}

function matchingParen(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** True when the expression divides by anything other than a numeric constant. */
function dividesByNonConstant(expr: string): boolean {
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] !== '/') continue;
    const after = expr[i + 1] === '/' ? i + 2 : i + 1; // DuckDB integer division, a // b
    if (!NUMERIC_CONSTANT.test(expr.slice(after))) return true;
    i = after - 1;
  }
  return false;
}

/**
 * Names given (AS name) to an expression that divides one column by another, in
 * a CTE, subquery or select list. AVG over one of these is the same mistake one
 * step removed: WITH r AS (SELECT conversions / clicks AS rate ...) SELECT AVG(rate).
 */
function ratioAliases(code: string, depth: number[]): Set<string> {
  const aliases = new Set<string>();
  for (const match of code.matchAll(ALIAS)) {
    const at = match.index;
    const level = depth[at]!;
    let start = at - 1;
    while (start >= 0 && depth[start]! >= level && !(depth[start] === level && code[start] === ',')) start -= 1;
    const segmentStart = start + 1;
    const segment = code.slice(segmentStart, at);
    // The expression starts after the last clause keyword at its own level.
    let cut = 0;
    for (const keyword of segment.matchAll(EXPRESSION_START)) {
      if (depth[segmentStart + keyword.index] === level) cut = keyword.index + keyword[0].length;
    }
    if (dividesByNonConstant(segment.slice(cut))) aliases.add(match[1]!.toLowerCase());
  }
  return aliases;
}

/**
 * A claim that says outright it is a mean of per row (or per day, per campaign)
 * values, e.g. "average of per-campaign conversion rates". The one case where
 * averaging a ratio is the intended number, so record_evidence lets it through.
 */
export const AVERAGE_OF_PER_ROW = /\baverage of (the )?per[- ]\w+/i;

function excerpt(sql: string, from: number, to: number): string {
  const text = sql.slice(from, to).replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/**
 * Warnings for every AVG (or MEAN) that averages a per row ratio, either directly,
 * AVG(conversions / clicks), or through an alias defined as one earlier in the
 * query. Empty when the SQL has none. Never throws; unparseable SQL yields none.
 */
export function lintRatioAverages(sql: string): string[] {
  const code = sqlCodeText(sql);
  const depth = depths(code);
  const aliases = ratioAliases(code, depth);
  const warnings = new Set<string>();

  for (const match of code.matchAll(AVERAGE_CALL)) {
    const open = match.index + match[0].length - 1;
    const close = matchingParen(code, open);
    if (close < 0) continue;
    const inner = code.slice(open + 1, close);
    const call = excerpt(sql, match.index, close + 1);

    if (dividesByNonConstant(inner)) {
      warnings.add(
        `${call} averages a per-row ratio, which weights every row equally and is not the group's rate. ` +
          'Use SUM(numerator) / SUM(denominator), e.g. SUM(conversions) / SUM(clicks).',
      );
      continue;
    }

    const column = inner
      .trim()
      .replace(/^DISTINCT\s+/i, '')
      .replace(/^[A-Za-z_][A-Za-z0-9_]*\./, '');
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(column) && aliases.has(column.toLowerCase())) {
      warnings.add(
        `${call} averages "${column}", a ratio computed per row earlier in the query, which is not the group's rate. ` +
          'Use SUM(numerator) / SUM(denominator) over the underlying rows instead.',
      );
    }
  }
  return [...warnings];
}
