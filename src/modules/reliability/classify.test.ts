import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '@/types';
import { classify } from './classify';

// Kept in sync by hand with the ErrorCode union in src/types/toolResult.ts.
// This list is the test: if a new ErrorCode is added there without an entry
// here, TypeScript will not catch it, but this test will fail on `undefined`.
const ALL_ERROR_CODES: ErrorCode[] = [
  'SOURCE_NOT_FOUND',
  'SOURCE_PENDING',
  'QUERY_INVALID',
  'QUERY_TIMEOUT',
  'NO_DATA',
  'PARSE_FAILED',
  'SCANNED_PDF',
  'FILE_TOO_LARGE',
  'ENCRYPTED',
  'UNSUPPORTED_FORMAT',
  'SEARCH_QUOTA',
  'PAGE_BLOCKED',
  'NETWORK',
  'RATE_LIMIT',
  'RENDER_FAILED',
  'PLAN_INVALID',
  'UNSUPPORTED',
];

describe('classify', () => {
  it('maps every ErrorCode to exactly one retry class', () => {
    for (const code of ALL_ERROR_CODES) {
      const result = classify(code);
      expect(['transient', 'correctable', 'terminal']).toContain(result);
    }
  });

  it('matches the table from the data model for the documented examples', () => {
    expect(classify('NETWORK')).toBe('transient');
    expect(classify('RATE_LIMIT')).toBe('transient');
    expect(classify('QUERY_INVALID')).toBe('correctable');
    expect(classify('PLAN_INVALID')).toBe('correctable');
    expect(classify('ENCRYPTED')).toBe('terminal');
    expect(classify('UNSUPPORTED_FORMAT')).toBe('terminal');
  });

  it('is a pure function: same code always yields the same class', () => {
    for (const code of ALL_ERROR_CODES) {
      expect(classify(code)).toBe(classify(code));
    }
  });
});
