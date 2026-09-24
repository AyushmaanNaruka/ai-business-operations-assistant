import { createClient } from '@libsql/client';
import type { SessionManifest } from '@/types';
import { emptyManifest } from '@/modules/session';

export type ManifestStore = {
  loadManifest(sessionId: string): Promise<SessionManifest>;
  saveManifest(sessionId: string, manifest: SessionManifest): Promise<void>;
  close(): Promise<void>;
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS session_manifest (
    session_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

/**
 * Persists a SessionManifest to Mastra working memory so it survives a
 * process restart (docs/04-MODULES.md M8). This is the Mastra-side adapter;
 * `src/modules/session/` stays pure logic per AGENTS.md ("Modules do not
 * import agents"), so the storage concern lives here instead, next to the
 * agents and tools that read and write it.
 *
 * Follows the exact pattern `openLedger` (src/modules/evidence/ledger.ts)
 * uses for the evidence ledger: a plain `@libsql/client` connection against
 * the same DATABASE_URL Mastra's own storage uses (see docs/DECISIONS.md
 * D-14), rather than `@mastra/libsql`, so opening a store needs no Mastra
 * instance. Mastra's `Memory` class does expose a working-memory API
 * (`getWorkingMemory` / `updateWorkingMemory` in @mastra/memory), but it
 * only operates through a live `Memory` instance bound to a thread and
 * resource id and a memory config; wiring one up here would pull the whole
 * agent memory configuration into this thin adapter for no benefit, since
 * all this needs is "read the JSON for this session, write the JSON for
 * this session". A `session_manifest` table keyed by session id, one JSON
 * blob per row, is the smaller and more testable choice.
 */
export async function openManifestStore(url: string): Promise<ManifestStore> {
  const client = createClient({ url });
  await client.execute(SCHEMA);

  return {
    async loadManifest(sessionId) {
      const result = await client.execute({
        sql: 'SELECT data FROM session_manifest WHERE session_id = ?',
        args: [sessionId],
      });
      const row = result.rows[0];
      if (!row) return emptyManifest();
      return JSON.parse(row.data as string) as SessionManifest;
    },

    async saveManifest(sessionId, manifest) {
      await client.execute({
        sql: `
          INSERT INTO session_manifest (session_id, data, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
        `,
        args: [sessionId, JSON.stringify(manifest), new Date().toISOString()],
      });
    },

    async close() {
      client.close();
    },
  };
}
