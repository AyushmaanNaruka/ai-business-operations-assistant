# Build plan

Six days. Something demonstrable at the end of each one, so nothing lands all at once on Sunday.

Tick items as you go. This file is the real progress tracker.

The prompts that build each item are in `PROMPTBOOK.md`, phase by phase. Use one prompt per working session.

---

## Monday 22 September: foundation

- [x] Scaffold with `npm create mastra@latest` (see `10-SETUP.md`)
- [x] `src/mastra/models.ts` with the four tiers
- [x] LibSQL storage wired, one file at `data/app.db`
- [x] All shared types from `05-DATA-MODEL.md` in `src/types/`
- [x] `src/modules/reliability/` first, because everything else returns `ToolResult`
- [x] One trivial agent answering in Mastra Studio
- [x] **Sample dataset built** (see `08-DEMO-SCENARIOS.md`), with real messiness in it
- [x] Git initialised, first commit, `.env` populated from `.env.example` (confirmed live: the placeholder agent answered through `MODELS.ANALYST` using the Google key)

**Demonstrable:** chat with an agent at localhost:4111.

---

## Tuesday 23 September: structured data

- [x] M1 ingestion: type detection, DuckDB registration, profiling with quality warnings
- [x] M1 async: upload returns `pending`, status flips to `ready`
- [ ] M1 table extraction from documents — this is PDF/DOCX table extraction, scoped to `docs/PROMPTBOOK.md` P3.2 (Phase 3, Wednesday), not one of P2.1-P2.7; left for Phase 3
- [x] M2 DuckDB session, SQL validator, `describe`, `query`, `computeStats`
- [x] Data Analyst agent with its four tools (plus a fifth, `record_evidence`; see D-16)
- [x] `skills/campaign-analytics/SKILL.md` attached to it
- [x] M5 evidence ledger, `Evidence` and `Finding`
- [x] Tests for M1, M2, M5

**Demonstrable:** upload the campaign spreadsheet, ask "which channel performed best", get a real number with the SQL that produced it.

---

## Wednesday 24 September: documents and research

- [x] M3 markdown conversion with inline page markers, for PDF and DOCX
- [x] M1 table extraction from documents (P3.2: pdf-parse getTable() for PDF, mammoth HTML tables for Word, registered into DuckDB alongside the prose)
- [x] M3 token counting and routing
- [x] M3 full context path and `get_document`
- [x] M3 indexed path: chunk, embed, LibSQLVector, filtered query tool, rerank
- [x] Document agent with its three tools
- [x] M4 search, read page, crawl, with fallbacks
- [x] Research agent, `skills/company-research/SKILL.md`
- [x] Tests for M3 and M4

**Demonstrable:** ask a question answered from a PDF and a company website together, with citations.

---

## Thursday 25 September: orchestration

- [x] Orchestrator agent with its nine (now ten, see D-36) instruction rules
- [x] `SpecialistTask` and `SpecialistResult` contracts wired
- [x] Intent classification including the `recommendation` class
- [x] Parallel delegation when independent, sequential when dependent
- [x] Evidence conditioned queries: document facts become query constraints
- [x] Conflict detection wired into synthesis
- [x] Plan statement and progress streaming for multi part requests
- [x] M8 session manifest and reference resolution

**Demonstrable:** the full four turn conversation from the brief, end to end. Verified turns 1-3 against
the real code path (unit tested); turn 4's plan-statement quality is model-judgement dependent and
wasn't live-confirmed before the Gemini free-tier daily quota ran out (see D-37/D-38). All 310 tests
pass, `tsc --noEmit` is clean. Note for Saturday: nothing yet calls `addSource()` against the
orchestrator's own `SessionManifest` on upload (`dataAnalyst`/`documentAgent` each still auto-load
samples into their own private D-15/D-27 stand-in sessions) — confirm the chat UI's upload flow wires
into `src/mastra/session/manifestStore.ts`, or `read_session_manifest`/`resolve_reference` will see
nothing.

---

## Friday 26 September: artifacts

