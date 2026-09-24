import { createClient, type Client } from '@libsql/client';
import type { Artifact } from '@/types';

/**
 * Artifact versioning and persistence (docs/PROMPTBOOK.md P6.6, docs/04-MODULES.md M6:
 * "Artifacts are versioned. A revision keeps the earlier file downloadable"). Mirrors
 * `src/modules/evidence/ledger.ts`'s exact style: a plain `@libsql/client` connection
 * (no Mastra import, per AGENTS.md's "modules are pure logic" rule), its own tiny
 * schema, and the same `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` counter pattern
 * `openLedger`'s `nextId` uses, so a fresh artifact mints `art_1`, `art_2`, ... .
 *
 * `(id, version)` is a composite primary key on one `artifacts` table, storing the full
 * `Artifact` as a JSON blob per row, the same "JSON-blob-per-row" choice D-14 made for
 * the evidence ledger and for the same reason: this store's only access patterns are
 * "every version of this id" and "the latest version of this id", not relational
 * querying, so hand-mapping every `Artifact` field to a column would buy nothing.
 *
 * Revisions never delete or overwrite an earlier row: `saveVersion` with a `revisionOf`
 * naming an id that already has rows inserts a NEW row at `version + 1` under that same
 * id, so "a revision of art_1 becomes art_1 version 2, and version 1 stays downloadable"
 * (docs/PROMPTBOOK.md P6.6) is true by construction, not by convention.
 */

export type ArtifactStore = {
  /** Mints a new artifact at version 1, or a new version of an existing one if `revisionOf` is given. */
  saveVersion(input: Omit<Artifact, 'id' | 'version' | 'createdAt'> & { revisionOf?: string }): Promise<Artifact>;
  getVersions(id: string): Promise<Artifact[]>; // every version, ascending
  getLatest(id: string): Promise<Artifact | undefined>;
  close(): Promise<void>;
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (id, version)
  );
  CREATE TABLE IF NOT EXISTS artifact_counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );
`;

/** Same auto-increment pattern as `openLedger`'s own `nextId` (src/modules/evidence/ledger.ts). */
async function nextId(client: Client, counterName: string, prefix: string): Promise<string> {
  const result = await client.execute({
    sql: `
      INSERT INTO artifact_counters (name, value) VALUES (?, 1)
      ON CONFLICT(name) DO UPDATE SET value = value + 1
      RETURNING value
    `,
    args: [counterName],
  });
  const value = result.rows[0]?.value;
  return `${prefix}${value}`;
}

/**
 * Opens the artifact store against a LibSQL database file, so generated artifacts and
 * their version history survive a process restart, the same guarantee D-14/D-31 already
 * give the evidence ledger and the session manifest against the same `DATABASE_URL`.
 */
export async function openArtifactStore(url: string): Promise<ArtifactStore> {
  const client = createClient({ url });
  for (const statement of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await client.execute(statement);
  }

  async function getVersionsById(id: string): Promise<Artifact[]> {
    const result = await client.execute({
      sql: 'SELECT data FROM artifacts WHERE id = ? ORDER BY version ASC',
      args: [id],
    });
    return result.rows.map((row) => JSON.parse(row.data as string) as Artifact);
  }

  return {
    async saveVersion(input) {
      const { revisionOf, ...rest } = input;

      // A `revisionOf` naming an id with existing rows becomes version + 1 under that
      // SAME id (never a new id, never overwriting the earlier row). A `revisionOf`
      // that is absent, or names an id with no rows at all yet, mints a fresh id at
      // version 1: "names an id with no existing rows" is not an error case here, it is
      // simply treated the same as "no revisionOf given" (docs/PROMPTBOOK.md P6.6).
      const existing = revisionOf ? await getVersionsById(revisionOf) : [];
      const id = existing.length > 0 ? revisionOf! : await nextId(client, 'artifacts', 'art_');
      const version = existing.length > 0 ? Math.max(...existing.map((a) => a.version)) + 1 : 1;

      const artifact: Artifact = { ...rest, id, version, createdAt: new Date().toISOString() };
      await client.execute({
        sql: 'INSERT INTO artifacts (id, version, data) VALUES (?, ?, ?)',
        args: [id, version, JSON.stringify(artifact)],
      });
      return artifact;
    },

    getVersions: getVersionsById,

    async getLatest(id) {
      const result = await client.execute({
        sql: 'SELECT data FROM artifacts WHERE id = ? ORDER BY version DESC LIMIT 1',
        args: [id],
      });
      const row = result.rows[0];
      return row ? (JSON.parse(row.data as string) as Artifact) : undefined;
    },

    async close() {
      client.close();
    },
  };
}
