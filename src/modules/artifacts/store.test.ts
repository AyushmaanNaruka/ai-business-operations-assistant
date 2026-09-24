import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openArtifactStore, type ArtifactStore } from './store';

function baseInput() {
  return {
    kind: 'pptx' as const,
    skillUsed: 'client-presentation',
    title: 'Q3 Campaign Review',
    path: '/tmp/generated/q3-review.pptx',
    downloadUrl: '/generated/q3-review.pptx',
    findingIds: ['F1', 'F2'],
    evidenceIds: ['E1', 'E2', 'E3'],
  };
}

describe('ArtifactStore (in-memory)', () => {
  let store: ArtifactStore;

  afterEach(async () => {
    if (store) await store.close();
  });

  it('a fresh save mints version 1 with a new id', async () => {
    store = await openArtifactStore(':memory:');
    const artifact = await store.saveVersion(baseInput());

    expect(artifact.version).toBe(1);
    expect(artifact.id).toMatch(/^art_\d+$/);
    expect(artifact.title).toBe('Q3 Campaign Review');
    expect(artifact.createdAt).toEqual(expect.any(String));
  });

  it('mints sequential ids (art_1, art_2, ...) for successive fresh saves', async () => {
    store = await openArtifactStore(':memory:');
    const a = await store.saveVersion(baseInput());
    const b = await store.saveVersion(baseInput());

    expect(a.id).toBe('art_1');
    expect(b.id).toBe('art_2');
  });

  it('a revisionOf save produces version 2 under the same id, and version 1 still exists', async () => {
    store = await openArtifactStore(':memory:');
    const v1 = await store.saveVersion(baseInput());
    const v2 = await store.saveVersion({ ...baseInput(), title: 'Q3 Campaign Review (revised)', revisionOf: v1.id });

    expect(v2.id).toBe(v1.id);
    expect(v2.version).toBe(2);

    const versions = await store.getVersions(v1.id);
    expect(versions).toHaveLength(2);
    expect(versions.map((a) => a.version)).toEqual([1, 2]);
    expect(versions[0]!.title).toBe('Q3 Campaign Review');
    expect(versions[1]!.title).toBe('Q3 Campaign Review (revised)');
  });

  it('three successive revisions of the same id produce versions 1 through 3, all still readable', async () => {
    store = await openArtifactStore(':memory:');
    const v1 = await store.saveVersion(baseInput());
    const v2 = await store.saveVersion({ ...baseInput(), revisionOf: v1.id });
    const v3 = await store.saveVersion({ ...baseInput(), revisionOf: v1.id });

    expect([v1.version, v2.version, v3.version]).toEqual([1, 2, 3]);
    const versions = await store.getVersions(v1.id);
    expect(versions).toHaveLength(3);
  });

  it('a revisionOf naming an id with no existing rows mints a fresh id at version 1 instead', async () => {
    store = await openArtifactStore(':memory:');
    const artifact = await store.saveVersion({ ...baseInput(), revisionOf: 'art_does_not_exist' });

    expect(artifact.version).toBe(1);
    expect(artifact.id).not.toBe('art_does_not_exist');
    expect(artifact.id).toMatch(/^art_\d+$/);
  });

  it('getLatest returns the highest version', async () => {
    store = await openArtifactStore(':memory:');
    const v1 = await store.saveVersion(baseInput());
    await store.saveVersion({ ...baseInput(), revisionOf: v1.id });
    const v3 = await store.saveVersion({ ...baseInput(), revisionOf: v1.id });

    const latest = await store.getLatest(v1.id);
    expect(latest?.version).toBe(3);
    expect(latest?.id).toBe(v3.id);
  });

  it('getLatest on an id with no rows returns undefined', async () => {
    store = await openArtifactStore(':memory:');
    const latest = await store.getLatest('art_never_saved');
    expect(latest).toBeUndefined();
  });

  it('getVersions on an id with no rows returns an empty array', async () => {
    store = await openArtifactStore(':memory:');
    const versions = await store.getVersions('art_never_saved');
    expect(versions).toEqual([]);
  });
});

describe('ArtifactStore persistence', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'artifact-store-'));
  });

  afterAll(async () => {
    // Windows sometimes keeps the WAL/SHM file handles open for a moment after
    // client.close() resolves; retry the cleanup rather than fail the suite over a
    // harmless race in test teardown (mirrors src/modules/evidence/ledger.test.ts).
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rm(dir, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  });

  it('survives being closed and reopened against the same file', async () => {
    const dbPath = join(dir, 'artifacts.db');
    const url = `file:${dbPath.replace(/\\/g, '/')}`;

    const first = await openArtifactStore(url);
    const v1 = await first.saveVersion(baseInput());
    await first.close();

    const second = await openArtifactStore(url);
    try {
      const reloaded = await second.getLatest(v1.id);
      expect(reloaded).toBeDefined();
      expect(reloaded?.title).toBe('Q3 Campaign Review');

      // A revision after reopening lands at version 2, proving the version history
      // (not just the row) survived the restart.
      const v2 = await second.saveVersion({ ...baseInput(), revisionOf: v1.id });
      expect(v2.version).toBe(2);

      // The id counter itself must also survive, so a fresh save never collides.
      const fresh = await second.saveVersion(baseInput());
      expect(fresh.id).not.toBe(v1.id);
    } finally {
      await second.close();
    }
  });
});
