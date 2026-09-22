import { basename, extname } from 'node:path';
import type { Source, SourceKind, TableRef, ToolResult } from '@/types';
import { describe, detectQualityIssues, registerFile, registerRows, type DuckDBSession } from '@/modules/analysis';
import {
  countTokens,
  extractTablesFromDocx,
  extractTablesFromPdf,
  formatWebMarker,
  getDocument,
  index as indexDocument,
  rebalance,
  route,
  saveMarkdown,
  toMarkdown,
  type DocEntry,
  type ExtractedTable,
} from '@/modules/documents';
import { ok } from '@/modules/reliability';
import { readPage } from '@/modules/research';
import { hashFile } from './contentHash';
import { detectType } from './detectType';
import { detectProposedTasks } from './proposedTasks';
import type { SourceRegistry } from './registry';
import { buildSourceCard } from './sourceCard';

const TABULAR_KINDS: ReadonlySet<SourceKind> = new Set(['xlsx', 'csv', 'json']);
const DOCUMENT_KINDS: ReadonlySet<SourceKind> = new Set(['pdf', 'docx', 'txt']);

function toTableName(fileName: string): string {
  const stem = fileName.slice(0, fileName.length - extname(fileName).length);
  const cleaned = stem.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'source';
}

/** "acme.com/about", not the full https:// URL: mirrors the source-card examples in docs/03-ARCHITECTURE.md 4.1. Falls back to the raw string for a URL too malformed for the URL constructor, rather than throwing. */
function urlToSourceName(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch {
    return url;
  }
}

/**
 * Detects, registers, profiles and cards a source: a file on disk (xlsx,
 * csv, json, pdf, docx, txt) or a public URL (docs/04-MODULES.md M1's
 * `ingest(input: { path?: string; url?: string })`). Runs asynchronously:
 * returns a `pending` Source immediately and finishes the real work in the
 * background, exactly like a real upload does, so the orchestrator's
 * "check status before delegating" rule (3.3) has something real to check.
 *
 * The two inputs are a discriminated union rather than two optional fields
 * on one object, so a caller cannot accidentally supply neither (or both),
 * and every existing `{ path }` call site needs no change.
 */
