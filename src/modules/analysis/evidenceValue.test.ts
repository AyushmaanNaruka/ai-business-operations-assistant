import { describe, expect, it } from 'vitest';
import { resolveEvidenceValue } from './evidenceValue';

const BY_CHANNEL = [
  { channel: 'Email', clicks: 1200, conversion_rate: 0.04213 },
  { channel: 'Paid Social', clicks: 900, conversion_rate: 0.0311 },
];

describe('resolveEvidenceValue', () => {
  it('takes the only cell of a 1x1 result, whatever was typed', () => {
    expect(resolveEvidenceValue([{ n: 2 }], 999)).toEqual({ ok: true, data: { value: 2, cell: { row: 0, column: 'n' } } });
  });

  it('takes the picked cell of a wider result from the result, not from the typed value', () => {
    const result = resolveEvidenceValue(BY_CHANNEL, 0.05, { row: 1, column: 'conversion_rate' });
    expect(result).toEqual({ ok: true, data: { value: 0.0311, cell: { row: 1, column: 'conversion_rate' } } });
  });

  it('refuses a pick outside the result', () => {
    expect(resolveEvidenceValue(BY_CHANNEL, 1, { row: 5, column: 'clicks' })).toMatchObject({ ok: false, error: { code: 'QUERY_INVALID' } });
    expect(resolveEvidenceValue(BY_CHANNEL, 1, { row: 0, column: 'spend' })).toMatchObject({ ok: false, error: { code: 'QUERY_INVALID' } });
  });

  it('records the matching cell when the typed value is in the result', () => {
    for (const typed of [0.04213, 0.0421, 0.042, '4.2%', 4.21, '0.042']) {
      const result = resolveEvidenceValue(BY_CHANNEL, typed);
      expect(result, String(typed)).toEqual({ ok: true, data: { value: 0.04213, cell: { row: 0, column: 'conversion_rate' } } });
    }
    expect(resolveEvidenceValue(BY_CHANNEL, '1,200')).toMatchObject({ ok: true, data: { value: 1200 } });
    expect(resolveEvidenceValue(BY_CHANNEL, 'paid social')).toMatchObject({ ok: true, data: { value: 'Paid Social' } });
  });

  it('refuses a typed value that is not among the cells', () => {
    for (const typed of [0.05, 5.1, 1500, 'Webinar', 0]) {
      const result = resolveEvidenceValue(BY_CHANNEL, typed);
      expect(result, String(typed)).toMatchObject({ ok: false, error: { code: 'QUERY_INVALID' } });
      expect(result.ok ? '' : (result.error.suggestion ?? ''), String(typed)).toContain('pick');
    }
  });

  it('reports an empty or NULL result as a gap', () => {
    expect(resolveEvidenceValue([], 1)).toMatchObject({ ok: false, error: { code: 'NO_DATA' } });
    expect(resolveEvidenceValue([{ v: null }], 1)).toMatchObject({ ok: false, error: { code: 'NO_DATA' } });
  });
});
