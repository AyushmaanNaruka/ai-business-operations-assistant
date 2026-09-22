import type { Source, SourceStatus } from '@/types';

/**
 * In-memory map of every Source in a session, keyed by id, with a parallel
 * index from content hash to source id so an identical re-upload is free
 * (docs/04-MODULES.md M1).
 */
export type SourceRegistry = {
  addSource(source: Source, contentHash?: string): Source;
  getSource(id: string): Source | undefined;
  listSources(): Source[];
  updateStatus(id: string, status: SourceStatus, error?: { code: string; message: string }): void;
  findByHash(hash: string): Source | undefined;
  /** Generates the next "src_N" id. Call once per genuinely new source. */
  nextId(): string;
};

export function createSourceRegistry(): SourceRegistry {
  const sources = new Map<string, Source>();
  const byHash = new Map<string, string>();
  let counter = 0;

  return {
    addSource(source, contentHash) {
      sources.set(source.id, source);
      if (contentHash) byHash.set(contentHash, source.id);
      return source;
    },

    getSource(id) {
      return sources.get(id);
    },

    listSources() {
      return [...sources.values()];
    },

    updateStatus(id, status, error) {
      const existing = sources.get(id);
      if (!existing) return;
      sources.set(id, { ...existing, status, ...(error ? { error } : {}) });
    },

    findByHash(hash) {
      const id = byHash.get(hash);
      return id ? sources.get(id) : undefined;
    },

    nextId() {
      counter += 1;
      return `src_${counter}`;
    },
  };
}
