# Module specifications

Nine modules. Each has a job, a public surface, and a set of decisions already made. `03-ARCHITECTURE.md` has the reasoning; this file is the build spec.

**Rule:** `src/modules/*` is pure logic with no Mastra import and no model call, so every module is testable without an API key. `src/mastra/*` wires modules into tools and agents.

---

## M1. Source Registry and Ingestion
`src/modules/sources/`

**Job:** get any input into a queryable state and describe it honestly.

**Surface**

```ts
ingest(input: { path?: string; url?: string }): Promise<Source>
getSource(id: string): Source | undefined
listSources(): Source[]
```

**Pipeline**

1. Detect type by extension plus magic bytes. Never by a model.
2. Branch:
   - tabular to DuckDB registration, then profile
   - document to markdown with page markers, then token count, then route full or indexed, **then also scan for tables and register any found**
   - url to Jina Reader, then the document path
3. Write the source card into the manifest.

**Decisions already made**

- Runs asynchronously. The upload returns a `pending` source immediately.
- Parsed output cached by file hash. Re-uploading the same file costs nothing.
- A source can be both prose and tabular. This is the difference between computing a number from a PDF table and reading it as text.
- The profile emits quality warnings (null rates, mixed date formats, duplicates) into the source card.
- A document that reads as a list of requirements has its items extracted into `proposedTasks`, surfaced to the user, **never executed**.

**Failure handling**

| Failure | Response |
|---|---|
| Encrypted PDF | `ENCRYPTED`, source marked failed, others continue |
| Under ~100 chars per page | `SCANNED_PDF`, reported honestly as having no extractable text |
| `.doc` or `.xls` | `UNSUPPORTED_FORMAT` naming the modern format to save as |
| Over the size cap | `FILE_TOO_LARGE` before parsing starts |
| URL blocked | Try the fallback reader, then `PAGE_BLOCKED` |

**Tests:** one fixture per supported type, plus an encrypted PDF, a scanned PDF, a PDF with a table, and a malformed CSV.

---

## M2. Analysis Engine
`src/modules/analysis/`

**Job:** compute, never estimate.

**Surface**

```ts
createSession(sessionId: string): DuckDBSession
registerFile(session, path, tableName): Promise<TableRef>
describe(session, tableName): Promise<TableProfile>
query(session, sql): Promise<ToolResult<QueryResult>>   // returns rows AND the sql
computeStats(rows, op): Promise<ToolResult<StatsResult>>
```

**Guardrails on `query`**

- One in memory database per session
- `SET enable_external_access = false` once files are loaded. This blocks reading local paths and any network exfiltration, and it is the attack that actually matters
- Single statement, must begin with `SELECT` or `WITH`
- Statement timeout and a row cap
- On a SQL error, return `QUERY_INVALID` with the message so the agent can fix it. Two self corrections maximum

**`computeStats`** wraps `simple-statistics`: linear regression with R squared, correlation, two sample t test. Separate from SQL so the agent does not attempt a regression in SQL.

**Decisions already made**

- No arbitrary code execution, no sandbox. SQL plus a stats library covers the realistic question space with no escape surface
- Every result carries its SQL, which becomes `Evidence.method`

**Tests:** aggregation correctness against a known fixture, rejection of every disallowed statement shape, timeout behaviour, and a stats result checked against a hand computed value.

---

## M3. Document Store
`src/modules/documents/`

**Job:** hold prose so it can be read whole or searched, and cite it precisely either way.

**Surface**

```ts
toMarkdown(path, kind): Promise<{ markdown: string; pageCount?: number }>
countTokens(markdown): number
route(tokenCount, sessionTotal): DocMode
index(sourceId, markdown): Promise<void>          // the RAG path
getDocument(sourceId): Promise<string>
search(query, filter): Promise<ToolResult<Passage[]>>
```

**Markdown carries its own citations**

