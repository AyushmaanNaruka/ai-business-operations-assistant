import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SessionManifest, Source } from '@/types';
import { addSource, emptyManifest } from '@/modules/session';
import { openManifestStore, type ManifestStore } from './manifestStore';

function makeSource(id: string): Source {
  return {
    id,
    name: `${id}.xlsx`,
    kind: 'xlsx',
    origin: 'upload',
    status: 'ready',
    summary: `${id}  ${id}.xlsx  tabular`,
    addedAt: new Date().toISOString(),
  };
}

describe('ManifestStore (in-memory)', () => {
  let store: ManifestStore;

  afterEach(async () => {
    if (store) await store.close();
  });

  it('returns an empty manifest when nothing has been saved for a session', async () => {
    store = await openManifestStore(':memory:');
    const manifest = await store.loadManifest('session-1');
    expect(manifest).toEqual({ sources: [], findings: [], artifacts: [], openGaps: [] });
  });

  it('round-trips a saved manifest within the same store', async () => {
    store = await openManifestStore(':memory:');
    const manifest = addSource(emptyManifest(), makeSource('src_1'));

    await store.saveManifest('session-1', manifest);
    const reloaded = await store.loadManifest('session-1');

    expect(reloaded).toEqual(manifest);
  });

  it('keeps manifests for different sessions independent', async () => {
    store = await openManifestStore(':memory:');
    const manifestA = addSource(emptyManifest(), makeSource('src_1'));
    const manifestB = addSource(emptyManifest(), makeSource('src_2'));

    await store.saveManifest('session-a', manifestA);
    await store.saveManifest('session-b', manifestB);

    expect((await store.loadManifest('session-a')).sources[0]!.id).toBe('src_1');
    expect((await store.loadManifest('session-b')).sources[0]!.id).toBe('src_2');
  });

  it('a second save for the same session overwrites the first', async () => {
    store = await openManifestStore(':memory:');
    const first = addSource(emptyManifest(), makeSource('src_1'));
    const second = addSource(first, makeSource('src_2'));

    await store.saveManifest('session-1', first);
    await store.saveManifest('session-1', second);

    const reloaded = await store.loadManifest('session-1');
    expect(reloaded.sources.map((s) => s.id)).toEqual(['src_1', 'src_2']);
  });
});

describe('ManifestStore persistence', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'manifest-store-'));
  });

  afterAll(async () => {
    // Windows sometimes keeps the WAL/SHM file handles open for a moment
    // after client.close() resolves; retry the cleanup rather than fail the
    // suite over a harmless race in test teardown (mirrors ledger.test.ts).
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rm(dir, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  });

  it('survives a restart: a manifest saved before close is readable after reopening the same file', async () => {
    const dbPath = join(dir, 'manifest.db');
    const url = `file:${dbPath.replace(/\\/g, '/')}`;

    const manifest: SessionManifest = addSource(
      addSource(emptyManifest(), makeSource('src_1')),
      makeSource('src_2'),
    );

    const first = await openManifestStore(url);
    await first.saveManifest('session-1', manifest);
    await first.close();

    const second = await openManifestStore(url);
    try {
      const reloaded = await second.loadManifest('session-1');
      expect(reloaded).toEqual(manifest);
    } finally {
      await second.close();
    }
  });
});
