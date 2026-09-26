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

## D-18 Cast mammoth to a local type instead of `any`, for its untyped convertToMarkdown
23 Sep 2026, P3.1, `src/modules/documents/toMarkdown.ts`.
**Chose:** A local `MammothWithMarkdown` type intersecting `typeof mammoth` with the `convertToMarkdown` signature, cast once at import time.
**Over:** `(mammoth as any).convertToMarkdown(...)`, or downgrading to `@types/mammoth`-free JS for this one call.
**Because:** mammoth 1.12.3's bundled `.d.ts` still only declares `convertToHtml`/`extractRawText`/`embedStyleMap` even though `lib/index.js` exports `convertToMarkdown` at runtime; AGENTS.md requires `any` to carry a comment explaining why, and a one-line local type is no more code than that comment while keeping the call itself checked.
**Cost:** If a future mammoth release changes `convertToMarkdown`'s real signature, this local type will not catch the mismatch; worth revisiting if mammoth ships proper types for it.

## D-19 PDF page text from extractTextItems' hasEOL, not a positional line-grouping pass
23 Sep 2026, P3.1, `src/modules/documents/toMarkdown.ts`.
**Chose:** Join each page's `StructuredTextItem[]` in order, inserting a newline on `hasEOL` and a single space otherwise.
**Over:** Reconstructing lines from `x`/`y` coordinates (grouping items whose `y` falls within one line height, sorting by `x`), which the promptbook's "use extractTextItems so you have positions" phrasing gestures at.
**Because:** pdf.js already emits items in reading order with `hasEOL` marking real line breaks; for this system's job (citeable page-scoped text, not layout-faithful reconstruction) that is sufficient and verified correct against the actual sample brief. Positional grouping would matter for multi-column layouts, which the brief does not have.
**Cost:** A genuinely multi-column PDF would interleave columns instead of reading one column at a time; not a case in the demo scenarios, so not built now.

## D-20 Redrew the brief's PDF table grids as SVG strokes, since CSS borders don't produce vector strokes
23 Sep 2026, P3.2, `scripts/make-brief-pdf.ts`.
**Chose:** After `page.setContent`, run a `page.evaluate` pass that measures each `<table>`'s real cell boundaries and draws the grid as an SVG `<line>` overlay (`stroke="#999"`), with the CSS `th`/`td` borders removed entirely.
**Over:** Leaving the original CSS `border: 1px solid` table styling, which is how `samples/northwind-brief.pdf` was generated through P1.5 and P3.1.
**Because:** `pdf-parse` v2's `getTable()` only scans each page's operator list for `OPS.stroke` paths (`PDFParse.js` `getPageTables`); Chromium's print-to-PDF renders CSS table borders as filled rectangles, not stroked vector paths, so `getTable()` found zero tables against the original PDF even though the visual grid was clearly there. Confirmed by generating a minimal test PDF with an SVG-drawn grid, which `getTable()` detected correctly. The fix regenerates the same visual table from the same markdown source, only changing how the grid is painted.
**Cost:** `scripts/make-brief-pdf.ts` now measures DOM layout via `page.evaluate` before printing, which is more fragile than plain CSS if the brief's markdown or page styling changes shape (a table that wraps differently could shift cell rects before the overlay is drawn); acceptable because the script only ever serves this one fixture.

