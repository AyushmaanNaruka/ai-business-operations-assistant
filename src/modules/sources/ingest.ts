import { basename, extname } from 'node:path';
import type { Source, SourceKind, TableRef, ToolResult } from '@/types';
import {
  describe,
  detectQualityIssues,
  registerFile,
  registerRows,
  type DuckDBSession,
  type RegisterFileOptions,
} from '@/modules/analysis';
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
import { inspectWorkbook, sheetSlug } from './workbookSheets';

const TABULAR_KINDS: ReadonlySet<SourceKind> = new Set(['xlsx', 'csv', 'json']);
const DOCUMENT_KINDS: ReadonlySet<SourceKind> = new Set(['pdf', 'docx', 'txt']);

function toTableName(fileName: string): string {
  const stem = fileName.slice(0, fileName.length - extname(fileName).length);
  const cleaned = stem.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'source';
}

/**
 * One server process holds one DuckDB session and one registry for every
 * user, so two different files called campaigns.xlsx must not fight over the
 * table "campaigns". The first upload keeps the plain name; a later one whose
 * name is taken is registered under the source id's number instead:
 * `campaigns_12` for src_12, and `<stem>_12_t1`, `<stem>_12_t2` for tables
 * extracted from a document. Source ids are unique per process, so two
 * concurrent uploads can never derive the same fallback name.
 */
function idSuffix(id: string): string {
  return id.replace(/^src_/, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
}

/** Every table name already owned by a source in the registry, whatever its status. */
function tableNamesInUse(registry: SourceRegistry): Set<string> {
  return new Set(registry.listSources().flatMap((s) => (s.tables ?? []).map((t) => t.tableName)));
}

/**
 * DuckDB's catalog error for a clashing CREATE TABLE ("Table with name ... already
 * exists"), as passed through by registerFile and registerRows. Covers the race
 * the registry check cannot: two uploads with the same name registering at once,
 * neither yet listed with its tables.
 */
function isTableExistsError(result: ToolResult<TableRef>): boolean {
  return !result.ok && /already exists/i.test(result.error.message);
}

/**
 * Registers under `preferred` unless the caller already knows it is taken, and
 * retries once under `fallback` if DuckDB reports the table already exists.
 * Returns whether the fallback was used, so a document can keep its later
 * tables on the same scheme as its first.
 */
async function registerUnderFreeName(
  preferred: string,
  fallback: string,
  preferredTaken: boolean,
  register: (tableName: string) => Promise<ToolResult<TableRef>>,
): Promise<{ result: ToolResult<TableRef>; usedFallback: boolean }> {
  if (preferredTaken) return { result: await register(fallback), usedFallback: true };
  const first = await register(preferred);
  if (!isTableExistsError(first)) return { result: first, usedFallback: false };
  return { result: await register(fallback), usedFallback: true };
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
      path: input.path,
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
      // Same tables, so the same card body (sheet labels and notes included) under this source's own header line.
      summary: [buildSourceCard(current, {}), ...cached.summary.split('\n').slice(1)].join('\n'),
    };
    registry.addSource(ready, hash);
    return;
  }

  // A workbook registers one table per non-empty sheet; every other tabular file is
  // one table. The first table keeps the file's plain name (or its id-suffixed
  // fallback, D-73), so a single-sheet workbook is named exactly as before; every
  // later sheet is `<first table name>__<sheet slug>`. All of them go on this one
  // Source's `tables`, which is what scopes a table to its source (D-72).
  const jobs = kind === 'xlsx' ? await sheetJobs(path) : [{ options: {} }];
  const taken = tableNamesInUse(registry);
  const registered: { table: TableRef; job: SheetJob }[] = [];
  const notes: string[] = [];
  let firstFailure: ToolResult<TableRef> | undefined;
  let baseName: string | undefined;
  for (const job of jobs) {
    const preferred = baseName === undefined ? toTableName(current.name) : `${baseName}__${job.slug ?? 'sheet'}`;
    const { result } = await registerUnderFreeName(preferred, `${preferred}_${idSuffix(id)}`, taken.has(preferred), (tableName) =>
      registerFile(session, path, tableName, job.options),
    );
    if (!result.ok) {
      firstFailure ??= result;
      // One unreadable sheet does not sink the others; it is reported on the card instead.
      if (job.sheet !== undefined) notes.push(`sheet ${quoteSheet(job.sheet)} was not registered: DuckDB could not read it as a table`);
      continue;
    }
    baseName ??= result.data.tableName;
    registered.push({ table: result.data, job });
  }
  if (registered.length === 0) {
    const error = firstFailure && !firstFailure.ok ? firstFailure.error : { code: 'PARSE_FAILED', message: `No table could be read from "${current.name}".` };
    registry.updateStatus(id, 'failed', { code: error.code, message: error.message });
    return;
  }

  const tables: TableRef[] = [];
  const sheets: Record<string, string> = {};
  for (const { table: registeredTable, job } of registered) {
    const profileResult = await describe(session, registeredTable.tableName);
    if (!profileResult.ok) {
      registry.updateStatus(id, 'failed', { code: profileResult.error.code, message: profileResult.error.message });
      return;
    }
    const warnings = detectQualityIssues(profileResult.data, profileResult.data.sample);
    tables.push({
      tableName: registeredTable.tableName,
      rowCount: profileResult.data.rowCount,
      columns: profileResult.data.columns.map((c) => ({ name: c.name, type: c.type, nullRate: c.nullRate })),
      qualityWarnings: warnings,
    });
    if (job.sheet !== undefined) sheets[registeredTable.tableName] = job.sheet;
    if (job.options.range !== undefined && job.sheet !== undefined) {
      notes.push(`sheet ${quoteSheet(job.sheet)}: title rows above the header were skipped, table read from ${job.options.range}`);
    }
  }

  const ready: Source = {
    ...current,
    kind,
    status: 'ready',
    tables,
    summary: buildSourceCard(current, { tables, ...(tables.length > 1 ? { sheets } : {}), ...(notes.length > 0 ? { notes } : {}) }),
  };
  registry.addSource(ready, hash);
}

