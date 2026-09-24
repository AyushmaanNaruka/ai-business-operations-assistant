import { describe, expect, it } from 'vitest';
import type { Artifact, Finding, SessionManifest, Source } from '@/types';
import { resolveReference } from './reference';

function source(id: string, name: string, kind: Source['kind'], addedAt: string): Source {
  return {
    id,
    name,
    kind,
    origin: kind === 'web' ? 'url' : 'upload',
    status: 'ready',
    summary: `${id}  ${name}`,
    addedAt,
  };
}

function finding(id: string, statement: string, createdAt: string): Finding {
  return {
    id,
    statement,
    evidenceIds: ['E1'],
    reasoning: 'r',
    soWhat: 's',
    confidence: 'high',
    createdAt,
  };
}

function artifact(id: string, title: string, kind: Artifact['kind']): Artifact {
  return {
    id,
    version: 1,
    kind,
    skillUsed: 'skill',
    title,
    path: '/tmp/x',
    downloadUrl: '/download/x',
    findingIds: [],
    evidenceIds: [],
    createdAt: new Date().toISOString(),
  };
}

function manifestWith(partial: Partial<SessionManifest>): SessionManifest {
  return { sources: [], findings: [], artifacts: [], openGaps: [], ...partial };
}

describe('resolveReference: exact match', () => {
  it('resolves "the spreadsheet" to the one xlsx source loaded', () => {
    const manifest = manifestWith({
      sources: [source('src_1', 'campaigns.xlsx', 'xlsx', '2026-09-20T00:00:00Z')],
    });
    expect(resolveReference('the spreadsheet', manifest)).toEqual({ kind: 'match', sourceId: 'src_1' });
  });

  it('resolves a filename fragment to the matching source', () => {
    const manifest = manifestWith({
      sources: [
        source('src_1', 'campaigns.xlsx', 'xlsx', '2026-09-20T00:00:00Z'),
        source('src_2', 'company-brief.pdf', 'pdf', '2026-09-21T00:00:00Z'),
      ],
    });
    expect(resolveReference('campaigns', manifest)).toEqual({ kind: 'match', sourceId: 'src_1' });
  });

  it('resolves "the brief" by name substring even without the keyword table', () => {
    const manifest = manifestWith({
      sources: [source('src_2', 'company-brief.pdf', 'pdf', '2026-09-21T00:00:00Z')],
    });
    expect(resolveReference('the brief', manifest)).toEqual({ kind: 'match', sourceId: 'src_2' });
  });

  it('resolves "the brief" to the pdf by filename even when a docx also loaded would match the generic keyword (P5.7 regression: all four sample sources present)', () => {
    const manifest = manifestWith({
      sources: [
        source('src_1', 'campaigns.xlsx', 'xlsx', '2026-09-20T00:00:00Z'),
        source('src_2', 'northwind-brief.pdf', 'pdf', '2026-09-21T00:00:00Z'),
        source('src_3', 'customer-notes.docx', 'docx', '2026-09-21T01:00:00Z'),
      ],
    });
    expect(resolveReference('the brief', manifest)).toEqual({ kind: 'match', sourceId: 'src_2' });
  });

  it('resolves "the target company" to the one web source via the company/website keyword heuristic', () => {
    const manifest = manifestWith({
      sources: [
        source('src_1', 'campaigns.xlsx', 'xlsx', '2026-09-20T00:00:00Z'),
        source('src_3', 'acme-corp.com', 'web', '2026-09-22T00:00:00Z'),
      ],
    });
    expect(resolveReference('the target company', manifest)).toEqual({ kind: 'match', sourceId: 'src_3' });
  });

  it('resolves a bare demonstrative ("this") to the most recently touched source', () => {
    const manifest = manifestWith({
      sources: [
        source('src_1', 'campaigns.xlsx', 'xlsx', '2026-09-20T00:00:00Z'),
        source('src_2', 'company-brief.pdf', 'pdf', '2026-09-21T00:00:00Z'),
      ],
    });
    expect(resolveReference('this', manifest)).toEqual({ kind: 'match', sourceId: 'src_2' });
  });

  it('resolves "the other one" to the source that is not the most recent, with exactly two sources', () => {
    const manifest = manifestWith({
      sources: [
        source('src_1', 'campaigns.xlsx', 'xlsx', '2026-09-20T00:00:00Z'),
        source('src_2', 'company-brief.pdf', 'pdf', '2026-09-21T00:00:00Z'),
      ],
    });
    expect(resolveReference('the other one', manifest)).toEqual({ kind: 'match', sourceId: 'src_1' });
  });

  it('resolves "this finding" to the most recent finding', () => {
    const manifest = manifestWith({
      findings: [
        finding('F1', 'Email is the efficiency leader', '2026-09-22T00:00:00Z'),
        finding('F2', 'Paid social buys volume', '2026-09-22T01:00:00Z'),
      ],
    });
    expect(resolveReference('this finding', manifest)).toEqual({ kind: 'match', findingId: 'F2' });
  });

  it('resolves "the deck" to the one pptx artifact', () => {
    const manifest = manifestWith({
      artifacts: [artifact('art_1', 'Q3-review.pptx', 'pptx')],
    });
    expect(resolveReference('the deck', manifest)).toEqual({ kind: 'match', artifactId: 'art_1' });
  });
});

describe('resolveReference: ambiguous, never guessed', () => {
  it('returns ambiguous with both candidates when two sources match "the spreadsheet"', () => {
    const manifest = manifestWith({
      sources: [
        source('src_1', 'campaigns.xlsx', 'xlsx', '2026-09-20T00:00:00Z'),
        source('src_2', 'budget.csv', 'csv', '2026-09-21T00:00:00Z'),
      ],
    });
    const result = resolveReference('the spreadsheet', manifest);
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.candidates.sort()).toEqual(['src_1', 'src_2']);
    }
  });

  it('"the other one" with more than two sources is ambiguous among everything but the most recent', () => {
    const manifest = manifestWith({
      sources: [
        source('src_1', 'a.xlsx', 'xlsx', '2026-09-20T00:00:00Z'),
        source('src_2', 'b.xlsx', 'xlsx', '2026-09-21T00:00:00Z'),
        source('src_3', 'c.xlsx', 'xlsx', '2026-09-22T00:00:00Z'),
      ],
    });
    const result = resolveReference('the other one', manifest);
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.candidates.sort()).toEqual(['src_1', 'src_2']);
    }
  });
});

describe('resolveReference: no match, never guessed', () => {
  it('returns none when nothing in the manifest plausibly matches', () => {
    const manifest = manifestWith({
      sources: [source('src_1', 'campaigns.xlsx', 'xlsx', '2026-09-20T00:00:00Z')],
    });
    expect(resolveReference('the unicorn report', manifest)).toEqual({ kind: 'none' });
  });

  it('returns none for a demonstrative when no sources are loaded', () => {
    expect(resolveReference('this', manifestWith({}))).toEqual({ kind: 'none' });
  });

  it('returns none for "the other one" when only one source is loaded', () => {
    const manifest = manifestWith({
      sources: [source('src_1', 'campaigns.xlsx', 'xlsx', '2026-09-20T00:00:00Z')],
    });
    expect(resolveReference('the other one', manifest)).toEqual({ kind: 'none' });
  });

  it('returns none for a finding reference when no findings exist', () => {
    expect(resolveReference('that finding', manifestWith({}))).toEqual({ kind: 'none' });
  });
});
