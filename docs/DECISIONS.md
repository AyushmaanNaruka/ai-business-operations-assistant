# Decision log

Five lines per decision: what was chosen, what the alternative was, why. **Append as you go, not at the end.** By Sunday this file is the README's hardest section already written, and it is the direct answer to the evaluation criterion about explaining technical trade offs.

Format:

```
## D-nn Title
Date, one line of context
**Chose:** ...
**Over:** ...
**Because:** ...
**Cost:** what this decision makes harder
```

---

## D-01 Supervisor plus subagents, not an agent network
22 Sep 2026, choosing the multi agent topology.
**Chose:** One orchestrator with three specialists, two levels deep, communicating through typed task contracts.
**Over:** Mastra's `Agent.network()` LLM routed topology, or a flat single agent with every tool.
**Because:** `.network()` was deprecated in February 2026 after context loss between hops, routing that broke across providers, and streaming failing at three levels of nesting. Typed contracts make each specialist unit testable without a model.
**Cost:** The orchestrator must be explicitly told when to delegate. Less emergent flexibility than LLM routing.

## D-02 DuckDB and SQL, not a code interpreter
22 Sep 2026, deciding how numerical analysis happens.
**Chose:** Agent writes SQL, DuckDB executes it in process, read only with external access disabled.
**Over:** Generating Python or JavaScript and running it in a sandbox (isolated-vm, Docker, E2B).
**Because:** SQL is the most reliable code an LLM generates. DuckDB reads xlsx and csv directly, is out of core so large files do not kill the process, and needs no sandbox because the blast radius of a read only SELECT is tiny.
**Cost:** Exotic analysis that SQL cannot express is out of reach. Mitigated with a fixed stats tool.

## D-03 Full context by default, RAG only for large documents
22 Sep 2026, deciding how documents are read.
**Chose:** Measure tokens at ingest. Under about 25,000 tokens the whole document goes into context; over it, chunk and retrieve.
**Over:** RAG for every document, which is the conventional choice.
**Because:** Retrieval on a three page brief can silently miss the relevant sentence, cannot answer whole document questions, and severs cross references, while adding an embedding call and a retrieval call. Reliability and latency are both graded.
**Cost:** Two code paths instead of one, and a threshold that needs tuning against real files.

## D-04 The artifact builder is a workflow, not an agent
22 Sep 2026, deciding where artifact generation lives.
**Chose:** An eight step Mastra workflow where only the authoring step calls a model.
**Over:** A fourth specialist agent with rendering tools.
**Because:** Building a file is a known sequence with nothing to reason about. A workflow is cheaper, faster, unit testable and cannot wander off. Mastra's own guidance is to default to deterministic.
**Cost:** Less adaptive if a user asks for something genuinely novel. Mitigated by the generic-document fallback.

## D-05 Evidence ledger as the single source of facts
22 Sep 2026, deciding how grounding works.
**Chose:** Every fact is an Evidence entry with an origin and a method; every conclusion is a Finding citing evidence IDs.
**Over:** Instructing the model to cite its sources in prose.
**Because:** One small typed store answers five graded criteria at once: grounding, no fabrication, traceability, multiple sources, and conflicting information. Instructions are not enforcement.
**Cost:** Every specialist has to construct evidence entries, which is extra code in every tool.

## D-06 Skills carry artifact quality, schemas carry structure
22 Sep 2026, deciding how artifact quality is encoded.
**Chose:** Three layers. A Mastra Skill says what good looks like, a Zod schema says what shape it must be, a renderer turns it into a file.
**Over:** One large prompt per artifact type containing all three concerns.
**Because:** Deck quality can then be improved by editing a markdown file, the skill is readable by a non engineer, and skills load on demand so Excel guidance is not in context during a "hello".
**Cost:** Three places to look when an artifact comes out wrong.

## D-07 File content is data, never instruction
22 Sep 2026, handling documents that contain requirements.
**Chose:** Tasks found inside an uploaded document are extracted into `proposedTasks` and surfaced to the user for approval.
**Over:** Acting on them automatically, which would be a nicer demo.
**Because:** Executing instructions found in user supplied files is a prompt injection path. The brief mentions "a set of research requirements" as an input, so this case will occur.
**Cost:** One extra confirmation step in a flow that could have been automatic.

