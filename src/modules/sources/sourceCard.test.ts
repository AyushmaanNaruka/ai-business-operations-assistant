import { describe, expect, it } from 'vitest';
import type { TableRef } from '@/types';
import { buildSourceCard } from './sourceCard';

const source = { id: 'src_1', name: 'campaigns.xlsx' };

const table: TableRef = {
  tableName: 'campaigns',
  rowCount: 1200,
  columns: [{ name: 'revenue', type: 'DOUBLE', nullRate: 0.03 }],
  qualityWarnings: ['revenue has a 3% null rate'],
};

describe('buildSourceCard', () => {
  it('a pure tabular source (no doc) shows the full column and warning list', () => {
    const card = buildSourceCard(source, { tables: [table] });
    expect(card).toContain('src_1  campaigns.xlsx  tabular');
    expect(card).toContain('1,200 rows, 1 columns');
    expect(card).toContain('columns: revenue');
    expect(card).toContain('warnings:');
    expect(card).toContain('revenue has a 3% null rate');
  });

  it('a document with no tables is labelled document, not tabular', () => {
    const card = buildSourceCard(
      { id: 'src_2', name: 'northwind-brief.pdf' },
      { doc: { mode: 'full', tokenCount: 4200, pageCount: 4, markdownPath: '/tmp/x.md' } },
    );
    expect(card).toContain('src_2  northwind-brief.pdf  document');
    expect(card).not.toContain('tabular');
    expect(card).toContain('4 pages, 4,200 tokens, full mode');
  });

  it('a document with one extracted table shows the compact combined format from the architecture doc', () => {
    const extracted: TableRef = {
      tableName: 'q2_report_t1',
      rowCount: 18,
      columns: Array.from({ length: 5 }, (_, i) => ({ name: `c${i}`, type: 'VARCHAR', nullRate: 0 })),
      qualityWarnings: [],
    };
    const card = buildSourceCard(
      { id: 'src_2', name: 'q2-report.pdf' },
      { doc: { mode: 'full', tokenCount: 6200, pageCount: 14, markdownPath: '/tmp/x.md' }, tables: [extracted] },
    );
    expect(card).toBe(
      [
        'src_2  q2-report.pdf  document + tabular',
        '       14 pages, 6,200 tokens, full mode',
        '       1 table extracted -> q2_report_t1 (18 rows, 5 columns)',
      ].join('\n'),
    );
  });

  it('a document with several extracted tables lists each one', () => {
    const t1: TableRef = { tableName: 't1', rowCount: 3, columns: [{ name: 'a', type: 'VARCHAR', nullRate: 0 }], qualityWarnings: [] };
    const t2: TableRef = { tableName: 't2', rowCount: 4, columns: [{ name: 'b', type: 'DOUBLE', nullRate: 0 }], qualityWarnings: [] };
    const card = buildSourceCard(
      { id: 'src_3', name: 'brief.pdf' },
      { doc: { mode: 'full', tokenCount: 100, markdownPath: '/tmp/x.md' }, tables: [t1, t2] },
    );
    expect(card).toContain('2 tables extracted:');
    expect(card).toContain('-> t1 (3 rows, 1 columns)');
    expect(card).toContain('-> t2 (4 rows, 1 columns)');
  });
});
