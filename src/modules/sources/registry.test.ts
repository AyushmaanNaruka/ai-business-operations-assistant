import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Source } from '@/types';
import { hashFile } from './contentHash';
import { createSourceRegistry } from './registry';

const SAMPLES = join(import.meta.dirname, '..', '..', '..', 'samples');

function makeSource(id: string, overrides: Partial<Source> = {}): Source {
  return {
    id,
    name: `${id}.xlsx`,
    kind: 'xlsx',
    origin: 'upload',
    status: 'pending',
    summary: '',
    addedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('createSourceRegistry', () => {
  it('adds and retrieves a source by id', () => {
    const registry = createSourceRegistry();
    const source = makeSource('src_1');

    registry.addSource(source);

    expect(registry.getSource('src_1')).toEqual(source);
  });

  it('lists every source added', () => {
    const registry = createSourceRegistry();
    registry.addSource(makeSource('src_1'));
    registry.addSource(makeSource('src_2'));

    expect(registry.listSources().map((s) => s.id).sort()).toEqual(['src_1', 'src_2']);
  });

  it('returns undefined for a source that was never added', () => {
    const registry = createSourceRegistry();
    expect(registry.getSource('src_404')).toBeUndefined();
  });

  it('updateStatus transitions status and preserves other fields', () => {
    const registry = createSourceRegistry();
    registry.addSource(makeSource('src_1', { status: 'pending' }));

    registry.updateStatus('src_1', 'ready');

    const updated = registry.getSource('src_1');
    expect(updated?.status).toBe('ready');
    expect(updated?.name).toBe('src_1.xlsx');
  });

  it('updateStatus attaches an error when the source failed', () => {
    const registry = createSourceRegistry();
    registry.addSource(makeSource('src_1'));

    registry.updateStatus('src_1', 'failed', { code: 'ENCRYPTED', message: 'Password protected' });

    expect(registry.getSource('src_1')?.error).toEqual({
      code: 'ENCRYPTED',
      message: 'Password protected',
    });
  });

  it('updateStatus on an unknown id is a no-op, not a throw', () => {
    const registry = createSourceRegistry();
    expect(() => registry.updateStatus('src_missing', 'ready')).not.toThrow();
  });

  it('nextId continues past startAfter, so a restart never reuses a saved id', () => {
    const registry = createSourceRegistry({ startAfter: 7 });
    expect(registry.nextId()).toBe('src_8');
    expect(registry.nextId()).toBe('src_9');
  });

  it('nextId produces sequential "src_N" ids', () => {
    const registry = createSourceRegistry();
    expect(registry.nextId()).toBe('src_1');
    expect(registry.nextId()).toBe('src_2');
    expect(registry.nextId()).toBe('src_3');
  });

  it('findByHash returns the same source id for an identical file re-ingested', async () => {
    const registry = createSourceRegistry();
    const path = join(SAMPLES, 'campaigns.xlsx');
    const hash = await hashFile(path);

    registry.addSource(makeSource('src_1', { name: 'campaigns.xlsx' }), hash);

    // Simulate re-ingesting the same file: hash it again, independently.
    const rehash = await hashFile(path);
    const cached = registry.findByHash(rehash);

    expect(hash).toBe(rehash);
    expect(cached?.id).toBe('src_1');
  });

  it('findByHash returns undefined for content never seen before', async () => {
    const registry = createSourceRegistry();
    const hash = await hashFile(join(SAMPLES, 'campaigns.xlsx'));
    registry.addSource(makeSource('src_1'), hash);

    const otherHash = await hashFile(join(SAMPLES, 'customer-notes.docx'));

    expect(registry.findByHash(otherHash)).toBeUndefined();
  });
});