```markdown
<!-- source: company-brief.pdf | page: 2 -->
## Positioning
Acme targets mid-market SaaS teams in North America...
```

`unpdf` gives positioned text items so page boundaries are known. `mammoth.convertToMarkdown()` preserves Word headings. Jina Reader already returns markdown.

**Routing**

| Condition | Mode | Tool |
|---|---|---|
| Source under `DOC_FULL_CONTEXT_TOKEN_LIMIT` | `full` | `get_document` |
| Source over it | `indexed` | `search_documents` |
| Session over `SESSION_DOC_TOKEN_BUDGET` | Largest sources flip to `indexed` until it fits | mixed |

**The indexed path** is Mastra's own RAG: `MDocument.fromMarkdown()`, chunk with `semantic-markdown`, embed with `google/gemini-embedding-001` through the model router, `LibSQLVector`, `createVectorQueryTool({ enableFilter: true })`, then `rerankWithScorer` taking ten results down to four.

**Metadata on every chunk:** `sourceId`, `sourceName`, `sourceType`, `page`, `heading`, `chunkIndex`, `retrievedAt`. Filtering on `sourceId` is what keeps attribution honest when several documents are loaded.

**Tests:** page markers survive parsing, the router picks the right mode at the boundary, filtered search returns only the requested source.

---

## M4. Research Module
`src/modules/research/`

**Job:** reach the public web without lying about what it found.

**Surface**

```ts
search(query, limit): Promise<ToolResult<SearchHit[]>>
readPage(url): Promise<ToolResult<{ markdown: string; retrievedAt: string }>>
crawlSite(domain, maxPages): Promise<ToolResult<PageRef[]>>
```

**Layered fallbacks**, because free tiers fail and a demo that dies on a rate limit is a bad demo:

| Capability | Primary | Fallback |
|---|---|---|
| Search | Exa | Tavily |
| Read a page | Jina Reader | fetch plus readability plus jsdom |
| Crawl | Firecrawl | sequential `readPage` over discovered links, capped |

**Decisions already made**

- `RESEARCH_MAX_PAGES` caps a single research task so one request cannot burn the month's quota
- URL cache per session
- Every page records `retrievedAt`
- Quota exhaustion returns `SEARCH_QUOTA`, the agent reports it as a gap, and the orchestrator answers from the user's own data while saying research was unavailable. It does not invent competitor facts

**Tests:** fallback fires when the primary errors, the page cap holds, quota exhaustion produces a gap rather than an answer.

---

## M5. Evidence Ledger
`src/modules/evidence/`

**Job:** be the single place any fact can come from. Smallest module, most weight in grading.

**Surface**

```ts
addEvidence(e: Omit<Evidence, 'id' | 'createdAt'>): Evidence
addFinding(f: Omit<Finding, 'id' | 'createdAt'>): Finding
getEvidence(ids: string[]): Evidence[]
detectConflicts(ids: string[]): Conflict[]
gatherFor(topic: string): { findings: Finding[]; evidence: Evidence[] }
```

**Conflict detection** compares entries with matching `metric.name` plus `metric.scope`, tolerance by unit. Both sides are surfaced with their sources. The system never picks a winner silently.

**What this module answers**

| Criterion | How |
|---|---|
| Reliability and grounding | Nothing enters an answer without an entry |
| R6 no fabrication | No entry means a reported gap |
| R7 traceability | Locator plus, for numbers, the exact query |
| E5 multiple sources | Each entry knows its kind and origin |
| E9 conflicting information | Detected mechanically, surfaced not resolved |

**Tests:** conflict detection fires on matching keys and stays silent on non matching ones; `gatherFor` returns findings with their full evidence closure.

---

## M6. Artifact Factory
`src/modules/artifacts/`

**Job:** turn established evidence into files someone would actually send to a client.

**Three layers, kept separate**