- [x] All ten `SKILL.md` files written **first** (P6.1: reviewed and lightly revised — five house-rule additions, one evidence-citation/campaign-plan contradiction resolved with a new rule 6)
- [x] Zod schemas for each artifact type (P6.2: `src/modules/artifacts/schemas/*`, plus `validatePlan`'s schema-agnostic house-rule checker)
- [x] `renderXlsx` with the five sheet convention and live formulas (P6.3)
- [x] `renderPptx` with native charts and speaker notes (P6.4)
- [x] Artifact workflow, eight steps, with validation and suspend on repeated failure (P6.6: six graph nodes per D-40's documented steps-4/5 merge and step-6 precheck simplification; suspend-after-two-attempts verified by test)
- [x] Chart rendering via QuickChart (P6.5: `renderChart.ts`, used by `renderDocx`; `renderXlsx` embeds its own inline; `renderPdf` uses client-side Chart.js instead)
- [x] Artifact versioning (P6.6: `src/modules/artifacts/store.ts`, a revision keeps every earlier version downloadable)
- [x] `renderDocx` and `renderPdf` (P6.5: both built, not cut)
- [x] Tests: each house rule rejects a bad plan, each renderer produces an openable file (verified at the real ZIP/XML/PNG byte level throughout, not just structurally)

**Demonstrable:** generate a deck and a workbook from the conversation, then revise one. Wired end to end via `request_artifact` (P6.7): multiple artifacts in one request run in parallel, an unlisted type routes to `generic-document` instead of a refusal, and every completed result carries its real `downloadUrl`. D-41's workbook Data sheet gap is closed as of D-61 (P8.1): the artifact workflow resolves real rows itself from the shared runtime D-42 built, rather than shipping an empty Data sheet.

---

## Saturday 27 September: reliability and interface

- [x] Next.js chat UI with assistant-ui, file upload, download links
- [x] Per source status visible in the UI
- [x] Progress streaming visible in the UI (the orchestrator's own stated plan/progress narration, P5.6, streams through the same chat turn; tool calls render via ToolFallback)
- [x] Long running work as workflow runs with IDs, `maxDuration` raised (60s on `/api/chat`; artifact generation already ran as a workflow run since P6.6)
- [x] Streamed upload to disk with size cap
- [x] The four grounding evals in `tests/grounding/` (built, `npm run eval`; re-run once the Gemini free tier's daily quota resets — exhausted today by this session's own testing, see docs/DECISIONS.md)
- [x] **Deliberate breakage pass:** corrupt file, unsupported request, scanned PDF, question mid ingest, two sources that disagree — all verified through the real `/api/upload` and module layer, each producing a clear honest message. Network-cut-mid-research is structural (M4's SEARCH_QUOTA/fallback path, unit tested) but not manually exercised by physically disconnecting

**Demonstrable:** the system behaving well when things go wrong, which is the part that separates submissions.

### Saturday 27 September, interface upgrade

- [x] Groq as an automatic fallback when Gemini fails, per LLM step (`src/mastra/models.ts`, D-48); verified live with an invalid Gemini key
- [x] Conversation sidebar: every past chat listed newest first, grouped by day, searchable, rename and delete; reopening one restores its messages and files and continues where it left off (D-49)
- [x] File preview panel beside the chat for uploaded sources and generated files: spreadsheets, PDFs, Word, decks, text (`src/modules/preview`, D-50)
- [x] ChatGPT style light theme, upload from the composer with attachment chips, starter prompts (D-52)
- [x] Source ids no longer collide after a server restart (D-51)
- [x] Gemini 3.5 Flash Lite added between Gemini Flash and Groq, since each Gemini model has its own daily quota (D-53); verified live with 2.5 Flash's quota spent
- [x] Anthropic (Claude) and OpenAI (GPT) supported, switched on by their keys, paid first, with a provider allowlist and per tier overrides (D-54); wiring verified against both live APIs
- [x] Security pass for sharing inside a company (docs/11-SECURITY.md): SSRF guard on research (D-55), chat route forwards only validated messages, id validation, rate limits, generic errors (D-56), optional password gate and security headers (D-57), audit advisories reviewed (D-58)
- [x] The two flaky `readPage` tests fixed: a cold jsdom import under the full parallel run outlasted the 5s timeout. Full suite green, 477 tests

**Demonstrable:** close the tab, restart the server, reopen the chat from the sidebar, click the spreadsheet to preview it, and keep asking.

---

## Sunday 28 September: submission

- [ ] Full dry run of demo scenario A, recorded
- [ ] Full dry run of demo scenario B (website only), recorded
- [ ] Generated artifacts committed to `samples/generated/`
- [ ] README written, all six required sections
- [ ] `DECISIONS.md` tidied and referenced from the README
- [ ] Requirements matrix Build column completed
- [ ] Repository pushed, history clean
- [ ] Fresh clone test: does `10-SETUP.md` actually work from zero

---

## Monday 29 September, morning

- [ ] Buffer
- [ ] Final read of the README as a stranger would
- [ ] **Submit before 12:00 PM**

---

## Cut list, in order

If time runs short, cut in this order. Never cut upward past the line.

1. PDF renderer
2. Word renderer
3. Firecrawl crawling (keep search and single page reads)
4. The RAG indexed path (keep full context, cap document size, state the limitation honestly)
5. Re-ranking

--- do not cut below this line ---

6. Evidence ledger
7. Error handling and the grounding evals
8. Excel and PowerPoint renderers
9. The four agents

Excel plus PowerPoint satisfies "at least two generated business artifacts", and they demo best. Cut breadth. Never cut grounding or error handling; they are two of the eleven things being graded.
