import type { ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';

// Statement level DDL/DML this system never allows the model to run, even as
// a single statement. Matched against the code-only text (see below), so a
// campaign named "Delete Old Campaigns" in a string literal never trips it.
const BANNED_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|ATTACH|DETACH|COPY|INSTALL|LOAD|PRAGMA|SET|EXPORT|IMPORT|VACUUM|CALL)\b/i;

// DuckDB functions that read an arbitrary filesystem path. `enable_external_access`
// blocks these at the engine level too, but rejecting them here fails fast with a
// clear message instead of a cryptic engine error.
const FILE_READ_FUNCTIONS = /\b(read_csv(_auto)?|read_parquet|read_json(_auto)?|read_xlsx)\s*\(/i;

const LEADING_KEYWORD = /^(SELECT|WITH)\b/i;

type ScanState = 'normal' | 'single' | 'double' | 'line_comment' | 'block_comment';

/**
 * Single pass over the SQL text that tracks single-quoted strings,
 * double-quoted identifiers, and (nested, matching DuckDB's own parser)
 * block comments, plus line comments. Produces:
 *   - `codeText`: same length as `sql`, with string/identifier contents and
 *     comments blanked to spaces, safe to run keyword regexes against
 *   - `statementCount`: statements separated by a semicolon that is NOT
 *     inside a string, identifier or comment
 *   - `unterminated`: true if the input ends mid string/identifier/comment
 *
 * A semicolon inside a comment or string literal is correctly ignored, and a
 * real statement boundary hidden after a comment is correctly counted, which
 * is the exact distinction a naive `sql.split(';')` gets wrong.
 */
function scan(sql: string): { codeText: string; statementCount: number; unterminated: boolean } {
  let state: ScanState = 'normal';
  let blockDepth = 0;
  let hasContentSinceLastSemicolon = false;
  let statementCount = 0;
  const code: string[] = [];

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];

    if (state === 'line_comment') {
      code.push(c === '\n' ? '\n' : ' ');
      if (c === '\n') state = 'normal';
      continue;
    }

    if (state === 'block_comment') {
      code.push(' ');
      if (c === '/' && next === '*') {
        blockDepth += 1;
        code.push(' ');
        i += 1;
      } else if (c === '*' && next === '/') {
        blockDepth -= 1;
        code.push(' ');
        i += 1;
        if (blockDepth === 0) state = 'normal';
      }
      continue;
    }

    if (state === 'single') {
      code.push(' ');
      if (c === "'") {
        if (next === "'") {
          code.push(' ');
          i += 1;
        } else {
          state = 'normal';
        }
      }
      continue;
    }

    if (state === 'double') {
      code.push(' ');
      if (c === '"') {
        if (next === '"') {
          code.push(' ');
          i += 1;
        } else {
          state = 'normal';
        }
      }
      continue;
    }

    // state === 'normal'
    if (c === '-' && next === '-') {
      state = 'line_comment';
      code.push(' ', ' ');
      i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      state = 'block_comment';
      blockDepth = 1;
      code.push(' ', ' ');
      i += 1;
      continue;
    }
    if (c === "'") {
      state = 'single';
      hasContentSinceLastSemicolon = true;
      code.push(' ');
      continue;
    }
    if (c === '"') {
      state = 'double';
      hasContentSinceLastSemicolon = true;
      code.push(' ');
      continue;
    }
    if (c === ';') {
      if (hasContentSinceLastSemicolon) statementCount += 1;
      hasContentSinceLastSemicolon = false;
      code.push(' ');
      continue;
    }

    code.push(c);
    if (!/\s/.test(c)) hasContentSinceLastSemicolon = true;
  }

  if (hasContentSinceLastSemicolon) statementCount += 1;

  return {
    codeText: code.join(''),
    statementCount,
    // A line comment simply runs to end of input, which is fine; only an
    // unterminated string, identifier or block comment is malformed SQL.
    unterminated: state === 'single' || state === 'double' || state === 'block_comment',
  };
}

/**
 * Validates a single read only SQL statement before it ever reaches DuckDB.
 * Rejects anything but exactly one SELECT or WITH statement, all DDL/DML,
 * and direct filesystem read functions. Never throws. (docs/04-MODULES.md M2)
 */
export function validateSql(sql: string): ToolResult<{ sql: string }> {
  const trimmed = sql.trim();
  if (!trimmed) {
    return fail('QUERY_INVALID', 'The query is empty.', { suggestion: 'Write a SELECT or WITH query.' });
  }

  const { codeText, statementCount, unterminated } = scan(trimmed);

  if (unterminated) {
    return fail('QUERY_INVALID', 'The query has an unterminated string, identifier or comment.', {
      suggestion: 'Check for a missing closing quote or */.',
    });
  }

  if (statementCount !== 1) {
    return fail(
      'QUERY_INVALID',
      `Expected exactly one statement, found ${statementCount}.`,
      { suggestion: 'Run one SELECT or WITH statement at a time.' },
    );
  }

  const leading = codeText.trim();
  if (!LEADING_KEYWORD.test(leading)) {
    return fail('QUERY_INVALID', 'Only SELECT and WITH statements are allowed.', {
      suggestion: 'Start the query with SELECT or WITH.',
    });
  }

  const bannedMatch = codeText.match(BANNED_KEYWORDS);
  if (bannedMatch) {
    return fail('QUERY_INVALID', `"${bannedMatch[0]}" is not allowed in a query.`, {
      suggestion: 'This system only runs read only SELECT/WITH statements.',
    });
  }

  const fileReadMatch = codeText.match(FILE_READ_FUNCTIONS);
  if (fileReadMatch) {
    const fnName = fileReadMatch[0].replace(/\($/, '').trim();
    return fail('QUERY_INVALID', `"${fnName}" cannot read a filesystem path here.`, {
      suggestion: 'Query the tables already registered for this session instead.',
    });
  }

  return ok({ sql: trimmed });
}