| Layer | Owns | Changed by editing |
|---|---|---|
| Skill (`skills/*/SKILL.md`) | What makes a good one | A markdown file |
| Zod schema (`schemas/`) | What shape it must be | A type |
| Renderer (`renderers/`) | How it becomes a file | TypeScript |

**Workflow, eight steps, one model call**

```
resolve kind -> gather evidence -> load skill -> AUTHOR PLAN (model)
 -> validate -> render charts -> render file -> store and link
```

**Validation enforces what the schema cannot**

- every numeric claim carries at least one evidence ID
- no empty or placeholder sections
- every referenced ID exists
- chart data matches the evidence it cites

Two failed attempts and the workflow suspends and asks the user. It does not ship a bad file.

**Renderers**

| Renderer | Notes |
|---|---|
| `renderXlsx` (exceljs) | Five sheets: Summary, Recommendations, Data, Calculations, Sources. Calculations holds **live formulas**, so a reviewer can click a cell and see `=SUM(Data!D2:D50)` |
| `renderPptx` (pptxgenjs) | Native editable charts, no images. Speaker notes on every slide. Master defined in code |
| `renderDocx` (docx) | Headings, tables, TOC with `updateFields: true` |
| `renderPdf` (puppeteer) | One HTML template serves the preview and the PDF |
| `renderChart` (QuickChart) | PNG buffer for docx and xlsx. Decks do not use it |

**Decisions already made**

- Artifacts are versioned. A revision keeps the earlier file downloadable
- Every artifact records its finding and evidence IDs
- `generic-document` is the fallback so an unlisted artifact type is never refused

**Tests:** a plan failing each house rule is rejected; each renderer produces a file that opens; the Excel formula cells contain formulas, not values.

---

## M7. Orchestration
`src/mastra/agents/`

Covered in `03-ARCHITECTURE.md` Part 3. Small surface:

```
orchestrator.ts    instructions, subagents, artifact workflow as a tool
dataAnalyst.ts     four SQL tools, campaign-analytics skill
documentAgent.ts   three document tools
researchAgent.ts   three research tools, company-research skill
contracts.ts       SpecialistTask, SpecialistResult
```

**Model tiers in `src/mastra/models.ts`**, never hardcoded names:

```ts
export const MODELS = {
  ROUTER:  'groq/openai/gpt-oss-120b',
  ANALYST: 'google/gemini-2.5-flash',
  WRITER:  'google/gemini-2.5-flash',
  RERANK:  'groq/openai/gpt-oss-20b',
}
```

(Updated 23 Sep 2026: see docs/DECISIONS.md D-24 — the originally listed Groq models are not in this project's live account catalog.)

---

## M8. Session and Memory
`src/modules/session/` plus Mastra Memory

**Job:** make "now compare it with the other one" work.

Two layers. **Mastra Memory** holds conversation history in threads backed by LibSQL, with `lastMessages` capped. **The session manifest** holds structured state the orchestrator reads first every turn.

**Reference resolution:** "the target company", "the other one", "this" resolve against the manifest. If a reference cannot be resolved, ask one short question rather than guessing.

**Tests:** the manifest survives a restart; a reference to a source that does not exist produces a question, not an assumption.

---

## M9. Reliability Layer
`src/modules/reliability/`

**Job:** answer most of the engineering expectations list.

**Surface**

```ts
ok<T>(data: T): ToolResult<T>
fail(code: ErrorCode, message: string, opts?): ToolResult<never>
withRetry<T>(fn, policy): Promise<ToolResult<T>>
classify(code: ErrorCode): 'transient' | 'correctable' | 'terminal'
```

Plus the capability list the orchestrator uses to answer unsupported requests with "I cannot do X, what I can do is Y".

**Long running work:** anything expected past about 20 seconds runs as a Mastra workflow run with an ID, streaming step level progress, rather than as a long HTTP request.

**Tests:** every error code maps to a class; retry gives up after the stated attempts; no tool in the codebase throws (assert with a lint rule or a test that walks the tool registry).