## D-21 registerRows: a column becomes numeric only when every cell yields a number
23 Sep 2026, P3.2, `src/modules/analysis/registerRows.ts`.
**Chose:** For a table extracted from a document, a column is registered as DuckDB `DOUBLE` only if every data cell contains an extractable number after stripping `$`, `~` and `%` ("$299/mo" -> 299); a single non-numeric cell ("Custom") falls the whole column back to `VARCHAR`, keeping the original text rather than emitting `NULL`.
**Over:** A coverage threshold that tolerates some non-numeric cells as `NULL` in an otherwise-numeric column (the same tolerance `detectQualityIssues` already applies to uploaded spreadsheets), or leaving every extracted-table column as text and requiring the agent to `TRY_CAST` in SQL.
**Because:** Business PDF tables mix genuine numbers with qualitative cells ("Custom", "Below blended average") in the same column; an all-or-nothing rule keeps the type honest, at the cost of one legitimate case, "Custom, up to 5 years" -> 5, quietly reading only the first number, an approximation of the same class this system already accepts elsewhere (D-16's evidence re-verification, the small-sample warnings) rather than a new gap.
**Cost:** A column that is genuinely numeric except for one clearly-N/A row (Northwind's own "Tracked users included" column: "Up to 50,000", "Up to 250,000", "Custom") stays text and cannot be summed directly; querying it requires a `TRY_CAST`/regex extraction in SQL, same as any other messy text column.

## D-22 A one-time pdf-parse warm-up call before unpdf ever touches a PDF
23 Sep 2026, P3.3, `src/modules/documents/pdfWarmup.ts`, called from `toMarkdown.ts`.
**Chose:** Before `toMarkdownPdf` calls unpdf's `getDocumentProxy`, it runs `warmUpPdfJs()`, a memoized (process-lifetime, once-only) lightweight `pdf-parse` `getInfo()` call on whatever buffer arrives first.
**Over:** Picking one PDF library for both text and table extraction (dropping either unpdf or pdf-parse), or scoping the two calls to separate worker processes.
**Because:** `unpdf` and `pdf-parse` each bundle their own pdf.js and register a shared Node "fake worker" global the first time either one actually parses a document; whichever wins that race pins the process to its own pdf.js API/Worker version pair for every later call from *either* library. Reproduced directly: wiring P3.2's table extraction into P3.3's ingest pipeline made `extractTablesFromPdf` fail with `"The API version 5.4.296 does not match the Worker version 6.1.200"` whenever it ran after `toMarkdown` had already converted the same PDF in-process, and confirmed with isolated scripts that pdf-parse running first (via a full `getTable()` or even just `getInfo()`) avoids the conflict for the rest of the process regardless of call order afterward. A tiny, self-contained warm-up in the one place unpdf is invoked is less invasive than replacing either library, matches the doc already choosing both per docs/06-RESEARCH-STACK.md section 2.6, and needed no change to P3.1's already-tested `toMarkdown` behavior.
**Cost:** The very first PDF touched in a process pays for one extra lightweight parse (`getInfo()` on that same buffer) before its real work starts; negligible, and only happens once per process, not once per file. If a future pdf-parse or unpdf upgrade changes which side wins the race, this warm-up may become unnecessary or insufficient and should be re-verified against `docs/DECISIONS.md`'s own test scripts' reasoning here rather than assumed still correct.

## D-23 detectProposedTasks: a two-part heuristic (list shape + ask ratio), no model
23 Sep 2026, P3.5, `src/modules/sources/proposedTasks.ts`.
**Chose:** Group consecutive numbered/bulleted lines into items (folding wrapped continuation lines, closing on a blank line), then treat the document as a requirements list only when there are at least 2 items AND at least half of them contain a `?` or open with a short imperative-verb whitelist ("provide", "list", "describe", ...). Deliberately excludes verbs an injection attempt would likely use ("ignore", "delete", "reveal", "execute") from that whitelist — not a security control (the real control is that the function only ever returns plain strings with no execution path), just keeps the "imperative ask" signal meaningful rather than accidentally making injection-shaped text more likely to pass the list-detection bar.
**Over:** A model call to classify "is this a requirements document", which the M1 pipeline explicitly avoids per AGENTS.md rule 1 (this is detection, not a number, but the module's whole job is staying testable without an API key) and rule 4 (file content is data; running it through a model at all is a needless injection surface for zero benefit over a regex).
**Because:** `samples/research-requirements.txt` and ordinary documents (prose, tables, plain numbered lists like a shopping list) are cleanly separable by list-shape plus ask-ratio alone; a false negative on a genuinely ambiguous document just means the user doesn't get the "want me to answer these?" prompt, which is a fine failure mode (docs/PROMPTBOOK.md's stated philosophy: a borderline miss is acceptable, the clean case must work).
**Cost:** No confidence score, just a boolean-shaped in/out; a document that mixes a real question list with unrelated bulleted prose earlier in the file could under- or over-extract depending on exact spacing. Not tuned against anything beyond the one real sample fixture plus a handful of synthetic negatives.

## D-24 Swapped both Groq model tiers: this project's Groq account no longer has the originally planned models
23 Sep 2026, P3.4, `src/mastra/models.ts`.
**Chose:** `MODELS.ROUTER` -> `groq/openai/gpt-oss-120b`, `MODELS.RERANK` -> `groq/openai/gpt-oss-20b`.
**Over:** The originally planned `groq/llama-3.3-70b-versatile` (ROUTER) and `groq/llama-3.1-8b-instant` (RERANK) from docs/04-MODULES.md M7.
**Because:** Building P3.4's rerank path surfaced a live `404 model_not_found` from Groq for both original models; querying `GET https://api.groq.com/openai/v1/models` directly with this project's `GROQ_API_KEY` confirmed the account's catalog has 11 models total, none of them `llama-3.3-70b-versatile` or `llama-3.1-8b-instant` — Groq's free-tier lineup moved on since docs/06-RESEARCH-STACK.md was written. `openai/gpt-oss-120b` and `openai/gpt-oss-20b` are both in the live catalog and match the original tiers' size/speed intent (large-and-capable for routing, small-and-fast for reranking). Confirmed fixed: the P3.4 live integration test's rerank step, which previously could only assert "NETWORK or success" because the model didn't exist, now runs the real rerank call.
**Cost:** Neither new model has been evaluated for routing/reranking quality the way the original choices presumably were when the stack doc was written; if intent classification or rerank quality looks off later, this pairing is the first place to look. `docs/06-RESEARCH-STACK.md` section on model choice is now stale on this point and should be corrected before the README leans on it for the trade-offs section.

## D-25 rag.ts: chunk text stored as vector metadata, embedding dimension read at runtime
23 Sep 2026, P3.4, `src/modules/documents/rag.ts`.
**Chose:** Store the chunk's own text as a `text` field inside the vector store's metadata (not in docs/04-MODULES.md M3's stated metadata list), and create the LibSQL vector index with `dimension: embeddings[0].length` from the actual `embedMany()` result rather than a hardcoded constant.
**Over:** Keeping metadata to exactly the M3 list and looking the chunk body up by id afterward; hardcoding `768` from `@mastra/core`'s own `EMBEDDING_MODELS` table for `google/gemini-embedding-001`.
**Because:** `LibSQLVector.query()` returns metadata only, never the original chunk body, so `search()` has no other way to return citeable text without a second lookup round trip. On the dimension: the live Gemini API returns 3072-dimensional vectors by default for this model (a Matryoshka embedding; 768 is only what comes back if truncation is explicitly requested via `providerOptions`), so trusting the static table produced a real `Vector dimension mismatch` against `createIndex()`. Reading the dimension from what the API actually returned is correct regardless of which embedding model this project uses later.
**Cost:** One extra, non-spec field riding along on every stored chunk (`text`), which duplicates the source markdown on disk; acceptable at this project's scale, and the pattern (trust the live response, not a client library's static model table) is worth remembering for any other embedding model swapped in later.

## D-26 rag.ts duplicates D-09's DATABASE_URL resolution rather than importing it
23 Sep 2026, P3.4, `src/modules/documents/rag.ts`.
**Chose:** Reimplemented the same `INIT_CWD`-relative `file:` URL resolution `src/mastra/index.ts` uses (D-09), inline in `rag.ts`, instead of importing it from there.
**Over:** Exporting the resolver from `src/mastra/index.ts` and importing it into `src/modules/documents/`.
**Because:** `src/mastra/index.ts` constructs the whole `Mastra` instance (every agent, the DuckDB store, observability) as an import-time side effect; importing anything from that file into a `src/modules/*` file would drag the entire app into this module's import graph just to reuse about eleven lines of path math, risking circular imports or double-initialization once tools wire this module in during P3.6.
**Cost:** Two copies of the same eleven lines to keep in sync if the resolution logic ever changes (e.g. a different env var, a different fallback). Worth extracting into a small shared, Mastra-free utility (e.g. `src/modules/reliability/` or a new `src/modules/env/`) if a third caller ever needs the same logic.

## D-27 Document agent gets its own D-15-style shared runtime, not a shared one with the Data Analyst
23 Sep 2026, P3.6, `src/mastra/tools/documents.ts`.
**Chose:** A second, independent lazy singleton (own DuckDB session `'phase3-document-shared-session'`, own `SourceRegistry`), auto-ingesting `samples/northwind-brief.pdf` and `samples/customer-notes.docx` on first tool call, structurally identical to D-15's stand-in in `analysis.ts` (including the "do not cache a rejected promise" fix) but not the same instance.
**Over:** Extracting D-15's shared-runtime pattern into one common singleton both `analysis.ts` and `documents.ts` import, so every agent sees the same set of loaded sources.
**Because:** A real shared session (one registry every agent and tool reads, sources uploaded once and visible everywhere) is exactly M8's job (the session manifest, Phase 5) — building a partial version of it now, ad hoc, in two tool files, would be the kind of thing that has to be half-undone when M8 lands properly. Each agent already needs *something* concrete to answer against in Studio before Phase 5 exists, so two independent D-15-style stand-ins, done the same way both times, is the smallest correct step, not a design decision on M8 itself.
**Cost:** In Mastra Studio today, a source uploaded through the Data Analyst is invisible to the Document agent and vice versa; each only ever sees its own two hardcoded sample files until Phase 5 unifies them. Not a functional gap in what's graded yet (nothing depends on cross-agent source sharing before Phase 5), but worth remembering so it isn't mistaken for a bug during a live demo before Phase 5 lands.

## D-28 ingest() widened to a discriminated union, and its document tail extracted for reuse by the web path
23 Sep 2026, P4.2, `src/modules/sources/ingest.ts`.
**Chose:** `ingest(session, registry, input: { path: string } | { url: string })`, a discriminated union rather than docs/04-MODULES.md M1's literal `{ path?: string; url?: string }`. The second half of what was `runDocumentIngestion` (store markdown, count tokens, route, index if 'indexed', detect proposed tasks, build the Source and card, rebalance) is now a shared `finishDocumentIngestion`, called by both the file path (after `toMarkdown` + table extraction) and a new `runUrlIngestion` (after `readPage` + `formatWebMarker`).
**Over:** Two optional fields on one object (as the module spec literally shows), and duplicating the store/route/index/rebalance tail in a separate function for URLs.
**Because:** A discriminated union makes "neither path nor url" and "both path and url" unrepresentable instead of a runtime check, and every existing `{ path }` call site needed zero changes. Extracting the shared tail means the RAG-indexing wiring, the rebalance logic and the proposed-tasks detection only exist once; a PDF and a scraped web page now provably go through identical routing and indexing logic past the point where they produce markdown, which is the whole "one pipeline, two entry points" point of docs/03-ARCHITECTURE.md 3.6.
**Cost:** A URL re-fetch has no content-hash dedup the way a re-uploaded file does (a URL's content isn't guaranteed stable across fetches, so `findByHash` doesn't apply); the per-session `UrlCache` in the research module is the intended de-dup point for a repeated `read_page`/`crawl_site` call within one conversation instead.

## D-29 search() falls through to Tavily on any Exa failure, not only quota-shaped ones
23 Sep 2026, P4.1, `src/modules/research/search.ts`.
**Chose:** Any error from Exa (network blip, malformed response, quota, anything) triggers the Tavily fallback; only if both providers fail does `search()` return `SEARCH_QUOTA`.
**Over:** Fallback gated strictly on a recognisably quota/rate-limit-shaped Exa error, per docs/04-MODULES.md M4's literal "on the primary returning a quota error, fall through."
**Because:** docs/06-RESEARCH-STACK.md's own stated reasoning for layered fallbacks is "a demo that dies on a rate limit is a bad demo" — a transient Exa hiccup that isn't specifically quota-shaped would otherwise sink a search the user is watching live, for no benefit. `SEARCH_QUOTA` is the only `ErrorCode` this system has for "no search result is available right now," so it is also what a genuine total failure of both providers reports, regardless of whether the underlying cause was two quota hits, two network failures, or missing keys.
**Cost:** A one-off, recoverable Exa error and Exa being genuinely out of quota are no longer distinguishable to the caller; both look identical (a successful Tavily fallback, or `SEARCH_QUOTA` if Tavily also fails). Acceptable since the agent's only correct response to either is the same: keep going on Tavily, or report the gap.

## D-30 ReferenceResolution matches findings and artifacts, not only sources
24 Sep 2026, P5.1, `src/modules/session/reference.ts`.
**Chose:** `ReferenceResolution`'s `match` variant covers `sourceId | findingId | artifactId`, beyond the prompt's own sketch (which only showed a source match).
**Over:** Sticking to the literal sketch and leaving "this finding" / "the deck" unresolved.
**Because:** M8's own stated job ("now compare it with the other one") and its own examples ("the deck") plainly need findings and artifacts resolved the same way sources are; the manifest already holds all three, so limiting resolution to one of them would leave an obvious, easy-to-hit gap.
**Cost:** Three match shapes for callers to switch on instead of one; acceptable, since every caller already has to handle `ambiguous`/`none` regardless.

## D-31 manifestStore hand-rolls a LibSQL table instead of using Mastra's working-memory API
24 Sep 2026, P5.1, `src/mastra/session/manifestStore.ts`.
**Chose:** A small `session_manifest` table via `@libsql/client` directly, mirroring `openLedger`'s own pattern against the same `DATABASE_URL`.
**Over:** `@mastra/memory`'s `Memory.getWorkingMemory`/`updateWorkingMemory`, which exists and is documented for exactly this kind of per-thread state.
**Because:** that API only works bound to a live `Memory` instance and a threadId/resourceId/memoryConfig, which would pull this thin "read/write one JSON blob keyed by session id" adapter into the full agent memory wiring for no benefit; the evidence ledger already solves the identical problem the identical way against the same file.
**Cost:** Two independent small LibSQL tables (evidence ledger, session manifest) instead of one memory subsystem; both are simple enough that this hasn't been a real cost so far.

## D-32 delegate() uses Mastra's `structuredOutput`, not `experimental_output`
24 Sep 2026, P5.2, `src/mastra/agents/contracts.ts`.
**Chose:** `agent.generate(prompt, { structuredOutput: { schema } })` for every specialist call.
**Over:** `experimental_output`, the older AI SDK v4 structured-output path some Mastra examples still show.
**Because:** this installed `@mastra/core` version's `AgentGenerateOptions.output` is documented "does not work with tools," and every specialist here reaches its answer through tools first; `structuredOutput` is the option the installed `Agent.generate()` overloads type as compatible with a tool-calling loop (confirmed directly against `node_modules/@mastra/core/dist/agent/agent.d.ts`, no repo precedent existed to grep for).
**Cost:** None found; this is the one option that actually works for a tool-calling specialist in this dependency version, not a trade-off between two working choices.

## D-33 Orchestration logic lives in plain, directly-tested code; agent instructions restate it, they don't define it
24 Sep 2026, P5.3-P5.6, `src/mastra/agents/orchestrator.ts`.
**Chose:** Every rule that must hold regardless of what the model does — intent-to-specialist routing, the pending-source guard, parallel/sequential mode, which evidence becomes `knownFacts`, the plan shape, conflict detection — is a pure, synchronous, unit-tested TypeScript function (`decideAction`, `checkSourcesReady`, `decideDelegationMode`, `gatherKnownFactsForData`, `buildPlan`). The orchestrator's prompt describes these mechanisms so the model narrates them sensibly; it does not rely on the model to implement them.
**Over:** Encoding the nine (now ten) rules as prose instructions only, and trusting the model to apply them consistently turn after turn.
**Because:** this mirrors the project's own rule 1 one level up — arithmetic goes through DuckDB, not the model's head, because a model is unreliable at exactly the kind of thing that must hold every time; orchestration policy (never delegate to a pending source, never skip a gap, run independent work in parallel) is the same category of "must always be true," so it gets the same treatment.
**Cost:** More code to maintain in `orchestrator.ts` than a prompt-only design would have, and every new orchestration rule needs a function plus a test, not just a paragraph. Worth it: this is what makes P5.3-P5.6's "Done when" bars testable without a live model at all.

## D-34 Sequential-vs-parallel delegation decided by a keyword heuristic, not a second model call
24 Sep 2026, P5.4, `src/mastra/agents/orchestrator.ts`.
**Chose:** `decideDelegationMode` matches a short literal dependency-language list ("then", "based on what", "after that", ...) against the raw request text, word-boundary regex, fully deterministic.
**Over:** A second cheap classifier call (MODELS.ROUTER) asking "is this sequential or parallel."
**Because:** consistent with D-33: the promptbook's own two worked examples plus a handful of obvious variants are all this needs to resolve correctly, and a second model round-trip for a narrow binary decision would trade determinism and test speed for no real gain.
**Cost:** A genuinely novel phrasing with no matching marker word defaults to parallel even if a human would read it as sequential; acceptable given the two specialists still run (just not ordered), each reports its own gap honestly, and this is easy to extend with more markers if the demo ever hits a miss.

## D-35 Evidence-conditioned queries (`knownFacts`) are gathered for the Data Analyst only
24 Sep 2026, P5.5, `src/mastra/agents/orchestrator.ts`.
**Chose:** `gatherKnownFactsForData` pulls every evidence id cited by a `Finding` already in the manifest and attaches it to the Data Analyst's task specifically (both the parallel and P5.4 sequential paths); Document and Research tasks never receive this.
**Over:** Gathering and attaching relevant evidence generically for every specialist.
**Because:** docs/03-ARCHITECTURE.md's own framing of the mechanism is specifically "the orchestrator passes document derived facts into the Data Analyst's task as `knownFacts`, and the analyst turns them into query constraints" — a document fact reshaping a SQL `WHERE` clause is the concrete failure mode this closes; Document and Research specialists don't consume incoming facts the same way (they search text/web, they don't build filtered queries from a fact list).
**Cost:** If a future specialist needed the same treatment, this function's name and scoping would need generalising; not needed yet.

## D-36 Conflict detection scoped to this turn's gathered evidence, not the whole session
24 Sep 2026, P5.6, `src/mastra/agents/orchestrator.ts`.
**Chose:** `detectConflicts` runs only over evidence returned by this turn's delegations (`outcomes`), never the full evidence ledger history.
**Over:** Running it over every evidence entry ever recorded in the session.
**Because:** a conflict worth surfacing right now is one relevant to what was just asked; a stale disagreement from an unrelated earlier turn would be noise in the answer rather than a useful flag.
**Cost:** A conflict that exists in the ledger but wasn't touched by this turn's delegation stays silent until a later turn's delegation happens to re-surface both sides; acceptable since nothing is lost, it just isn't proactively raised.

## D-37 Gzip/decompression live-API failure fixed at the fetch layer, not by patching a dependency
25 Sep 2026, P5.7, `src/mastra/models.ts`.
**Chose:** A scoped `globalThis.fetch` patch, installed once as `models.ts`'s own import-time side effect, forcing `Accept-Encoding: identity` on requests to `generativelanguage.googleapis.com` and `api.groq.com` only.
**Over:** Patching or version-bumping `@mastra/core`/`ai`/`@ai-sdk/google`, or working around it per-call.
**Because:** live tracing (P5.7) found `Agent.generate()`, called through Mastra's own streaming reader, throwing `AI_JSONParseError` on a `responseBody` that was still raw gzip (`1F 8B 08` magic bytes) with `responseHeaders: {}` — the response stream Mastra's reader consumed had never been handed through undici's transparent gunzip. This reproduced across the whole live orchestrator regardless of which internal SDK version built the request, so the only version-agnostic fix point was the raw HTTP layer: if the server is never asked to compress the response, there is nothing to fail to un-gzip. Confirmed fixed against many repeated live round trips.
**Cost:** One more piece of global, load-order-sensitive state (a patched `globalThis.fetch`); scoped to exactly two hostnames and made idempotent to limit the blast radius. This had blocked every live verification attempt since Phase 4; worth flagging as the single highest-value fix in the whole project so far.

## D-38 `jsonPromptInjection: true` on every specialist's structured output call
25 Sep 2026, P5.7, `src/mastra/agents/contracts.ts`.
**Chose:** `structuredOutput: { schema, jsonPromptInjection: true }` in `delegate()`.
**Over:** Leaving `structuredOutput` at its default (native `response_format`), or a Gemini-specific branch only applied when the model tier is Gemini.
**Because:** live P5.7 verification hit a deterministic (not intermittent) Gemini `400`: "Function calling with a response mime type: 'application/json' is unsupported," root-caused to `@ai-sdk/google` setting `responseMimeType` unconditionally whenever JSON structured output is requested, with no guard for `tools` also being present. Every specialist here always has both tools and `structuredOutput` set together, every call — this was a 100%-reproducing block on all specialist delegation. `jsonPromptInjection: true` is `@mastra/core`'s own documented option for this exact situation: it prompts for JSON via a system-message instruction instead of the native mechanism, so the conflicting field is never sent.
**Cost:** Structured output now depends on the model actually following a prompt instruction rather than a server-enforced response format, in principle a softer guarantee; `SpecialistResultSchema.safeParse` still validates every result and `delegate()` still rejects a malformed one, so this doesn't weaken the anti-hallucination validation, only the mechanism that produces well-formed JSON in the first place. **Not live-confirmed** (Gemini free-tier daily quota ran out mid-verification) — a single live `delegate()` call once quota resets would close this out.

## D-39 resolveReference prefers a filename match over a kind-keyword match when both fire
25 Sep 2026, P5.7, `src/modules/session/reference.ts`.
**Chose:** In `matchByNameOrKind`, a literal filename/title match now wins outright over a generic kind-keyword match (e.g. "brief" matching every prose-kind source via `SOURCE_KIND_KEYWORDS`); kind-keyword candidates are only used when no name match exists at all.
**Over:** Treating both signals as equally weighted candidates, which is what P5.1 originally shipped.
**Because:** live P5.7 verification, with `campaigns.xlsx` + `northwind-brief.pdf` + `customer-notes.docx` all loaded (the brief's own four-turn scenario), found `resolve_reference("the brief")` returning `ambiguous` between the pdf and the docx, since "brief" generically matches any prose source's kind keywords and drowned out the specific filename match. P5.1's own test suite never caught this because its one "the brief" test only ever loaded a single pdf source. A literal name match is objectively stronger evidence than a generic kind word.
**Cost:** None found against the existing 15 `reference.test.ts` cases (all still pass); this is a strict precedence fix, not a new heuristic, and a regression test now covers the three-source scenario that exposed it.

## D-40 Artifact workflow: steps 4+5 merged into one retry loop, step 6 is a precheck only
25 Sep 2026, P6.6, `src/mastra/workflows/artifactSteps.ts` and `artifact.ts`.
**Chose:** Two simplifications against docs/03-ARCHITECTURE.md 4.2's literal eight-step diagram. (1) Steps 4 ("author plan") and 5 ("validate") are one function, `authorAndValidate`, which loops author -> validate itself, feeding the specific errors from a failed attempt into the next `author()` call, and returns `{ok:false, errors, lastPlan}` after `maxAttempts` (default 2) so the Mastra step it backs can `suspend()`. (2) Step 6 ("render charts, in parallel") is `renderChartsPrecheck`, an early parallel failure check only: it renders every `ChartSpec` found in the plan via `Promise.all` purely to fail fast, and does not thread the resulting PNG buffers into step 7; `renderDocx`/`renderXlsx` still render their own chart images again internally.
**Over:** Two separate Mastra graph nodes for author/validate wired with a `dowhile`/`dountil` loop carrying attempt count and last-errors in workflow state; and reworking `renderDocx`/`renderXlsx`'s internals to accept pre-rendered chart buffers so step 6's output could be reused by step 7.
**Because:** the retry-with-specific-errors-fed-back behaviour is far simpler to get right and unit test as one plain function with a for-loop than as two graph nodes plus loop-control state (and it is exactly this plain function, not the graph, that carries almost all of this workflow's test coverage, per the house pattern D-33 already established). Reusing step 6's rendered buffers in step 7 would require reworking two already-tested renderers' internals for a one-time efficiency gain on artifacts with only a handful of charts each.
**Cost:** A chart that validates in the precheck but fails when `renderDocx`/`renderXlsx` render it again (a transient QuickChart hiccup between the two calls) is not impossible, only very unlikely; and every chart is rendered twice on the happy path, a real but small inefficiency at this project's scale.

## D-41 request_artifact always passes dataRows: [] until a live dataset is queryable
25 Sep 2026, P6.7, `src/mastra/agents/orchestrator.ts`.
**Chose:** `requestArtifactTool` always calls `artifactWorkflow` with `dataRows: []`, and appends an honest note to a completed workbook's `description` ("the Data sheet's rows were not attached this run, re-run once the underlying source is directly queryable") rather than leaving the gap unstated.
**Over:** Wiring the orchestrator to query DuckDB for real rows before calling the workflow, or silently shipping an empty Data sheet with no comment.
**Because:** AGENTS.md's own "things that will look wrong but are correct" list already states the orchestrator has no domain tools (rule: it cannot query DuckDB itself), and no code anywhere yet calls `addSource()`/exposes a queryable table against the orchestrator's own session manifest (the exact gap P5.7's own findings already named); building that wiring is Phase 7's chat-upload job, not P6.7's. Rule 6 (report gaps, never fill them) applies to this tool's own output the same way it applies to a specialist's.
**Cost:** Every workbook artifact generated through this build has an empty Data sheet regardless of what the user actually asked for; acceptable for this phase, since the limitation is surfaced to the user every time rather than hidden, and the fix is isolated to one call site (`dataRows: []`) once Phase 7 makes rows reachable.

## D-42 One shared DuckDB session/registry/ledger/manifest store, not one per tool file
25 Sep 2026, P7.1/P7.2, `src/mastra/runtime.ts`.
**Chose:** A single `getRuntime()` in a new `src/mastra/runtime.ts`, used by `tools/analysis.ts`, `tools/documents.ts`, and the new Next.js upload/manifest routes. It also mirrors every source into the session manifest (`ingestForSession`), and exposes `resolveSessionId(context)` reading `context.agent.threadId` so each browser conversation gets its own manifest.
**Over:** Leaving `analysis.ts` and `documents.ts`'s independent D-15 stand-ins (two separate in-memory DuckDB sessions, two separate registries) as they were.
**Because:** P5.7 and D-41 both named the same gap: nothing ever called `addSource()`, so `read_session_manifest` rendered an empty source list even with data loaded and queryable, and a file "uploaded" to one tool file's registry was invisible to the other's. This is the addSource() wiring Phase 7 owed; verified live (`/api/manifest` now shows real sources with real quality warnings after upload, previously impossible).
**Cost:** Every specialist and the chat UI now share one DuckDB session process-wide (still a single-session stand-in, matching AGENTS.md's "no user accounts" out-of-scope line); true per-conversation data isolation is not built, only per-conversation manifest/evidence-ledger session ids are.

## D-43 The Next.js app is its own npm project (`app/`), cross-imported via a path alias, not merged into the root package.json
25 Sep 2026, P7.1, `app/package.json`, `app/tsconfig.json`, root `package.json`.
**Chose:** `app/` keeps its own `package.json`/`tsconfig.json`/`node_modules` (from `assistant-ui create`'s minimal template), declared as an npm workspace of the root (`"workspaces": ["app"]`). Its tsconfig repoints `@/*` to `../src/*` (matching every `src/mastra`/`src/modules` file's own existing alias) and moves the scaffold's own components to `@ui/*` instead, rather than merging Next.js into the root `package.json` and expanding root `tsconfig.json`'s `include`.
**Over:** One unified `package.json`/`tsconfig.json` at the repo root running both Mastra and Next.js.
**Because:** the root project's `dev`/`build`/`start` scripts and `tsconfig.json` are load-bearing for every earlier phase's "Done when" (P0.1: `npm run dev` opens Mastra Studio); redefining them for Next would break that contract. A separate project keeps both halves' tooling (oxlint/tailwind vs mastra/vitest) from fighting over the same config files.
**Cost:** A real, initially-surprising failure mode: npm auto-installs peer dependencies, so `app/node_modules` got its own `@mastra/core@1.71.0` alongside the root's `1.68.0` — two distinct classes with the same name, `handleChatStream`'s Mastra type check failed with "`#private` refers to a different member." Fixed with `workspaces` + `npm dedupe` (hoists both to one shared copy); worth knowing if it recurs after any future `npm install` inside `app/` alone.

## D-44 Uploads stream as a raw request body, not multipart/form-data
25 Sep 2026, P7.2, `app/app/api/upload/route.ts`.
**Chose:** The client sends the file's raw bytes as the fetch `body` (`fetch('/api/upload?name=...', {method:'POST', body: file})`), with filename/threadId in the query string; the route pipes `Readable.fromWeb(req.body)` straight to `fs.createWriteStream` via `stream/promises.pipeline`, with a `Transform` enforcing `MAX_UPLOAD_MB` mid-stream as a backstop to the `Content-Length` precheck.
**Over:** A multipart/form-data upload parsed with `busboy`/`formidable`.
**Because:** P7.2 requires uploads to "stream to disk, never buffer into memory"; a raw body IS a single stream with no framing to parse, so it needs no new dependency at all (docs/06-RESEARCH-STACK.md has no multipart parser listed, and AGENTS.md requires appending a reason to add one). A `Content-Length` check before the stream starts, plus the same live check mid-stream, together give "a wrong file fails in a second" without ever holding the file in memory.
**Cost:** Only ever one file per request (no multi-file form fields); the Sources panel just calls the endpoint once per dropped file instead, which is what it does.

## D-45 `detectConflicts` also flags a qualitative claim against a computed number under the same metric key
25 Sep 2026, P7.3 handback + follow-up, `src/modules/evidence/conflicts.ts`, `src/mastra/tools/documents.ts`, `src/mastra/agents/documentAgent.ts`.
**Chose:** Two changes together. (1) `detectConflicts` now also surfaces a pair under the same metric name+scope where exactly one side is a number and the other is a non-empty string (previously: `typeof a.value !== 'number' || typeof b.value !== 'number'` skipped the pair entirely). (2) `documents.ts`'s `record_evidence` gained the `metric` field `analysis.ts`'s already had, and `documentAgent.ts` gained a rule telling it to set a metric key (matching the Data Analyst's own name/scope convention) whenever a document states or compares a specific, named quantity — recording the claim text as `value` when the document gives no figure, never a fabricated one.
**Over:** Leaving qualitative claims permanently uncomparable, or instructing the Document Agent to invent a percentage so two numbers could be compared.
**Because:** the P7.3 grounding-eval build found this live: `scripts/make-customer-notes.ts`'s own header comment says the planted "Paid Social is our strongest channel" note (no number in it) is supposed to exercise M5 conflict detection, and structurally it never could, on two independent counts (`documents.ts` had no way to attach a metric key at all, and even with one, the pre-existing numeric-only comparison would still skip it). Rule 1 (numbers are computed, never estimated) forbids fixing this by having the model invent a figure, so the fix is in the comparison itself: two claims about the same metric, one with a number and one without, disagreeing in *kind* is still something rule 10 needs to see, not something to skip like an unrelated prose claim (which never shares a metric key in the first place).
**Cost:** None found against the existing 5 `conflicts.test.ts` cases (all still pass); two new tests cover the added case and its empty-string edge.

## D-46 `unsupportedMessage` names the actual file when refusing a "email/send this" request against an existing artifact
25 Sep 2026, P7.4 handback + follow-up, `src/mastra/agents/orchestrator.ts`.
**Chose:** `decideAction`'s 4th (optional, defaulted `''`) parameter is now the raw request text; when it matches `/\b(email|send|mail)\b/i` AND the manifest already holds a completed artifact, `unsupportedMessage` returns "I cannot do that. What I can do is give you the file: "<title>" (<downloadUrl>)." instead of the generic capabilities list.
**Over:** Always returning the generic "I cannot do X, here is what I can do" message regardless of what "X" was.
**Because:** docs/08-DEMO-SCENARIOS.md Scenario C's exact wording for this case is "I cannot do that. What I can do is give you the file" — a materially more useful answer than the generic capabilities line whenever there is, in fact, a file to hand over. Found and specified (not applied, to avoid a concurrent edit conflict) by the P7.4 breakage-pass subagent; applied here.
**Cost:** None found; all 58 `orchestrator.test.ts` cases (including a new one for this path) pass, and the generic message is still the fallback for every other unsupported request and for a send-request with nothing built yet.

## D-47 `src/modules/documents/store.ts` resolves its save path against `INIT_CWD`, not a bare relative string
25 Sep 2026, P7.1 follow-up, `src/modules/documents/store.ts`.
**Chose:** `DOCUMENTS_DIR` is now `resolve(process.env.INIT_CWD || process.cwd(), process.env.DOCUMENTS_DIR || 'data/documents')`, the same pattern every `src/mastra/*` file already uses (D-09), applied here in a `src/modules/*` file for the first time.
**Over:** Leaving the bare `'data/documents'` relative string `saveMarkdown`/`getDocument` already used.
**Because:** live-caught while smoke-testing uploads through the Next.js dev server: this module had never needed the D-09 fix before, since every prior caller (`mastra dev`, vitest, `tsx` scripts) happened to run with `cwd` already at the project root. Running inside the Next.js process (`cwd` = `app/`) silently wrote every document to `app/data/documents/` instead — a second, wrong copy of the store, invisible to `mastra dev`/Studio, and a real bug this exact phase's own new caller exposed.
**Cost:** None; `getDocument`/`saveMarkdown`'s existing tests still pass, since they already ran with `cwd` at the project root.

## D-48 Gemini first, Groq as an automatic fallback, through Mastra's model fallback list
26 Sep 2026, interface upgrade, `src/mastra/models.ts`.
**Chose:** `MODELS.ANALYST` and `MODELS.WRITER` are ordered lists, `[{ model: 'google/gemini-2.5-flash', maxRetries: 0 }, { model: 'groq/openai/gpt-oss-120b', maxRetries: 1 }]`, which Mastra's `Agent` accepts in place of a single model id. Each LLM step runs against the first entry that answers; an error on Gemini (a free tier 429, a 503, a bad key) re-runs that same step on Groq. `ROUTER` and `RERANK` stay plain strings. `MODEL_FALLBACK=off` pins Gemini alone.
**Over:** A manual swap in `models.ts` whenever Gemini's quota runs out (what the 26 Sep smoke test had to do by hand), or a try/catch retry wrapper in the chat route.
**Because:** Gemini's free tier quota is per day, so once it is gone every turn fails until midnight Pacific; a fallback turns that from an outage into a slightly different model answering. Doing it per step inside Mastra's own loop means a turn that has already made three tool calls on Gemini continues on Groq instead of starting over, and every agent, the artifact author and the specialists get it for free through the tier. `maxRetries: 0` on Gemini is deliberate: a daily quota 429 does not clear on a retry. `RERANK` cannot be a list because `src/modules/documents/rag.ts` builds one `ModelRouterLanguageModel` from it. Verified live: with an invalid Gemini key, an agent on `MODELS.ANALYST` answered from `openai/gpt-oss-120b` in 0.7s.
**Cost:** Groq's free tier allows only 8,000 tokens per minute, so a long, tool heavy turn that falls back can hit Groq's own rate limit; the chat route's error message now says both providers are limited when that happens. Answers can differ in style between the two models within one conversation.

## D-49 The chat sidebar reads conversations straight out of Mastra Memory; the thread id is also the session id
26 Sep 2026, interface upgrade, `src/mastra/conversations.ts`, `app/app/api/conversations/`, `app/components/conversation-sidebar.tsx`.
**Chose:** No new history store. Every turn was already saved to the orchestrator's Mastra Memory (LibSQL) under `memory: { thread, resource }`; the sidebar lists those threads (`memory.listThreads`, newest first), reopening one loads them with `memory.recall` and converts them to AI SDK v7 UI messages (`toAISdkMessages`) that seed `useChatRuntime({ messages })`, so the conversation continues where it left off. Because the same id keys the session manifest and evidence ledger (`resolveSessionId`), reopening a chat also brings back its uploaded files and generated artifacts. The open chat lives in the URL (`?c=<id>`). Titles come from the user's first message (`deriveConversationTitle`, `src/modules/session/title.ts`), set when the chat route creates the thread.
**Over:** assistant-ui's `RemoteThreadListAdapter` (a second persistence layer to keep in sync with Mastra's), or Mastra Memory's own `generateTitle` (an extra model call per new conversation).
**Because:** one source of truth for history, and zero extra model calls on a free tier quota. A truncated first line is also what users recognise.
**Cost:** DuckDB is still one in-memory session per process (D-42), and it refuses new file registrations once it has run a query (M2's external access lockdown). So after a server restart a reopened chat has its messages, file list and previews, but its spreadsheets are no longer queryable until uploaded again. Rebuilding tables for a reopened chat needs a per conversation DuckDB session, which is out of scope here.

## D-50 File previews are typed plans built on the server and resolved only through the conversation's manifest
26 Sep 2026, interface upgrade, `src/modules/preview/`, `src/mastra/preview.ts`, `app/app/api/preview/`, `app/components/preview-panel.tsx`.
**Chose:** Clicking an uploaded source or a generated file (in the Files panel, a composer chip, or a `/generated/...` link in an answer) opens a Claude style panel beside the chat. The server returns a `FilePreview` union built by deterministic code: first 100 rows per sheet for xlsx/csv (exceljs, csv-parse), HTML for docx (mammoth), each slide's text for pptx (jszip over the slide XML), raw bytes for PDF (the browser's own viewer), text for txt/json/md. The browser names a source id or artifact id, never a path; `resolvePreviewFile` looks it up in that conversation's manifest. Word HTML renders in an `<iframe sandbox="">` and carries its own `default-src 'none'` CSP. `Source.path` now records where an upload was saved; sources from before that are found by exact name under `data/uploads/` or `samples/`.
**Over:** Rendering previews in the browser with client side parsers (a large bundle), converting everything to PDF (needs LibreOffice), or letting the browser pass a file path.
**Because:** Rules 3 and 4 hold unchanged: nothing in a preview comes from a model, and file content is shown as data inside a sandbox that can run no script and fetch nothing. Resolving through the manifest means the preview route can only ever serve files that conversation holds.
**Cost:** A pptx preview is a text outline, not a rendering; charts and images appear only in the downloaded file. `jszip` became a direct dependency (it was already installed through pptxgenjs, exceljs, docx and mammoth, so nothing new is downloaded), recorded here per CLAUDE.md.

## D-51 The source id counter starts past every id already saved
26 Sep 2026, interface upgrade, `src/modules/sources/registry.ts`, `src/mastra/session/manifestStore.ts`, `src/mastra/runtime.ts`.
**Chose:** `createSourceRegistry({ startAfter })`, seeded on startup from `manifestStore.maxSourceNumber()` (the highest `src_N` in any saved manifest).
**Over:** Random source ids.
**Because:** found while testing the sidebar: the registry is in memory and restarted at `src_1` after every server restart, while manifests persist. A new upload in a reopened chat got the id of an old source, and `addSource` (keyed by id) silently replaced the old one. Persistent conversations make restarts routine, so this had to go. `src_N` stays because prompts, evidence ids and tests all use that shape.
**Cost:** None found; a gap in the numbering after a restart is harmless.

## D-52 The chat UI is restyled as a light, ChatGPT style layout
26 Sep 2026, interface upgrade, `app/app/globals.css`, `app/app/assistant.tsx`, `app/components/`.
**Chose:** White as the primary surface and near black as the secondary (ink, primary buttons, the send button), pure neutrals with no hue. Conversations in a collapsible left sidebar grouped by day with search, rename and delete; the chat centred at 48rem with a pill composer carrying an attach button and ChatGPT style attachment chips; the old left Sources panel moved to a right hand Files panel that shares its space with the preview. Colour appears only in the small file type tiles.
**Over:** The scaffold's dark zinc theme with sources on the left.
**Because:** the left column is where users expect conversation history, and files belong next to the preview they open into. Upload works from the composer, the Files panel, or drag and drop onto either.
**Cost:** Dark mode is no longer offered; the `.dark` tokens remain in `globals.css` but nothing applies them.

## D-53 Gemini 3.5 Flash Lite goes between Gemini Flash and Groq in the fallback chain
26 Sep 2026, interface upgrade follow up, `src/mastra/models.ts`.
**Chose:** `MODELS.ANALYST` and `MODELS.WRITER` are now `[gemini-2.5-flash, gemini-3.5-flash-lite, groq/openai/gpt-oss-120b]`, both Gemini entries with `maxRetries: 0`.
**Over:** Gemini Flash straight to Groq (D-48), or moving the primary to a newer Gemini model.
**Because:** measured live on 26 Sep: the free tier for `gemini-2.5-flash` on this project is 20 requests per day per model (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`), and one multi specialist question spends several. Once it ran out, turns went to Groq, whose 8,000 tokens per minute cap is smaller than one tool heavy turn, so they failed anyway (Groq still had 994 of 1,000 daily requests left). Gemini quotas are per model, so Flash Lite brings a fresh daily quota on the same key and a large context window. Probed the alternatives the same day: `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` and `gemini-flash-latest` answered; `gemini-3.5-flash` and `gemini-3.8-flash` returned 503 high demand; `gemini-2.5-flash-lite` is retired for new users. A pinned model beats the `-latest` alias, which can change underneath a graded submission. Verified: with 2.5 Flash's quota spent, an agent on `MODELS.ANALYST` was answered by the second entry in 1.5s without reaching Groq.
**Cost:** Flash Lite reasons less well than Flash on the longest synthesis turns, so answers from later in the day may be plainer. The primary stays 2.5 Flash, so the models the grounding evals were built against are unchanged whenever its quota is available.

## D-54 Four model providers, switched on by their API keys, paid first
26 Sep 2026, provider support, `src/mastra/models.ts`, `src/modules/documents/rag.ts`, `.env.example`.
**Chose:** Every tier is built by `buildModelTiers(process.env)` from a default chain per tier that lists Anthropic, OpenAI, Google and Groq models best first. Entries whose provider has no key are dropped, so setting `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` makes Claude (`claude-opus-5`, `claude-haiku-4-5` for the small tiers) or GPT (`gpt-5.5`, `gpt-5.4-mini`) primary with no code change, and the free models stay as fallbacks. `MODEL_PROVIDERS` is an allowlist that removes providers entirely; `MODEL_ANALYST`, `MODEL_WRITER`, `MODEL_ROUTER`, `MODEL_RERANK`, `MODEL_EMBEDDER` replace a tier's chain. The embedder became a tier too (Gemini or OpenAI; Anthropic and Groq have none), with one vector index per embedding model so vectors of different dimensions never mix; the original Gemini index keeps its name.
**Over:** A separate Anthropic SDK or OpenAI SDK client, or a single `MODEL_PROVIDER=` switch.
**Because:** Mastra's model router already ships the OpenAI and Anthropic providers and reads their standard key variables, so a `provider/model` string is the whole integration and AGENTS.md's "Mastra for models" rule holds. Key presence is the one signal an administrator already controls; the allowlist exists because free tiers' terms may allow providers to use prompts, which company data should not reach. Verified live: with dummy Anthropic and OpenAI keys the chain reached both real APIs (`authentication_error`, "Incorrect API key"), then fell through to Gemini, which answered. No new dependency.
**Cost:** The OpenAI defaults (`gpt-5.5`, `gpt-5.4-mini`) are taken from Mastra's provider registry, not tested with a live key here; override them per tier if the company standardises on others. Claude Opus 5 rejects sampling parameters, which no agent here sets; keep it that way.

## D-55 Research refuses private and internal addresses (SSRF guard)
26 Sep 2026, security pass, `src/modules/research/urlSafety.ts`, `readPage.ts`, `crawlSite.ts`.
**Chose:** `checkPublicUrl` runs before any URL is read or crawled: http(s) only, no embedded credentials, not `localhost`/`.local`/`.internal`, and every address the host resolves to must be public (loopback, RFC 1918, link local including cloud metadata, CGNAT, IPv6 unique local and link local, multicast all refused). The server side fallback fetches go through `safeFetch`, which follows redirects by hand and re checks each hop. `RESEARCH_ALLOW_PRIVATE_URLS=1` switches it off for a trusted single user deployment.
**Over:** No guard (the previous state), or a hostname denylist only.
**Because:** found in the security pass: `readPage` and `crawlSite` fell back to a direct `fetch(url)` from this server and followed redirects. A URL from a user, or planted in an uploaded document, could have made the server read `169.254.169.254` or internal services and relay the content into the chat. A denylist of names misses a public name that resolves privately, and a redirect from a public page. Tests stub DNS so they stay offline.
**Cost:** A DNS answer that changes between the check and the connection (rebinding) is not fully closed; that needs connection pinning. Documented in docs/11-SECURITY.md.

## D-56 API routes forward only what they validate
26 Sep 2026, security pass, `app/app/api/*`, `app/lib/server-security.ts`, `src/modules/reliability/rateLimit.ts`, `src/modules/session/ids.ts`.
**Chose:** The chat route passes `handleChatStream` exactly `{ messages, trigger, memory }` and keeps only `user` and `assistant` messages with a parts array (at most 400, body capped by `CHAT_MAX_BODY_MB`). Every route validates conversation ids (`isValidSessionId`: 1 to 128 of `[A-Za-z0-9_-]`) and preview tokens, applies a per client fixed window rate limit (chat 20, upload 30, read 300 per minute, configurable, 0 switches one off), and answers internal failures with a generic message plus a short reference id logged server side.
**Over:** The previous `{ ...params, memory }` spread of the whole request body, `default-thread` fallbacks for a missing id, and `err.message` echoed in 500 responses.
**Because:** `handleChatStream`'s params are Mastra's full agent execution options, including `instructions`, `system`, `toolsets` and `clientTools`: the spread let any client rewrite the orchestrator's instructions, bypassing the grounding rules, or attach tools. A client supplied `system` message would have reached the model as an instruction (rule 4). With paid keys, an unthrottled chat endpoint is a way to spend money. Verified: an injected `system` message and an `instructions` field are dropped (400, no valid messages), a `../` id is refused.
**Cost:** In memory limits reset on restart and, without `TRUST_PROXY=1` behind a proxy, all callers share one bucket. Acceptable for a single process deployment (D-42).

## D-57 An optional shared password and strict browser headers
26 Sep 2026, security pass, `app/proxy.ts`, `app/next.config.ts`.
**Chose:** When `APP_ACCESS_PASSWORD` is set, Next.js 16's `proxy.ts` (the renamed middleware, Node runtime) requires HTTP Basic credentials on every page and API route, compared in constant time; unset, the app stays open for local development. `next.config.ts` sends a CSP allowing only this origin (dev adds `unsafe-eval` and websockets for Fast Refresh), `X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`, `nosniff`, a strict referrer policy, a permissions policy with camera and microphone off, HSTS in production, and no `X-Powered-By`. The raw file route is excluded from the CSP because Chrome's PDF viewer will not render under `object-src 'none'`; it sets its own sandbox CSP for non PDF files.
**Over:** User accounts (out of scope per AGENTS.md), or no gate at all.
**Because:** the app is about to be shared inside a company, and without a gate anyone who can reach the port can read every conversation and file and spend the model keys. One shared credential is the smallest control that closes that, and it composes with a company SSO proxy in front. Verified: no credentials and a wrong password get 401, the right one passes, the gate is off when unset; the page, the Word preview and the PDF preview all load under the CSP with no violations.
**Cost:** Everyone with the password sees every conversation. Basic credentials must travel over HTTPS.

## D-58 Two npm audit advisories are accepted, not force fixed
26 Sep 2026, security pass.
**Chose:** Leave `image-size` (high, via pptxgenjs) and `uuid` (moderate, via exceljs) as they are, documented in docs/11-SECURITY.md section 6.
**Over:** `npm audit fix --force`.
**Because:** neither is reachable with user input (pptxgenjs only measures chart PNGs this system renders; exceljs never passes a caller buffer to uuid), and the only offered fix downgrades both libraries to older breaking versions, which CLAUDE.md rules out.
**Cost:** Recheck when either package ships a patched release.

---

<!-- Append new decisions below as you make them. -->

## D-59 The demo video is a separate Remotion project under docs/
26 Sep 2026, `docs/demo-video/`, `docs/media/`.
**Chose:** A self contained Remotion project in `docs/demo-video/` with its own `package.json`, rendering `docs/media/demo.mp4` plus a short GIF teaser the README can play inline. The chat UI is redrawn from the app's own tokens and layout, and every figure on screen is computed from `samples/campaigns.xlsx`.
**Over:** A screen recording of the live app, or adding Remotion to the root or app `package.json`.
**Because:** a recording depends on free tier models answering on cue (the rate limits in D-53 made that unreliable) and cannot zoom into the SQL or the formula bar cleanly. Keeping Remotion out of both existing manifests leaves the app's dependency set, which CLAUDE.md treats as deliberate, exactly as it was. It is tooling for the README, not part of the system.
**Sound:** the soundtrack is synthesised by `docs/demo-video/scripts/make-soundtrack.ts`, with its effects timed from the same scene timeline as the animation, rather than a stock music track, which would carry a licence and never line up with the cuts.
**Cost:** The video is a faithful redraw, not footage, so a UI change means re rendering it. Remotion needs a company licence for organisations over three people.

## D-60 Structured output calls retry once, without prompt injection, on Groq's hallucinated "json" tool call
26 Sep 2026, live bug found running the app, `src/mastra/models.ts` (`generateStructuredOutput`), `src/mastra/agents/contracts.ts`, `src/mastra/workflows/artifactSteps.ts`.
**Chose:** `delegate()` and `authorPlanOnce()` now call the model through `generateStructuredOutput(agent, prompt, schema)` instead of `agent.generate()` directly. It tries the existing `jsonPromptInjection: true` call (D-38, needed for Gemini) first; if that throws with Groq's exact "attempted to call tool 'json' which was not in request.tools" message, it retries once with native structured output, then rethrows anything else unchanged.
**Over:** Leaving `jsonPromptInjection: true` unconditional, or trying to vary it per provider ahead of time.
**Because:** reproduced live once Gemini's free tier (D-53) was exhausted and `MODELS.ANALYST`'s chain reached Groq's `openai/gpt-oss-120b`: the model answered by attempting to call a tool named "json", which was never declared (prompt injection deliberately avoids adding one), and Groq's own API rejected the call outright (400, `isRetryable: false`), discarding an already well-formed answer. A model chain picks its serving provider internally inside one `agent.generate()` call, so branching the option by provider ahead of time is not possible from the caller; retrying on this exact failure signature is. Native structured output on a tool-calling model registers a real "json" tool and forces `tool_choice` to it, which is exactly the tool the retry needs to succeed.
**Cost:** One extra round trip only on this exact failure, which is Gemini-quota-shaped (only surfaces once the chain reaches Groq at all). A different Groq/OSS model with a different failure string would not be caught by the same regex and would need its own case.

## D-61 D-41 closed: the artifact workflow resolves workbook Data rows itself, via the shared runtime D-42 already built
27 Sep 2026, P8.1 dry run, `src/mastra/workflows/artifact.ts`, `artifactSteps.ts`.
**Chose:** `gatherEvidenceStep` now calls `resolveWorkbookDataRows(evidence, deps)` whenever the target format is xlsx and the caller's `dataRows` is empty: it picks the most-cited computed-evidence `sourceId`, looks up its table name via the shared `getRuntime()` registry (D-42), and runs `SELECT * FROM <table>` through the same `query()` every `run_sql` call already uses. `requestArtifactTool` still passes `dataRows: []`; it no longer needs to be the thing that resolves them.
**Over:** Wiring the orchestrator itself to query DuckDB before calling the workflow (rejected at D-41 time for the right reason: the orchestrator has no domain tools by design, and that has not changed). Leaving D-41 open into the submission, shipping every workbook with a Data sheet that undercuts its own Calculations formulas and Recommendations range references.
**Because:** found during the Phase 8 dry run (P8.1): D-42 (25 Sep) already built the exact shared session/registry this needed, but nothing went back to flip the one call site D-41's own "Cost" line said would need it. The workflow, not the orchestrator, is the right place: it is deterministic code that already imports `@/modules/*` directly, so resolving rows here does not compromise "the orchestrator has no domain tools," it only means the workflow's own data step does the same kind of lookup `gatherEvidence` already does against the evidence ledger.
**Cost:** Picks one source table when several computed sources are cited (skills/excel-workbook/SKILL.md's own "one Data sheet, not one per source" rule), by citation count; a workbook whose evidence spans two tables roughly equally could pick the less relevant one. Falls back to `[]` (the prior behaviour) rather than throwing when no computed evidence exists, the source has no registered table, or the query itself fails.

## D-62 D-60's retry also catches Groq's "json mode cannot be combined with tool/function calling"
27 Sep 2026, P8.1 dry run, `src/mastra/models.ts`.
**Chose:** Widen `generateStructuredOutput`'s retry condition to a second Groq error string, raised when the calling agent has other tools declared, with the same single retry without prompt injection.
**Over:** Leaving D-60 matching one string only.
**Because:** the research disabled grounding eval hit this second shape live once Gemini's quota was spent.
**Cost:** Partial. In the eval that surfaced it the retry failed with the same error, so on a tool bearing agent served by Groq both structured output modes can be refused, and the call becomes a reported PARSE_FAILED gap, not a crash (contracts.ts). The fuller fix is a separate formatting call with no tools, not built.

## D-63 Specialists get a 12 step budget, and every grounded answer is recorded as a Finding
27 Sep 2026, P8.1 dry run, `src/mastra/models.ts`, `src/mastra/agents/orchestrator.ts`, `app/app/api/chat/route.ts`.
**Chose:** `generateStructuredOutput` passes `maxSteps: 12` (`SPECIALIST_MAX_STEPS`) and the chat route passes `maxSteps: 10` (`ORCHESTRATOR_MAX_STEPS`) to the orchestrator, server set. `handle_request` now turns each successful specialist outcome into a Finding (`buildFinding`): its answer, citing only evidence ids the ledger actually holds, at the weakest cited entry's confidence, with its gaps as caveats, saved to the ledger and mirrored into the manifest.
**Over:** Mastra's default of 5 steps, and leaving findings to be created by nothing.
**Because:** the dry run's first data question failed as PARSE_FAILED. Measured directly: pinned to Gemini 3.5 Flash Lite, the Data Analyst's loop ended at step 5 on `finishReason: "tool-calls"` (list_datasets, describe_dataset, three run_sql) with an empty `object`; at 12 it finished in 7 steps and reported CLV as a gap, exactly what the missing metric eval asks. Gemini 2.5 Flash usually fits in 5, so this only appeared once its 20 a day quota was spent. Separately, no production code ever called `addFinding`: the manifest's findings stayed empty, so `request_artifact` built every file from zero findings and zero evidence, D-35's knownFacts never had anything to pass, and D-61's row resolver had no evidence to resolve from.
**Cost:** A finding's statement is the specialist's whole answer rather than a distilled one sentence claim, and `soWhat` is left empty for the artifact author to supply. A stuck loop can now spend up to 12 model calls before giving up.

## D-64 Tabular files register through a throwaway loader instance, so uploads work after the first query
27 Sep 2026, P8 dry run, `src/modules/analysis/session.ts`, `src/modules/analysis/registerRows.ts`, `src/modules/analysis/lateRegistration.test.ts`.
**Chose:** `registerFile` reads the file in a fresh in-memory DuckDB instance that only ever runs its own fixed SQL, copies the column types from `DESCRIBE`, creates the table in the session and streams the rows in with DuckDB's appender, then closes the loader. `registerRows` drops its `locked` guard, since CREATE TABLE and INSERT VALUES never needed external access. D-13's lock on first query is unchanged.
**Over:** Re-enabling external access around each registration (DuckDB refuses: "Cannot enable external access while database is running"), and parsing uploads in Node with exceljs or csv-parse into `registerRows`, which would replace DuckDB's type inference with a second, weaker one.
**Because:** runtime.ts keeps one DuckDB session for the process, so D-13's accepted cost was far wider than it read: after any query, every later spreadsheet failed as QUERY_INVALID with a message about external file access, and every table inside a later PDF or Word upload was silently dropped, until a restart. The loader never sees model SQL and the session never reads a file, so no model written SQL can reach the filesystem or network, which is what D-13 exists for.
**Cost:** Each upload holds the table in memory twice for the moment of the copy, and opens one extra short lived DuckDB instance. A second upload whose name maps to an existing table name still fails, as before.

## D-65 A rate limited delegation is reported once, never retried within the turn
27 Sep 2026, P8 dry run, `src/mastra/agents/orchestrator.ts`.
**Chose:** `runDelegation` recognises quota and rate limit errors (429, RESOURCE_EXHAUSTED, "rate limit", "quota", Groq's "request too large", checked down the error's cause chain) and returns `RATE_LIMIT` with `recoverable: false`, and orchestrator rule 11 says not to call handle_request again in that turn.
**Over:** Reporting every delegation failure as a recoverable PARSE_FAILED that suggests asking again.
**Because:** live, with every free tier spent, one question made four handle_request calls, each running a specialist loop against providers already refusing it, and the user waited 3.3 minutes for a rate limit banner. The "ask again" suggestion was being followed inside the same turn, turning an exhausted quota into more spend on the same quota.
**Cost:** Detection is by message text; a provider that words its quota error differently falls back to PARSE_FAILED and the old retry behaviour.

## D-66 Specialists answer freely; the SpecialistResult is assembled, not requested as JSON
27 Sep 2026, P8 dry run, `src/mastra/agents/contracts.ts`, `tests/grounding/scorers.ts`.
**Chose:** `delegate()` runs the specialist's tool loop with no structured output. The answer is its own final text, verbatim; evidence is every entry its `record_evidence` calls actually wrote; failures are its non recoverable tool errors; gaps come from its JSON when it writes JSON, otherwise from a small tool free extraction call on the router tier that is given the question and the answer.
**Over:** Structured output on the same call as the tool loop (D-38, D-60, D-62), or a formatting model rewriting the whole answer into the schema.
**Because:** asking for JSON at the end of a tool loop failed on every provider tried: Gemini rejects JSON mode with tools, Groq refused it two ways, and on Claude the Data Analyst wrote a complete, correctly cited markdown analysis that the parser discarded as PARSE_FAILED, after which the orchestrator retried for minutes. Assembling the result keeps the parts that matter deterministic: no model retypes a number, and no evidence id can appear that the ledger does not hold. Live, the missing metric eval passes on Claude. The same run exposed two false positives in its scorer, now fixed: "none of them" was not read as a negation, and any sentence naming CLV counted as stating it, where only a money figure can.
**Cost:** One extra small model call per delegation when the answer is prose. A failed extraction returns the answer with no gaps rather than failing the turn, so a gap can be missing from `openGaps` while still stated in the answer text.
