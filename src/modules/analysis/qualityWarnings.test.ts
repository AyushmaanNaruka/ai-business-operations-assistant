import { join } from 'node:path';
import { describe as suite, expect, it } from 'vitest';
import { describe } from './describe';
import { detectQualityIssues } from './qualityWarnings';
import { closeSession, createSession, registerFile } from './session';
import type { TableProfile } from './describe';

const SAMPLES = join(import.meta.dirname, '..', '..', '..', 'samples');

function baseProfile(overrides: Partial<TableProfile> = {}): TableProfile {
  return {
    tableName: 't',
    rowCount: 100,
    columns: [],
    sample: [],
    duplicateRowCount: 0,
    dateFormatsByColumn: {},
    ...overrides,
  };
}

suite('detectQualityIssues', () => {
  it('flags a column with a null rate above 2 percent', () => {
    const profile = baseProfile({
      columns: [{ name: 'revenue', type: 'DOUBLE', nullRate: 0.03, approxUnique: 80, min: 0, max: 100, avg: 10, std: 5 }],
    });
    const warnings = detectQualityIssues(profile, []);
    expect(warnings.some((w) => w.includes('revenue') && w.includes('null'))).toBe(true);
  });

  it('does not flag a null rate at or under the 2 percent threshold', () => {
    const profile = baseProfile({
      columns: [{ name: 'revenue', type: 'DOUBLE', nullRate: 0.02, approxUnique: 80, min: 0, max: 12, avg: 10, std: 5 }],
    });
    const warnings = detectQualityIssues(profile, []);
    expect(warnings.some((w) => w.includes('revenue'))).toBe(false);
  });

  it('flags a column that is entirely null', () => {
    const profile = baseProfile({
      columns: [{ name: 'discount_code', type: 'VARCHAR', nullRate: 1, approxUnique: 0, min: null, max: null, avg: null, std: null }],
    });
    const warnings = detectQualityIssues(profile, []);
    expect(warnings.some((w) => w.includes('discount_code') && w.includes('entirely empty'))).toBe(true);
  });

  it('flags a column that is entirely one value', () => {
    const profile = baseProfile({
      columns: [{ name: 'currency', type: 'VARCHAR', nullRate: 0, approxUnique: 1, min: 'USD', max: 'USD', avg: null, std: null }],
    });
    const warnings = detectQualityIssues(profile, []);
    expect(warnings.some((w) => w.includes('currency') && w.includes('same value'))).toBe(true);
  });

  it('flags duplicate rows and counts them', () => {
    const profile = baseProfile({ duplicateRowCount: 14 });
    const warnings = detectQualityIssues(profile, []);
    expect(warnings.some((w) => w.includes('14') && w.includes('duplicate'))).toBe(true);
  });

  it('does not flag duplicates when there are none', () => {
    const profile = baseProfile({ duplicateRowCount: 0 });
    const warnings = detectQualityIssues(profile, []);
    expect(warnings.some((w) => w.includes('duplicate'))).toBe(false);
  });

  it('flags a date column with more than one format', () => {
    const profile = baseProfile({
      dateFormatsByColumn: { start_date: ['ISO (YYYY-MM-DD)', 'US (MM/DD/YYYY)', 'text month (e.g. "March 5, 2025")'] },
    });
    const warnings = detectQualityIssues(profile, []);
    expect(warnings.some((w) => w.includes('start_date') && w.includes('3'))).toBe(true);
  });

  it('does not flag a date column with a single consistent format', () => {
    const profile = baseProfile({ dateFormatsByColumn: { end_date: ['ISO (YYYY-MM-DD)'] } });
    const warnings = detectQualityIssues(profile, []);
    expect(warnings.some((w) => w.includes('end_date'))).toBe(false);
  });

  it('flags an implausible numeric outlier', () => {
    const profile = baseProfile({
      columns: [{ name: 'clicks', type: 'BIGINT', nullRate: 0, approxUnique: 50, min: 1, max: 5000, avg: 100, std: 50 }],
    });
    const warnings = detectQualityIssues(profile, []);
    expect(warnings.some((w) => w.includes('clicks') && w.includes('outlier'))).toBe(true);
  });

  it('does not flag a numeric column with no real spread', () => {
    const profile = baseProfile({
      columns: [{ name: 'clicks', type: 'BIGINT', nullRate: 0, approxUnique: 50, min: 90, max: 110, avg: 100, std: 5 }],
    });
    const warnings = detectQualityIssues(profile, []);
    expect(warnings.some((w) => w.includes('outlier'))).toBe(false);
  });

  it('finds every planted problem in the real campaigns.xlsx sample', async () => {
    const session = await createSession('qw1');
    try {
      await registerFile(session, join(SAMPLES, 'campaigns.xlsx'), 'campaigns');
      const profileResult = await describe(session, 'campaigns');
      expect(profileResult.ok).toBe(true);
      if (!profileResult.ok) return;

      const warnings = detectQualityIssues(profileResult.data, profileResult.data.sample);
      // eslint-disable-next-line no-console
      console.log('campaigns.xlsx quality warnings:\n' + warnings.map((w) => `  - ${w}`).join('\n'));

      expect(warnings.some((w) => w.toLowerCase().includes('revenue') && w.toLowerCase().includes('null'))).toBe(true);
      expect(warnings.some((w) => w.includes('start_date') && w.toLowerCase().includes('format'))).toBe(true);
      expect(warnings.some((w) => w.toLowerCase().includes('duplicate'))).toBe(true);
    } finally {
      closeSession(session);
    }
  });
});
