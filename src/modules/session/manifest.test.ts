import { describe, expect, it } from 'vitest';
import type { Artifact, Finding, Source } from '@/types';
import { addArtifact, addFinding, addOpenGap, addSource, emptyManifest, removeOpenGap } from './manifest';

function makeSource(id: string, overrides: Partial<Source> = {}): Source {
  return {
    id,
    name: `${id}.xlsx`,
    kind: 'xlsx',
    origin: 'upload',
    status: 'ready',
    summary: `${id}  ${id}.xlsx  tabular`,
    addedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFinding(id: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    statement: 'a finding',
    evidenceIds: ['E1'],
    reasoning: 'because',
    soWhat: 'so what',
    confidence: 'high',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeArtifact(id: string, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id,
    version: 1,
    kind: 'pptx',
    skillUsed: 'client-presentation',
    title: 'Q3-review.pptx',
    path: '/tmp/x.pptx',
    downloadUrl: '/download/x.pptx',
    findingIds: [],
    evidenceIds: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('emptyManifest', () => {
  it('starts with every list empty', () => {
    expect(emptyManifest()).toEqual({ sources: [], findings: [], artifacts: [], openGaps: [] });
  });
});

describe('addSource', () => {
  it('appends a new source', () => {
    const manifest = addSource(emptyManifest(), makeSource('src_1'));
    expect(manifest.sources.map((s) => s.id)).toEqual(['src_1']);
  });

  it('does not mutate the input manifest', () => {
    const before = emptyManifest();
    addSource(before, makeSource('src_1'));
    expect(before.sources).toEqual([]);
  });

  it('upserts by id: re-adding a source replaces it and moves it to the end', () => {
    let manifest = addSource(emptyManifest(), makeSource('src_1'));
    manifest = addSource(manifest, makeSource('src_2'));
    manifest = addSource(manifest, makeSource('src_1', { status: 'ready', summary: 'updated' }));

    expect(manifest.sources.map((s) => s.id)).toEqual(['src_2', 'src_1']);
    expect(manifest.sources.find((s) => s.id === 'src_1')?.summary).toBe('updated');
  });
});

describe('addFinding', () => {
  it('appends a new finding and upserts by id', () => {
    let manifest = addFinding(emptyManifest(), makeFinding('F1'));
    manifest = addFinding(manifest, makeFinding('F2'));
    expect(manifest.findings.map((f) => f.id)).toEqual(['F1', 'F2']);

    manifest = addFinding(manifest, makeFinding('F1', { confidence: 'low' }));
    expect(manifest.findings.map((f) => f.id)).toEqual(['F2', 'F1']);
    expect(manifest.findings.find((f) => f.id === 'F1')?.confidence).toBe('low');
  });
});

describe('addArtifact', () => {
  it('appends a new artifact and upserts by id on a revision', () => {
    let manifest = addArtifact(emptyManifest(), makeArtifact('art_1', { version: 1 }));
    manifest = addArtifact(manifest, makeArtifact('art_1', { version: 2 }));

    expect(manifest.artifacts).toHaveLength(1);
    expect(manifest.artifacts[0]!.version).toBe(2);
  });
});

describe('addOpenGap / removeOpenGap', () => {
  it('adds a gap', () => {
    const manifest = addOpenGap(emptyManifest(), 'no revenue data before Q1');
    expect(manifest.openGaps).toEqual(['no revenue data before Q1']);
  });

  it('adding the same gap twice does not duplicate it', () => {
    let manifest = addOpenGap(emptyManifest(), 'gap');
    manifest = addOpenGap(manifest, 'gap');
    expect(manifest.openGaps).toEqual(['gap']);
  });

  it('removes a gap by exact text', () => {
    let manifest = addOpenGap(emptyManifest(), 'gap');
    manifest = removeOpenGap(manifest, 'gap');
    expect(manifest.openGaps).toEqual([]);
  });

  it('removing a gap that is not present is a no-op', () => {
    const before = addOpenGap(emptyManifest(), 'gap');
    const after = removeOpenGap(before, 'nope');
    expect(after.openGaps).toEqual(['gap']);
  });
});