type SheetJob = { sheet?: string; slug?: string; options: RegisterFileOptions };

/**
 * One registration per non-empty sheet, in tab order. The first sheet, when its
 * header is on its first content row, is read with no options at all: the same
 * SQL a workbook was always registered with. A workbook exceljs cannot open, or
 * one with no values anywhere, falls back to that same single default read, so
 * DuckDB's own error (corrupt file, "No rows found") is what the user sees.
 */
async function sheetJobs(path: string): Promise<SheetJob[]> {
  const layouts = await inspectWorkbook(path);
  const nonEmpty = layouts.ok ? layouts.data.filter((layout) => !layout.empty) : [];
  if (nonEmpty.length === 0) return [{ options: {} }];

  const slugs = new Set<string>();
  return nonEmpty.map((layout) => {
    let slug = sheetSlug(layout.name, layout.index);
    if (slugs.has(slug)) slug = `${slug}_${layout.index + 1}`;
    slugs.add(slug);
    const options: RegisterFileOptions =
      layout.index === 0 && layout.headerRange === undefined
        ? {}
        : { sheet: layout.name, ...(layout.headerRange !== undefined ? { range: layout.headerRange } : {}) };
    return { sheet: layout.name, slug, options };
  });
}

/** A sheet name is file content (rule 4): quoted and capped, never spliced in raw. */
function quoteSheet(name: string): string {
  return JSON.stringify(name.length > 60 ? `${name.slice(0, 57)}...` : name);
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
    // Reuse the parse, not the storage: every read path (get_document, the RAG
    // index) is keyed by source id, so the new id needs its own stored markdown
    // and index entry. Pointing at the earlier source's doc left this id
    // unreadable (SOURCE_NOT_FOUND) whenever a file was re-uploaded in a new chat.
    const cachedMarkdown = await getDocument(cached.id);
    if (cachedMarkdown.ok) {
      await finishDocumentIngestion(registry, id, current, kind, cachedMarkdown.data, cached.doc.pageCount, cached.tables ?? [], hash);
      return;
    }
    // The earlier source's markdown is gone from disk: parse this file afresh below.
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

  // One naming scheme per document: if any plain `<stem>_tN` is already owned by
  // another source, every table here takes the id-derived name, so a document's
  // tables never come out half plain and half suffixed. The race retry can only
  // switch the scheme from that table onwards.
  const taken = tableNamesInUse(registry);
  const plainNames = extractedTables.data.map((_, i) => `${stem}_t${i + 1}`);
  let useFallback = plainNames.some((name) => taken.has(name));
  const tables: TableRef[] = [];
  for (let i = 0; i < extractedTables.data.length; i++) {
    const rows = extractedTables.data[i]!;
    const outcome = await registerUnderFreeName(plainNames[i]!, `${stem}_${idSuffix(id)}_t${i + 1}`, useFallback, (tableName) =>
      registerRows(session, tableName, rows),
    );
    useFallback ||= outcome.usedFallback;
    const registered = outcome.result;
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
