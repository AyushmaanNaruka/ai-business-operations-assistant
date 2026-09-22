import { createClient, type Client } from '@libsql/client';
import type { Evidence, Finding } from '@/types';
import { assignConfidence, type ConfidenceContext } from './confidence';
import { detectConflicts as detectConflictsPure, type Conflict } from './conflicts';

export type AddEvidenceInput = Omit<Evidence, 'id' | 'createdAt' | 'confidence'> & ConfidenceContext;
export type AddFindingInput = Omit<Finding, 'id' | 'createdAt'>;

export type EvidenceLedger = {
  addEvidence(input: AddEvidenceInput): Promise<Evidence>;
  addFinding(input: AddFindingInput): Promise<Finding>;
  getEvidence(ids: string[]): Promise<Evidence[]>;
  getFindings(ids: string[]): Promise<Finding[]>;
  detectConflicts(ids: string[]): Promise<Conflict[]>;
  gatherFor(topic: string): Promise<{ findings: Finding[]; evidence: Evidence[] }>;
  close(): Promise<void>;
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ledger_counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );
`;

async function nextId(client: Client, counterName: string, prefix: string): Promise<string> {
  const result = await client.execute({
    sql: `
      INSERT INTO ledger_counters (name, value) VALUES (?, 1)
      ON CONFLICT(name) DO UPDATE SET value = value + 1
      RETURNING value
    `,
    args: [counterName],
  });
  const value = result.rows[0]?.value;
  return `${prefix}${value}`;
}

/**
 * Opens the evidence ledger against a LibSQL database file, so it survives a
 * process restart (docs/04-MODULES.md M5). Uses the plain `@libsql/client`
 * driver directly rather than `@mastra/libsql`, keeping this module free of
 * any Mastra import per AGENTS.md's "modules are pure logic" rule, while
 * still writing to the same file Mastra's own storage uses (see
 * docs/DECISIONS.md D-14).
 */
export async function openLedger(url: string): Promise<EvidenceLedger> {
  const client = createClient({ url });
  for (const statement of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await client.execute(statement);
  }

  async function getEvidenceByIds(ids: string[]): Promise<Evidence[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const result = await client.execute({
      sql: `SELECT data FROM evidence WHERE id IN (${placeholders})`,
      args: ids,
    });
    return result.rows.map((row) => JSON.parse(row.data as string) as Evidence);
  }

  return {
    async addEvidence(input) {
      const { retrieved, inferred, ...rest } = input;
      const confidence = assignConfidence(input.kind, { retrieved, inferred });
      const id = await nextId(client, 'evidence', 'E');
      const evidence: Evidence = { ...rest, id, confidence, createdAt: new Date().toISOString() };
      await client.execute({
        sql: 'INSERT INTO evidence (id, data) VALUES (?, ?)',
        args: [id, JSON.stringify(evidence)],
      });
      return evidence;
    },

    async addFinding(input) {
      const id = await nextId(client, 'findings', 'F');
      const finding: Finding = { ...input, id, createdAt: new Date().toISOString() };
      await client.execute({
        sql: 'INSERT INTO findings (id, data) VALUES (?, ?)',
        args: [id, JSON.stringify(finding)],
      });
      return finding;
    },

    getEvidence: getEvidenceByIds,

    async getFindings(ids) {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => '?').join(', ');
      const result = await client.execute({
        sql: `SELECT data FROM findings WHERE id IN (${placeholders})`,
        args: ids,
      });
      return result.rows.map((row) => JSON.parse(row.data as string) as Finding);
    },

    async detectConflicts(ids) {
      const evidence = await getEvidenceByIds(ids);
      return detectConflictsPure(evidence);
    },

    async gatherFor(topic) {
      const needle = topic.toLowerCase();
      const allFindingsResult = await client.execute('SELECT data FROM findings');
      const allFindings = allFindingsResult.rows.map((row) => JSON.parse(row.data as string) as Finding);

      const findings = allFindings.filter((f) =>
        [f.statement, f.reasoning, f.soWhat].some((text) => text.toLowerCase().includes(needle)),
      );

      const evidenceIds = [...new Set(findings.flatMap((f) => f.evidenceIds))];
      const evidence = await getEvidenceByIds(evidenceIds);

      return { findings, evidence };
    },

    async close() {
      client.close();
    },
  };
}