export function ingest(session: DuckDBSession, registry: SourceRegistry, input: { path: string } | { url: string }): Source {
  const id = registry.nextId();
  const now = new Date().toISOString();

  if ('path' in input) {
    const name = basename(input.path);
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

  const name = urlToSourceName(input.url);
  const pending: Source = {
    id,
    name,
    kind: 'web', // known immediately for a URL; no detectType step needed
    origin: 'url',
    status: 'pending',
    summary: `${id}  ${name}  reading...`,
    addedAt: now,
  };
  registry.addSource(pending);
  void runUrlIngestion(registry, id, input.url);
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

  if (DOCUMENT_KINDS.has(kind)) {
    await runDocumentIngestion(session, registry, id, path, kind, current);
    return;
  }

  if (!TABULAR_KINDS.has(kind)) {
    registry.updateStatus(id, 'failed', {
      code: 'UNSUPPORTED_FORMAT',
      message: `"${kind}" has no ingestion path yet.`,
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
      summary: buildSourceCard(current, { tables: cached.tables }),
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
    summary: buildSourceCard(current, { tables: [table] }),
  };
  registry.addSource(ready, hash);
}

/**
 * Parses a document to markdown with citation markers (M3), extracts any
 * tables it contains and registers them in DuckDB alongside the prose (M1,
 * docs/03-ARCHITECTURE.md Part 9 gap A), then hands off to
 * `finishDocumentIngestion` for the rest of the pipeline (store, token
 * count, route, index if needed, propose tasks, card, rebalance) shared
 * with the URL path below.
 */
async function runDocumentIngestion(
  session: DuckDBSession,
  registry: SourceRegistry,
  id: string,
  path: string,
  kind: SourceKind,
  current: Source,
): Promise<void> {
  const hash = await hashFile(path);
  const cached = registry.findByHash(hash);
  if (cached?.status === 'ready' && cached.doc) {
    const ready: Source = {
      ...current,
      kind,
      status: 'ready',
      doc: cached.doc,
      tables: cached.tables,
      ...(cached.proposedTasks ? { proposedTasks: cached.proposedTasks } : {}),
    };
    registry.addSource({ ...ready, summary: buildSourceCard(ready, { doc: ready.doc, tables: ready.tables }) }, hash);
    return;
  }

  const markdownResult = await toMarkdown(path, kind);
  if (!markdownResult.ok) {
    registry.updateStatus(id, 'failed', { code: markdownResult.error.code, message: markdownResult.error.message });
    return;
  }
  const { markdown, pageCount } = markdownResult.data;

  const stem = toTableName(current.name);
  const extractedTables: ToolResult<ExtractedTable[]> =
    kind === 'pdf' ? await extractTablesFromPdf(path) : kind === 'docx' ? await extractTablesFromDocx(path) : ok([]);
  if (!extractedTables.ok) {
    registry.updateStatus(id, 'failed', { code: extractedTables.error.code, message: extractedTables.error.message });
    return;
  }

  const tables: TableRef[] = [];
  for (let i = 0; i < extractedTables.data.length; i++) {
    const tableName = `${stem}_t${i + 1}`;
    const registered = await registerRows(session, tableName, extractedTables.data[i]!);
    if (registered.ok) tables.push(registered.data);
    // A single table failing to register (e.g. it turned out empty) is not
    // fatal to the document as a whole; the prose still ingests.
  }

  await finishDocumentIngestion(registry, id, current, kind, markdown, pageCount, tables, hash);
}

/**
 * The URL entry point (docs/PROMPTBOOK.md P4.2, docs/03-ARCHITECTURE.md
 * 3.6: "every fetched page becomes a source... one pipeline, two entry
 * points"). Reads the page (Exa/Tavily-independent: this is M4's
 * `readPage`, Jina Reader with a local-fallback), stamps it with a web
 * marker carrying the URL and `retrievedAt` in place of a page number, then
 * joins the exact same tail as a parsed file. There is no local file here,
 * so unlike `runDocumentIngestion` there is no content hash to dedupe by
 * and no `extractTablesFromPdf`/`Docx` step: a fetched page has no `pages`
 * concept and nothing to run those parsers against.
 */
async function runUrlIngestion(registry: SourceRegistry, id: string, url: string): Promise<void> {
  try {
    await runUrlIngestionUnsafe(registry, id, url);
  } catch (err) {
    registry.updateStatus(id, 'failed', {
      code: 'PARSE_FAILED',
      message: `Unexpected error while ingesting "${url}": ${(err as Error).message}`,
    });
  }
}

async function runUrlIngestionUnsafe(registry: SourceRegistry, id: string, url: string): Promise<void> {
  const current = registry.getSource(id);
  if (!current) return;

  const pageResult = await readPage(url);
  if (!pageResult.ok) {
    registry.updateStatus(id, 'failed', { code: pageResult.error.code, message: pageResult.error.message });
    return;
  }

  const { markdown: pageMarkdown, retrievedAt } = pageResult.data;
  const markdown = `${formatWebMarker(url, retrievedAt)}\n\n${pageMarkdown.trim()}`;

  await finishDocumentIngestion(registry, id, current, 'web', markdown, undefined, []);
}

/**
 * The tail shared by both document entry points (docs/03-ARCHITECTURE.md
 * 3.6: "one pipeline, two entry points"): store the markdown, count its
 * tokens, route full or indexed, embed when indexed, detect proposed
 * tasks, write the ready Source and card, and rebalance the session. Takes
 * markdown and any already-extracted tables rather than a path, so the
 * URL path (which has no local file and no tables) and the file path
 * (which already ran `toMarkdown` and table extraction) converge here
 * without either one re-deriving what the other already produced.
 */
async function finishDocumentIngestion(
  registry: SourceRegistry,
  id: string,
  current: Source,
  kind: SourceKind,
  markdown: string,
  pageCount: number | undefined,
  tables: TableRef[],
  hash?: string,
): Promise<void> {
  const markdownPath = await saveMarkdown(id, markdown);
  const tokenCount = countTokens(markdown);
  const sessionTotal = registry
    .listSources()
    .filter((s) => s.status === 'ready' && s.doc?.mode === 'full')
    .reduce((sum, s) => sum + (s.doc?.tokenCount ?? 0), 0);
  const mode = route(tokenCount, sessionTotal);

  // A source routed 'indexed' is only actually searchable once it is
  // embedded; an 'indexed' source that failed to embed has no working read
  // path at all (get_document is for 'full' mode only), so that failure is
  // fatal to the source rather than something to silently ignore.
  if (mode === 'indexed') {
    const indexed = await indexDocument(id, markdown, { sourceName: current.name, sourceType: kind });
    if (!indexed.ok) {
      registry.updateStatus(id, 'failed', { code: indexed.error.code, message: indexed.error.message });
      return;
    }
  }

  // File content is data, never instruction (AGENTS.md rule 4): any
  // requirements-shaped text detected here is only ever surfaced to the
  // user as a proposal (Source.proposedTasks), never executed. This applies
  // just as much to a fetched web page as to an uploaded file.
  const proposedTasks = detectProposedTasks(markdown);

  const ready: Source = {
    ...current,
    kind,
    status: 'ready',
    doc: { mode, tokenCount, ...(pageCount !== undefined ? { pageCount } : {}), markdownPath },
    ...(tables.length > 0 ? { tables } : {}),
    ...(proposedTasks.length > 0 ? { proposedTasks } : {}),
  };
  registry.addSource({ ...ready, summary: buildSourceCard(ready, { doc: ready.doc, tables: ready.tables }) }, hash);

  await rebalanceSession(registry);
}

/**
 * Re-applies the session's `SESSION_DOC_TOKEN_BUDGET` across every
 * doc-bearing source, flipping the largest `full` sources to `indexed`
 * until the total fits (docs/PROMPTBOOK.md P3.3: "flips the largest, not
 * the newest"). Cheap to call after every document ingestion: it is a
 * no-op unless the session is genuinely over budget.
 *
 * A source flipped to `indexed` here was never embedded at ingest time (it
 * was `full` back then), so this also indexes it now. Best effort: unlike
 * the initial-ingest path, a source that was already `ready` and working
 * does not get retroactively marked `failed` just because a later rebalance
 * could not embed it; the mode flip is skipped instead and it stays `full`
 * for this pass, tried again on the next rebalance.
 */
async function rebalanceSession(registry: SourceRegistry): Promise<void> {
  const docSources = registry.listSources().filter((s) => s.status === 'ready' && s.doc);
  const entries: DocEntry[] = docSources.map((s) => ({ sourceId: s.id, tokenCount: s.doc!.tokenCount, mode: s.doc!.mode }));
  const rebalanced = rebalance(entries);

  for (const entry of rebalanced) {
    const source = docSources.find((s) => s.id === entry.sourceId)!;
    if (source.doc!.mode === entry.mode) continue;

    if (entry.mode === 'indexed') {
      const markdown = await getDocument(source.id);
      if (!markdown.ok) continue;
      const indexed = await indexDocument(source.id, markdown.data, { sourceName: source.name, sourceType: source.kind });
      if (!indexed.ok) continue;
    }

    const updated: Source = { ...source, doc: { ...source.doc!, mode: entry.mode } };
    registry.addSource({ ...updated, summary: buildSourceCard(updated, { doc: updated.doc, tables: updated.tables }) });
  }
}