## D-08 Scaffold via a temp sibling directory, kept the generated observability stack
22 Sep 2026, running `npm create mastra@latest` against this repo.
**Chose:** `create-mastra@1.31.0` (published 22 Sep 2026) rejects `.` as a project name outright, so scaffolded into a throwaway sibling folder with `--llm google --no-install --no-git`, then merged `package.json`, `tsconfig.json`, `src/mastra/index.ts`, `agents/agent.ts`, `tools/schedule-tools.ts` into this repo by hand, keeping our own `AGENTS.md`/`README.md`/`.env.example`. Left `@mastra/duckdb` and `@mastra/observability` (not in `10-SETUP.md`'s list) in `package.json` rather than stripping them, since the scaffold's `index.ts` uses them for its default trace storage and P0.2 only mandates removing `xlsx`/`danfojs-node`.
**Over:** Waiting on upstream to fix `.` support, or hand-authoring the scaffold files from scratch.
**Because:** The docs assumed an older CLI behavior; the merge-from-temp-dir approach gets an identical result without blocking on a tool bug. Removing the observability packages now would also require rewriting `index.ts`'s storage wiring before Phase 1 needs to touch it anyway.
**Cost:** Two unlisted deps (`@mastra/duckdb`, `@mastra/observability`) and their `MastraCompositeStore`/`DuckDBStore` wiring sit in `index.ts` until Phase 1 replaces the example agent; if we don't want Mastra's built-in observability storage on DuckDB, that's a manual removal later, not automatic.

## D-09 LibSQL DATABASE_URL resolved against INIT_CWD, not process.cwd()
22 Sep 2026, wiring LibSQLStore in src/mastra/index.ts for P1.3.
**Chose:** Resolve a relative `file:` DATABASE_URL against `process.env.INIT_CWD` (npm's original invocation directory), falling back to `process.cwd()`.
**Over:** Passing `process.env.DATABASE_URL` straight through to `LibSQLStore`, as `.env.example` and the build plan describe it.
**Because:** `mastra dev` runs the bundled server with its working directory set to `src/mastra/public`, not the project root, so a bare relative path silently opened (or tried to create) the database in the wrong folder and crashed with `ConnectionFailed`. `INIT_CWD` is the one thing npm guarantees points back at the project root regardless of where the bundler chdirs to.
**Cost:** One extra path-resolution helper in `index.ts`; anyone running the bundled output outside of `npm run` (a raw `node .mastra/output/index.mjs`) needs `INIT_CWD` set manually or an absolute `DATABASE_URL`.

## D-10 Replaced the scaffolded placeholder agent and dropped schedule-tools.ts
22 Sep 2026, P1.3, fitting the scaffold's example agent to this project.
**Chose:** A minimal `Agent` with no tools beyond memory, using `MODELS.ANALYST`. Deleted `src/mastra/tools/schedule-tools.ts` entirely.
**Over:** Keeping the scaffold's generated agent, which used a `LocalSandbox` workspace and a `start_schedule`/`stop_schedule` tool pair.
**Because:** AGENTS.md's "Out of scope" list and architecture decision D-02 both rule out arbitrary code execution or sandboxes; the scaffolded agent's `LocalSandbox` directly contradicted that. `schedule-tools.ts` also `throw`s inside `execute()` instead of returning a `ToolResult`, violating rule 5, and recurring schedules are not part of the nine specified modules.
**Cost:** None of the scaffold's demo capabilities (weather, stock price, scheduling) survive as a smoke test; Studio now only proves the agent responds, which is all P1.3 asks for.

## D-11 Installed puppeteer in Phase 1 to build the sample brief PDF
22 Sep 2026, P1.5, generating samples/northwind-brief.pdf.
**Chose:** Install `puppeteer` now and use it via `scripts/make-brief-pdf.ts` (a hand-rolled markdown-to-HTML converter for the brief's small, fixed markdown subset, then `page.pdf()`), rather than a new markdown-to-PDF dependency.
**Over:** Waiting until Phase 6's `renderPdf.ts`, or pulling in a dedicated markdown-to-PDF package for this one file.
**Because:** `puppeteer` is already the approved, locked-in choice for `renderPdf` in `docs/06-RESEARCH-STACK.md` section 2.7 and listed as optional in `10-SETUP.md`; using it now instead of a new dependency keeps the dependency set exactly as specified, and the HTML template this script builds is the same shape `renderPdf.ts` will reuse in Phase 6.
**Cost:** Chromium's download (~300MB) now happens during Phase 1 setup instead of Phase 6; `esbuild` and `puppeteer` postinstall scripts both needed explicit `npm approve-scripts` approval, which anyone cloning the repo will hit too and should be noted in `10-SETUP.md` before submission.

## D-12 Added vitest.config.ts to resolve the `@/*` alias for value imports
22 Sep 2026, P2.1, `src/modules/sources/detectType.ts` importing `ok`/`fail` from the reliability module.
**Chose:** A `vitest.config.ts` with `resolve.alias` mapping `@` to `src`, mirroring tsconfig's `paths`.
**Over:** Using relative imports (`../reliability`) for cross-module value imports instead.
**Because:** `@/types` appeared to work in Phase 1 only because those were `import type` statements, which esbuild elides before module resolution runs; the first real value import across module boundaries (`@/modules/reliability`) failed at runtime with "Cannot find package". Aliasing in Vitest keeps the `@/*` convention AGENTS.md's directory map implies usable everywhere, not just in type positions.
**Cost:** One more config file; anyone adding a new top-level bundler entry point (not just `mastra dev`/`vitest`) needs the same alias wired for it too.

## D-13 query() locks external access on first use instead of requiring a manual step
22 Sep 2026, P2.2, `src/modules/analysis/session.ts` and `query.ts`.
**Chose:** `query()`, the only agent-facing execution path, calls `disableExternalAccess()` itself the first time it runs on a session, if nobody already did. `registerFile` refuses to run once a session is locked, since `enable_external_access` cannot be re-enabled once off.
**Over:** Requiring the ingestion pipeline to remember to call `disableExternalAccess()` after "the last file" before handing the session to the agent.
**Because:** "The last file" has no clean definition when uploads can arrive at any point in a conversation; a manual step is a footgun one missed call away from leaving external access open while untrusted, model-generated SQL runs. Locking automatically on first query makes the invariant true by construction: no query ever executes with file/network access enabled.
**Cost:** A file uploaded after the first query has already run in a session cannot be registered into that same DuckDB instance (registerFile now fails cleanly with QUERY_INVALID rather than crashing). Scenario A's demo flow (upload everything, then ask questions) is unaffected; a genuinely mid-conversation late upload would need a fresh session or a Node-side row-insert path instead of registerFile, which is out of scope for this phase.

## D-14 Evidence ledger persists via the raw @libsql/client driver, not @mastra/libsql
22 Sep 2026, P2.6, `src/modules/evidence/ledger.ts`.
**Chose:** Added `@libsql/client` (already present transitively through `@mastra/libsql`) as a direct dependency, and used its plain `createClient`/`execute` API to read and write the ledger's `evidence`/`findings`/`ledger_counters` tables, each row a JSON blob keyed by id.
**Over:** Using `@mastra/libsql`'s `LibSQLStore`, or giving the evidence module a Mastra storage instance passed in from `src/mastra/`.
**Because:** AGENTS.md requires `src/modules/*` to stay free of Mastra imports so it is testable without an API key or a running Mastra instance; `@libsql/client` is the underlying, framework-agnostic SQLite-compatible driver, not a Mastra package, so it satisfies that rule while still writing to the one LibSQL file docs/06-RESEARCH-STACK.md commits memory, vectors and evidence to. A JSON-blob-per-row schema avoids hand-mapping every `Evidence`/`Finding` field to a column for a store whose access pattern is "fetch by id list" and "scan for a topic match", not relational querying.
**Cost:** No SQL-level querying of evidence/finding fields (e.g. "all evidence with confidence=low") without loading and filtering in Node; acceptable at the scale one conversation's ledger reaches. `gatherFor` does a full table scan over findings, fine at this scale but would need an index or a real query if findings ever numbered in the thousands.

## D-15 A single process-wide DuckDB session stands in for per-conversation sessions
22 Sep 2026, P2.7, `src/mastra/tools/analysis.ts`.
**Chose:** One shared DuckDB session, source registry and evidence ledger, created lazily on the Data Analyst's first tool call, auto-loading `samples/campaigns.xlsx` if present.
**Over:** Building real per-conversation session scoping now.
**Because:** M8 (the session manifest, Phase 5) and the chat UI's real upload flow (Phase 7) do not exist yet, but P2.7 needs something queryable in Mastra Studio today to verify the agent end to end. A shared session is the smallest thing that makes `describe_dataset` -> `run_sql` -> `record_evidence` demonstrably work without building session infrastructure out of order.
**Cost:** Not multi-tenant and not conversation-scoped: every Studio session currently shares one DuckDB instance and one evidence ledger. This is explicitly temporary and must be replaced when M8 lands, not extended.

## D-16 Added a fifth tool, record_evidence, beyond the four named in 04-MODULES.md
22 Sep 2026, P2.7, `src/mastra/tools/analysis.ts` and `dataAnalyst.ts`.
**Chose:** A `record_evidence` tool wrapping `EvidenceLedger.addEvidence`, which the agent's instructions require it to call for every number before citing it.
**Over:** Relying on instructions alone for "every result becomes an Evidence entry" (the literal wording of P2.7's rule 4), with no mechanical enforcement.
**Because:** `run_sql` and `compute_stats` return whole result sets, not single facts, so auto-logging every tool call as one Evidence entry does not fit Evidence's one-fact shape; only the agent knows which specific number from a result set is worth citing. The real `SpecialistTask`/`SpecialistResult` contract (Phase 5, P5.2) will likely absorb this into a structured return value instead of a tool call, but that contract does not exist yet, and D-05 already established that instructions alone are not enforcement for this system.
**Cost:** A fifth tool not listed in the architecture doc's table for M7; worth reconciling with contracts.ts in Phase 5 rather than carrying both mechanisms forward.

## D-17 Grounding audit fixes: exception safety, evidence re-verification, init retry
22 Sep 2026, P2.7 wrap-up, following a code-reviewer subagent audit against AGENTS.md's five rules.
**Chose:** Three fixes. (1) Extended try/catch in `session.ts` `registerFile` and `describe.ts` to cover every DuckDB call, not just the first; added a `safe()` wrapper around every Mastra tool's `execute` in `src/mastra/tools/analysis.ts`, and an outer try/catch around `ingest.ts`'s fire-and-forget background task, so nothing throws past a tool or a background promise. (2) `record_evidence` now re-runs its own `sql` against DuckDB and uses the actually-returned value when the query yields exactly one row and one column, instead of trusting the model's transcription of an earlier result. (3) `getRuntime()`'s cached session promise resets to `null` on rejection instead of permanently caching a rejected promise.
**Over:** Leaving these as found and noting them as future work.
**Because:** The audit found concrete, non-hypothetical throw paths (an odd column type, a locked db file, a file deleted mid-upload) that would reach the agent loop and violate rule 5 directly, one path where a rejected init promise would permanently break every tool call for the rest of a live demo, and one path where a model could stamp an unverified number as high-confidence "computed" evidence, which is exactly the estimation rule 1 exists to prevent.
**Cost:** `record_evidence` now runs its SQL twice (once via `run_sql`, once again inside `record_evidence`) for the common single-scalar case; acceptable for correctness at this scale. Multi-row/multi-column evidence claims still cannot be mechanically re-verified and rely on the agent's instructions, a known gap to close when Phase 5's `SpecialistResult` contract exists.

---

<!-- Append new decisions below as you make them. -->
