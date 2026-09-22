import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openLedger, type EvidenceLedger } from './ledger';

describe('EvidenceLedger (in-memory)', () => {
  let ledger: EvidenceLedger;

  afterEach(async () => {
    if (ledger) await ledger.close();
  });

  it('auto increments evidence ids as E1, E2, ...', async () => {
    ledger = await openLedger(':memory:');
    const e1 = await ledger.addEvidence({
      claim: 'conversion rate is 4.2%',
      kind: 'computed',
      sourceId: 'src_1',
      sourceName: 'campaigns.xlsx',
      locator: 'campaigns',
      method: 'SELECT ...',
      value: 0.042,
    });
    const e2 = await ledger.addEvidence({
      claim: 'target audience is mid-market',
      kind: 'document',
      sourceId: 'src_2',
      sourceName: 'brief.pdf',
      locator: 'page 3',
    });

    expect(e1.id).toBe('E1');
    expect(e2.id).toBe('E2');
  });

  it('auto increments finding ids as F1, F2, ... independently of evidence ids', async () => {
    ledger = await openLedger(':memory:');
    const f1 = await ledger.addFinding({
      statement: 'Email is the efficiency leader',
      evidenceIds: ['E1'],
      reasoning: 'highest CVR among channels with a reportable sample',
      soWhat: 'shift budget toward email',
      confidence: 'high',
    });
    const f2 = await ledger.addFinding({
      statement: 'Paid social buys volume, not revenue',
      evidenceIds: ['E2', 'E3'],
      reasoning: 'spend up, revenue flat since month 12',
      soWhat: 'reconsider paid social spend growth',
      confidence: 'medium',
    });

    expect(f1.id).toBe('F1');
    expect(f2.id).toBe('F2');
  });

  it('assigns confidence by rule: a caller-supplied confidence-like field cannot leak through', async () => {
    ledger = await openLedger(':memory:');
    const evidence = await ledger.addEvidence({
      claim: 'competitor launched a free tier',
      kind: 'web',
      sourceId: 'src_5',
      sourceName: 'competitor.com/blog',
      locator: 'https://competitor.com/blog/free-tier',
      retrievedAt: new Date().toISOString(),
      // @ts-expect-error confidence is not part of AddEvidenceInput; this proves it at the type level
      confidence: 'high',
    });

    // Web content is medium by rule, regardless of the bogus field above.
    expect(evidence.confidence).toBe('medium');
  });

  it('getEvidence returns only the requested ids', async () => {
    ledger = await openLedger(':memory:');
    const a = await ledger.addEvidence({
      claim: 'a', kind: 'computed', sourceId: 's', sourceName: 's', locator: 'l', value: 1,
    });
    await ledger.addEvidence({ claim: 'b', kind: 'computed', sourceId: 's', sourceName: 's', locator: 'l', value: 2 });

    const result = await ledger.getEvidence([a.id]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(a.id);
  });

  it('detectConflicts fires through the ledger for matching metric keys', async () => {
    ledger = await openLedger(':memory:');
    const a = await ledger.addEvidence({
      claim: 'website says 6% conversion',
      kind: 'web',
      sourceId: 'src_1',
      sourceName: 'competitor.com',
      locator: 'https://competitor.com',
      retrievedAt: new Date().toISOString(),
      value: 0.06,
      metric: { name: 'conversion_rate', scope: 'channel=paid_social', unit: 'ratio' },
    });
    const b = await ledger.addEvidence({
      claim: 'spreadsheet computes 4.2% conversion',
      kind: 'computed',
      sourceId: 'src_2',
      sourceName: 'campaigns.xlsx',
      locator: 'campaigns',
      method: 'SELECT SUM(conversions)/SUM(clicks) ...',
      value: 0.042,
      metric: { name: 'conversion_rate', scope: 'channel=paid_social', unit: 'ratio' },
    });

    const conflicts = await ledger.detectConflicts([a.id, b.id]);
    expect(conflicts).toHaveLength(1);
  });

  it('gatherFor returns matching findings plus the full evidence closure they reference', async () => {
    ledger = await openLedger(':memory:');
    const e1 = await ledger.addEvidence({
      claim: 'email CVR is 4.2%', kind: 'computed', sourceId: 's', sourceName: 's', locator: 'l', value: 0.042,
    });
    const e2 = await ledger.addEvidence({
      claim: 'email CPA is $12', kind: 'computed', sourceId: 's', sourceName: 's', locator: 'l', value: 12,
    });
    const unrelated = await ledger.addEvidence({
      claim: 'unrelated fact', kind: 'computed', sourceId: 's', sourceName: 's', locator: 'l', value: 1,
    });

    await ledger.addFinding({
      statement: 'Email is the efficiency leader',
      evidenceIds: [e1.id, e2.id],
      reasoning: 'high CVR, low CPA',
      soWhat: 'shift budget toward email',
      confidence: 'high',
    });
    await ledger.addFinding({
      statement: 'Unrelated finding about something else entirely',
      evidenceIds: [unrelated.id],
      reasoning: 'n/a',
      soWhat: 'n/a',
      confidence: 'low',
    });

    const result = await ledger.gatherFor('email');

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.statement).toContain('Email');

    const evidenceIds = result.evidence.map((e) => e.id).sort();
    expect(evidenceIds).toEqual([e1.id, e2.id].sort());
  });
});

describe('EvidenceLedger persistence', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'evidence-ledger-'));
  });

  afterAll(async () => {
    // Windows sometimes keeps the WAL/SHM file handles open for a moment
    // after client.close() resolves; retry the cleanup rather than fail the
    // suite over a harmless race in test teardown.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rm(dir, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  });

  it('survives a restart: data written before close is readable after reopening the same file', async () => {
    const dbPath = join(dir, 'ledger.db');
    const url = `file:${dbPath.replace(/\\/g, '/')}`;

    const first = await openLedger(url);
    const evidence = await first.addEvidence({
      claim: 'persisted fact',
      kind: 'computed',
      sourceId: 'src_1',
      sourceName: 'campaigns.xlsx',
      locator: 'campaigns',
      value: 42,
    });
    await first.close();

    const second = await openLedger(url);
    try {
      const reloaded = await second.getEvidence([evidence.id]);
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0]!.claim).toBe('persisted fact');

      // The id counter itself must also survive, so ids never collide across a restart.
      const next = await second.addEvidence({
        claim: 'second fact',
        kind: 'computed',
        sourceId: 'src_1',
        sourceName: 'campaigns.xlsx',
        locator: 'campaigns',
        value: 1,
      });
      expect(next.id).not.toBe(evidence.id);
    } finally {
      await second.close();
    }
  });
});
