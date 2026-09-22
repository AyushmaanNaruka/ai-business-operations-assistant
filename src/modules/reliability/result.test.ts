import { describe, expect, it } from 'vitest';
import { fail, ok } from './result';

describe('ok', () => {
  it('wraps data in a successful ToolResult', () => {
    expect(ok({ rows: 3 })).toEqual({ ok: true, data: { rows: 3 } });
  });
});

describe('fail', () => {
  it('builds a failed ToolResult with a plain language message', () => {
    const result = fail('QUERY_INVALID', 'That statement is not a SELECT.');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error.code).toBe('QUERY_INVALID');
    expect(result.error.message).toBe('That statement is not a SELECT.');
  });

  it('defaults recoverable from the error class when not given explicitly', () => {
    const terminal = fail('ENCRYPTED', 'This PDF is password protected.');
    const correctable = fail('QUERY_INVALID', 'Bad SQL.');
    if (terminal.ok || correctable.ok) throw new Error('expected failures');
    expect(terminal.error.recoverable).toBe(false);
    expect(correctable.error.recoverable).toBe(true);
  });

  it('accepts an explicit recoverable and suggestion override', () => {
    const result = fail('FILE_TOO_LARGE', 'That file exceeds the size cap.', {
      recoverable: true,
      suggestion: 'Split it into smaller files.',
    });
    if (result.ok) throw new Error('expected a failure');
    expect(result.error.recoverable).toBe(true);
    expect(result.error.suggestion).toBe('Split it into smaller files.');
  });

  it('never throws', () => {
    expect(() => fail('NETWORK', 'offline')).not.toThrow();
  });
});
