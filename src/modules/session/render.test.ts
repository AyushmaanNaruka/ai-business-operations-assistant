import { describe, expect, it } from 'vitest';
import type { Artifact, Finding, SessionManifest, Source } from '@/types';
import { buildSourceCard } from '@/modules/sources';
import { renderManifest } from './render';

function makeManifest(): SessionManifest {
  const sources: Source[] = [
    {
      id: 'src_1',
      name: 'campaigns.xlsx',
      kind: 'xlsx',
      origin: 'upload',
      status: 'ready',
      summary: buildSourceCard(
        { id: 'src_1', name: 'campaigns.xlsx' },
        {
          tables: [
            {
              tableName: 'campaigns',
              rowCount: 1240,
              columns: [
                { name: 'campaign', type: 'VARCHAR', nullRate: 0 },
                { name: 'spend', type: 'DOUBLE', nullRate: 0 },
              ],
              qualityWarnings: [],
            },
          ],
        },
      ),
      addedAt: '2026-09-20T00:00:00.000Z',
    },
    {
      id: 'src_2',
      name: 'company-brief.pdf',
      kind: 'pdf',
      origin: 'upload',
      status: 'pending',
      summary: buildSourceCard(
        { id: 'src_2', name: 'company-brief.pdf' },
        { doc: { mode: 'full', tokenCount: 4100, pageCount: 4, markdownPath: '/tmp/x.md' } },
      ),
      addedAt: '2026-09-21T00:00:00.000Z',
    },
  ];

  const findings: Finding[] = [
    {
      id: 'F1',
      statement: 'Email is the efficiency leader',
      evidenceIds: ['E1', 'E2'],
      reasoning: 'highest CVR among channels with a reportable sample',
      soWhat: 'shift budget toward email',
      confidence: 'high',
      createdAt: '2026-09-22T00:00:00.000Z',
    },
    {
      id: 'F2',
      statement: 'Paid social is buying volume, not revenue',
      evidenceIds: ['E4', 'E5'],
      reasoning: 'spend up 60% since June, revenue flat',
      soWhat: 'reconsider paid social spend growth',
      confidence: 'medium',
      caveats: ['small sample, two months only'],
      createdAt: '2026-09-22T01:00:00.000Z',
    },
  ];

  const artifacts: Artifact[] = [
    {
      id: 'art_1',
      version: 1,
      kind: 'pptx',
      skillUsed: 'client-presentation',
      title: 'Q3-review.pptx',
      path: '/tmp/q3.pptx',
      downloadUrl: '/download/q3.pptx',
      findingIds: ['F1', 'F2'],
      evidenceIds: ['E1', 'E2', 'E4', 'E5'],
      createdAt: '2026-09-22T02:00:00.000Z',
    },
  ];

  return { sources, findings, artifacts, openGaps: ['no data before January'] };
}

describe('renderManifest', () => {
  it('includes source cards with status, findings with evidence ids and confidence, artifacts, and open gaps', () => {
    const text = renderManifest(makeManifest());

    expect(text).toContain('SOURCES');
    expect(text).toContain('src_1  campaigns.xlsx');
    expect(text).toContain('[ready]');
    expect(text).toContain('src_2  company-brief.pdf');
    expect(text).toContain('[pending]');

    expect(text).toContain('FINDINGS');
    expect(text).toContain('F1');
    expect(text).toContain('Email is the efficiency leader');
    expect(text).toContain('[E1, E2]');
    expect(text).toContain('high');
    expect(text).toContain('small sample, two months only');

    expect(text).toContain('ARTIFACTS');
    expect(text).toContain('art_1');
    expect(text).toContain('pptx');
    expect(text).toContain('v1');

    expect(text).toContain('OPEN GAPS');
    expect(text).toContain('no data before January');
  });

  it('shows a failed source with its error message instead of a bare status', () => {
    const manifest: SessionManifest = {
      sources: [
        {
          id: 'src_1',
          name: 'locked.pdf',
          kind: 'pdf',
          origin: 'upload',
          status: 'failed',
          summary: 'src_1  locked.pdf  document',
          addedAt: new Date().toISOString(),
          error: { code: 'ENCRYPTED', message: 'Password protected' },
        },
      ],
      findings: [],
      artifacts: [],
      openGaps: [],
    };

    const text = renderManifest(manifest);
    expect(text).toContain('failed: Password protected');
  });

  it('renders empty sections as "(none)" rather than omitting the heading', () => {
    const text = renderManifest({ sources: [], findings: [], artifacts: [], openGaps: [] });
    expect(text).toContain('SOURCES\n  (none)');
    expect(text).toContain('FINDINGS\n  (none)');
    expect(text).toContain('ARTIFACTS\n  (none)');
    expect(text).toContain('OPEN GAPS\n  (none)');
  });

  it('stays well under budget for a typical session (roughly 800 tokens, ~4 chars/token)', () => {
    const text = renderManifest(makeManifest());
    // Generous character ceiling standing in for an 800 token budget.
    expect(text.length).toBeLessThan(3200);
  });
});
