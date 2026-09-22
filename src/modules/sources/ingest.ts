import { basename, extname } from 'node:path';
import type { Source, SourceKind, TableRef } from '@/types';
import { describe, detectQualityIssues, registerFile, type DuckDBSession } from '@/modules/analysis';
import { hashFile } from './contentHash';
import { detectType } from './detectType';
import type { SourceRegistry } from './registry';
import { buildSourceCard } from './sourceCard';

const TABULAR_KINDS: ReadonlySet<SourceKind> = new Set(['xlsx', 'csv', 'json']);

function toTableName(fileName: string): string {
  const stem = fileName.slice(0, fileName.length - extname(fileName).length);
  const cleaned = stem.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'source';
}

/**
 * Detects, registers, profiles and cards a tabular source (docs/04-MODULES.md
 * M1). Runs asynchronously: returns a `pending` Source immediately and
 * finishes the real work in the background, exactly like a real upload does,
 * so the orchestrator's "check status before delegating" rule (3.3) has
 * something real to check. Document sources (pdf/docx/txt) are Phase 3's job
 * (M3); this ingests xlsx, csv and json only.
 */
export function ingest(session: DuckDBSession, registry: SourceRegistry, input: { path: string }): Source {
  const id = registry.nextId();
  const name = basename(input.path);
  const now = new Date().toISOString();

  const pending: Source = {
    id,
    name,
    kind: 'txt', // placeholder until detectType resolves; never read while status is 'pending'
    origin: 'upload',
    status: 'pending',
    summary: `${id}  ${name}  detecting type...`,
    addedAt: now,
  };
  registry.addSource(pending);

  void runIngestion(session, registry, id, input.path);

  return pending;
}

async function runIngestion(session: DuckDBSession, registry: SourceRegistry, id: string, path: string): Promise<void> {
  try {
    await runIngestionUnsafe(session, registry, id, path);
  } catch (err) {
    // Fire-and-forget background work: an uncaught rejection here would be
    // silently swallowed and leave the source stuck at 'pending' forever
    // (docs/05-DATA-MODEL.md: status is load bearing). Every module call
    // above already returns ToolResult, but this is the last line of
    // defence against a genuinely unexpected throw (e.g. a bad file handle).
    registry.updateStatus(id, 'failed', {
      code: 'PARSE_FAILED',
      message: `Unexpected error while ingesting "${path}": ${(err as Error).message}`,
    });
  }
}

async function runIngestionUnsafe(session: DuckDBSession, registry: SourceRegistry, id: string, path: string): Promise<void> {
  const current = registry.getSource(id);
  if (!current) return;

  const typeResult = await detectType(path);
  if (!typeResult.ok) {
    registry.updateStatus(id, 'failed', { code: typeResult.error.code, message: typeResult.error.message });
    return;
  }

  const kind = typeResult.data;
  if (!TABULAR_KINDS.has(kind)) {
    registry.updateStatus(id, 'failed', {
      code: 'UNSUPPORTED_FORMAT',
      message: `"${kind}" is a document type; the document ingestion pipeline (Phase 3) handles it, not this tabular path.`,
    });
    return;
  }

  // Parsed output is cached by content hash: an identical re-upload reuses the
  // table already registered under the earlier source instead of re-reading
  // and re-profiling the file (docs/04-MODULES.md M1).
  const hash = await hashFile(path);
  const cached = registry.findByHash(hash);
  if (cached?.status === 'ready' && cached.tables) {
    const ready: Source = {
      ...current,
      kind,
      status: 'ready',
      tables: cached.tables,
      summary: buildSourceCard(current, cached.tables),
    };
    registry.addSource(ready, hash);
    return;
  }

  const tableName = toTableName(current.name);
  const registerResult = await registerFile(session, path, tableName);
  if (!registerResult.ok) {
    registry.updateStatus(id, 'failed', { code: registerResult.error.code, message: registerResult.error.message });
    return;
  }

  const profileResult = await describe(session, tableName);
  if (!profileResult.ok) {
    registry.updateStatus(id, 'failed', { code: profileResult.error.code, message: profileResult.error.message });
    return;
  }

  const warnings = detectQualityIssues(profileResult.data, profileResult.data.sample);
  const table: TableRef = {
    tableName: registerResult.data.tableName,
    rowCount: profileResult.data.rowCount,
    columns: profileResult.data.columns.map((c) => ({ name: c.name, type: c.type, nullRate: c.nullRate })),
    qualityWarnings: warnings,
  };

  const ready: Source = {
    ...current,
    kind,
    status: 'ready',
    tables: [table],
    summary: buildSourceCard(current, [table]),
  };
  registry.addSource(ready, hash);
}
