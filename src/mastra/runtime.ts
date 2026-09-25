import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Source } from '@/types';
import { createSession, type DuckDBSession } from '@/modules/analysis';
import { openLedger, type EvidenceLedger } from '@/modules/evidence';
import { createSourceRegistry, ingest, type SourceRegistry } from '@/modules/sources';
import { addSource } from '@/modules/session';
import { openManifestStore, type ManifestStore } from './session/manifestStore';

/**
 * The one shared DuckDB session, source registry, evidence ledger and
 * manifest store for the whole process (docs/DECISIONS.md D-15's stand-in,
 * generalised). Before this module existed, `src/mastra/tools/analysis.ts`
 * and `documents.ts` each opened their OWN DuckDB session and registry, so a
 * file uploaded through one was invisible to the other, and neither ever
 * touched the session manifest at all: `read_session_manifest` rendered an
 * empty source list even with the sample spreadsheet loaded and queryable.
 * P5.7 and D-41 both named this exact gap as Phase 7's job. One runtime,
 * shared by every tool file and by the chat/upload API routes, fixes it.
 *
 * Still a single-session stand-in, not true multi-tenancy: AGENTS.md puts
 * "user accounts and auth" out of scope, so one shared DuckDB session for
 * every conversation is deliberate, not a shortcut. What Phase 7 adds on top
 * is a session id *per conversation* for the manifest and evidence ledger
 * (`resolveSessionId` below), so the manifest a chat turn reads is scoped to
 * that browser thread even though the underlying tables are shared.
 */

const PROJECT_ROOT = process.env.INIT_CWD || process.cwd();

/** Every caller that never sets `memory: { thread }` (Studio, tests, scripts) shares this one. */
export const DEFAULT_SESSION_ID = 'orchestrator-default-session';

function resolveDatabaseUrl(raw: string): string {
  if (!raw.startsWith('file:')) return raw; // remote libsql:// / Turso URLs pass through untouched
  const filePath = raw.slice('file:'.length);
  const isAbsolute = filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath);
  return isAbsolute ? raw : `file:${resolve(PROJECT_ROOT, filePath)}`;
}

export type Runtime = {
  session: DuckDBSession;
  registry: SourceRegistry;
  ledger: EvidenceLedger;
  manifestStore: ManifestStore;
};

let runtimePromise: Promise<Runtime> | null = null;

async function waitForReady(registry: SourceRegistry, id: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const source = registry.getSource(id);
    if (source && source.status !== 'pending') return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function mirrorSourceToManifest(store: ManifestStore, sessionId: string, source: Source): Promise<void> {
  const manifest = await store.loadManifest(sessionId);
  await store.saveManifest(sessionId, addSource(manifest, source));
}

export async function getRuntime(): Promise<Runtime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const session = await createSession('shared-runtime-session');
      const dbUrl = resolveDatabaseUrl(process.env.DATABASE_URL || 'file:./data/app.db');
      const [ledger, manifestStore] = await Promise.all([openLedger(dbUrl), openManifestStore(dbUrl)]);
      // Past every source id any saved conversation already uses (registry.ts).
      const registry = createSourceRegistry({ startAfter: await manifestStore.maxSourceNumber() });

      // Loads once on first tool call so Studio and a fresh chat both have
      // something to query and read immediately, same as Phase 2/3's original
      // stand-ins (D-15) — just merged into one registry instead of two, so a
      // spreadsheet and a document loaded this way are visible to every
      // specialist and to read_session_manifest, not just the tool file that
      // happened to load it.
      const samplePaths = [
        'samples/campaigns.xlsx',
        'samples/northwind-brief.pdf',
        'samples/customer-notes.docx',
      ].map((p) => resolve(PROJECT_ROOT, p));
      for (const samplePath of samplePaths) {
        // turbopackIgnore: this stays a plain existsSync check, not a hint to
        // trace the whole project — the three paths above are fixed, not
        // request-derived, so nothing else here needs bundling for a deploy.
        if (!existsSync(/*turbopackIgnore: true*/ samplePath)) continue;
        const source = ingest(session, registry, { path: samplePath });
        await waitForReady(registry, source.id, 30000);
        const settled = registry.getSource(source.id) ?? source;
        await mirrorSourceToManifest(manifestStore, DEFAULT_SESSION_ID, settled);
      }

      return { session, registry, ledger, manifestStore };
    })().catch((err: unknown) => {
      // Do not cache a rejected promise: a transient init failure would
      // otherwise permanently break every tool call for the rest of the process.
      runtimePromise = null;
      throw err;
    });
  }
  return runtimePromise;
}

/**
 * Registers an uploaded file or a URL against the shared runtime and mirrors
 * its status into `sessionId`'s persisted manifest: once immediately for the
 * `pending` card the chat UI shows right away, and again once ingestion
 * settles (ready or failed), polling the in-memory registry since it has no
 * change-event mechanism of its own. This is the addSource() wiring P5.7 and
 * D-41 both flagged as missing: without it, an upload updates the queryable
 * DuckDB table but the orchestrator's `read_session_manifest` never learns
 * the source exists.
 */
export async function ingestForSession(sessionId: string, input: { path: string } | { url: string }): Promise<Source> {
  const { session, registry, manifestStore } = await getRuntime();
  const source = ingest(session, registry, input);
  await mirrorSourceToManifest(manifestStore, sessionId, source);

  // Fire-and-forget background mirror (rule 5: no unhandled rejection may
  // escape this): a failure here should never surface as a crashed process,
  // only as the manifest simply not picking up the final status this once —
  // exactly the same defence ingest.ts's own runIngestion/runUrlIngestion use.
  void (async () => {
    try {
      await waitForReady(registry, source.id, 120000);
      const settled = registry.getSource(source.id);
      if (settled) await mirrorSourceToManifest(manifestStore, sessionId, settled);
    } catch {
      // best effort; the pending card the caller already got stays as the
      // last known state until a later read (e.g. a chat turn's own
      // read_session_manifest) happens to re-check the registry.
    }
  })();

  return source;
}

/** Reads `sessionId`'s manifest as-is, for the chat UI's source/artifact status panel to poll. */
export async function getManifestSnapshot(sessionId: string) {
  const { manifestStore } = await getRuntime();
  return manifestStore.loadManifest(sessionId);
}

/**
 * The session id a manifest-touching tool call should use. Mastra sets
 * `context.agent.threadId` on a tool's execution context whenever the caller
 * passed `memory: { thread }` to `agent.stream()`/`.generate()` — the chat
 * route does, keyed by the AI SDK conversation id, so each browser
 * conversation gets its own manifest. A caller that never set memory
 * (Studio, a unit test, a direct script) falls back to the one shared
 * default session every earlier phase already used.
 */
export function resolveSessionId(context?: { agent?: { threadId?: string } }): string {
  return context?.agent?.threadId || DEFAULT_SESSION_ID;
}
