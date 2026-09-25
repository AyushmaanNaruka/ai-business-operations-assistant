# AI Business Operations Assistant: Build Checklist and Tech Research

Prepared 22 September 2026. Assignment due Monday 28 September 2026, 12:00 PM.
Stage: requirements and research complete. Architecture design is the next step.

---

## Part 1: What we actually have to build

I read the brief line by line and turned it into a checklist. Nothing here is my invention; every item maps to something they asked for or something they said they will grade.

### 1.1 Hard requirements (non negotiable)

| # | Requirement | Their words |
|---|---|---|
| R1 | Written in **TypeScript** | "The application must be built using: TypeScript" |
| R2 | Built on **Mastra** | "...Mastra" |
| R3 | **Multi agent architecture** where appropriate | "The system should use a multi-agent architecture where appropriate" |
| R4 | **Conversational interface** that keeps context across turns | "The interaction should remain conversational" |
| R5 | Numbers computed **programmatically**, not guessed by the model | "calculations should be performed programmatically ... rather than relying solely on an LLM" |
| R6 | **No fabrication** when data is missing | "The system should avoid fabricating information when the required data is unavailable" |
| R7 | Claims **traceable to their source** | "Important claims and conclusions should be traceable to their underlying information" |

### 1.2 Capability checklist (the feature surface)

**A. Input handling**

1. Upload and read PDF files
2. Upload and read Word documents
3. Upload and read Excel files (.xlsx)
4. Upload and read CSV files
5. Upload and read plain text files
6. Take a public webpage or company website URL as input
7. Reason across several of these at once in a single answer

**B. Analysis**

8. Answer factual questions about a dataset ("which campaign performed best")
9. Compute derived metrics (conversion rate, CTR, cost per acquisition, ROAS)
10. Compare segments against each other
11. Detect trends over time
12. Give recommendations grounded in the computed numbers
13. Show its working: which rows, which formula, which calculation

**C. Research**

14. Search the public web for a company or topic
15. Read and extract the useful content of a web page
16. Merge web findings with the user's uploaded data in one answer
17. Attach a source link to each researched claim

**D. Deliverables (generated files)**

18. Structured report (Word or PDF)
19. Excel workbook with real data, multiple sheets, formulas
20. PowerPoint presentation
21. Summary document
22. Content brief or campaign plan
23. Files must contain real structured content, not the chat reply pasted into a file
24. Files must be downloadable from the chat

**E. Conversation**

25. Multi turn memory: "now compare it with X", "great, turn that into a proposal"
26. Remembers which files are loaded and what was already analysed
27. Can chain: analyse, then compare, then propose, then export

### 1.3 Engineering concerns they explicitly listed

They gave a list of twelve things under "Engineering Expectations". These are almost certainly a scoring rubric, so each needs a visible, deliberate answer in the code and in the README.

| # | Concern | What "handled" means for us |
|---|---|---|
| E1 | Different file types | One router that detects type and picks a parser |
| E2 | Large files | Spreadsheets are streamed and queried, never put in the prompt. Documents are measured at ingest and switched to retrieval once they pass a token threshold |
| E3 | Structured vs unstructured info | Two separate stores: a table store and a text store |
| E4 | Numerical analysis | SQL engine does the maths, model only writes the query and reads the result |
| E5 | Multiple sources | A source registry, and an evidence ledger that tags every fact with its origin |
| E6 | Long running tasks | Streaming progress, plus workflows that can suspend and resume |
| E7 | Errors and failed operations | Typed tool results, retries with backoff, graceful degradation |
| E8 | Unsupported requests | An explicit "I cannot do that, here is what I can do" path |
| E9 | Conflicting information | Surface both values with both sources instead of silently picking one |
| E10 | Generated artifacts | A separate artifact store with metadata and download links |
| E11 | Conversation context | Mastra memory plus a compact session manifest |
| E12 | Cost and latency | Cheap model for routing and extraction, stronger model for reasoning; cache parsed files |

### 1.4 Submission checklist

- [ ] Working application (runnable with clear setup steps)
- [ ] GitHub repository with clean commit history
- [ ] README covering: architecture, key design decisions, how the multi agent system works, how files and data are processed, how artifacts are created, important trade offs
- [ ] A short demo using a realistic business scenario
- [ ] At least two generated business artifacts checked into the repo or linked
- [ ] Sample data files so the reviewer can reproduce the demo

### 1.5 What they are grading (from the brief)

Problem solving, multi agent design, orchestration, handling different information types, analysis quality, reliability and grounding, artifact quality, engineering practices, error handling, architectural reasoning, and the ability to explain trade offs.

Two of those are worth calling out because most candidates will miss them:

- **"Ability to explain technical trade offs"** is graded. That is a README and interview skill, not a code skill. Budget real time for it.
- **"Reliability and grounding"** is graded. This is where the evidence ledger idea below earns its place.

Their closing line matters too: *"A focused, well-engineered solution with thoughtful design decisions is preferable to a large system with unnecessary complexity."* So the goal is a tight system with defensible reasoning, not a sprawling one.

---

## Part 2: Research findings and the recommended stack

Everything below was checked against live docs and the npm registry on 22 September 2026. Versions and free tier limits are current as of that date.

### 2.1 Mastra: what it actually gives us

Mastra is a TypeScript framework for agents. The parts relevant to us:

| Mastra piece | What it does | Do we use it |
|---|---|---|
| `Agent` | An LLM with instructions, tools and memory | Yes, core |
| **Subagents** | A parent agent delegates to named child agents | **Yes, this is our multi agent mechanism** |
| `createTool` | A typed function the agent can call, validated with Zod | Yes, heavily |
| **Workflows** | Deterministic step pipelines with branching, parallel steps, suspend and resume | Yes, for ingestion and artifact building |
| **Memory** | Thread based conversation history, working memory, semantic recall | Yes |
| **Studio** | Local UI at localhost:4111 to chat with agents, inspect traces and tool calls | Yes, for development and for the demo video |
| Observability | Built in traces of every agent step and tool call | Yes, free credibility in the demo |
| Sandboxes | Isolated environments to run generated code (Local, Docker, E2B and others) | Probably not, see 2.3 |
| **RAG** | Document chunking, embedding, vector stores, filtered retrieval, re-ranking | **Yes, but only for large documents. Built and deliberately bypassed below the threshold, see 2.5** |
| **Skills** | Reusable instruction files an agent loads on demand | **Yes, one per artifact type, holding the quality rules** |

**The single most important finding.** Mastra used to have an `Agent.network()` API for LLM driven routing between agents. It was **deprecated in February 2026** in favour of the explicit **Supervisor plus subagents** pattern. The reasons were context loss between agents, brittle routing, poor observability and streaming breaking at three levels of nesting.

Practical consequences for our design:

- Use `agents: { ... }` on a parent agent (the supervisor pattern). Do not use `.network()`.
- **Keep delegation two levels deep, maximum.** Supervisor, then specialists. No specialists delegating to sub specialists.
- Pass **structured task inputs** to subagents, not a dump of chat history.

Mastra's own orchestration guidance backs this: *"My default when unsure is deterministic, because loosening a rigid pipeline is far easier than debugging one that reinvents its path on every request."* And: *"For anything one good agent already handles, extra agents only add cost and a bigger surface to debug."*

That is a gift for the interview. The right answer to "why this architecture" is: agents where the path is unknown, workflows where the path is known.

### 2.2 The LLM (free tier)

| Provider | Free tier | Tool calling | Verdict |
|---|---|---|---|
| **Google Gemini Flash** | Free, roughly 10 to 15 requests/min and 1,000 to 1,500 requests/day, very large context | Excellent, mature function calling | **Primary** |
| **Groq** | Free, 30 requests/min, 1,000/day, but only 8,000 tokens/min | Excellent, all models support tools | **Fallback and fast/cheap tier** |
| OpenRouter | 50 requests/day free, or 1,000/day after a one time ~$10 top up | Inconsistent on free models | Escape hatch only |
| Cerebras | Now a 30 day $5 trial needing card verification, 5 requests/min | Fine, but 5 rpm kills agent loops | Skip |

**Recommendation:** Gemini Flash as the main model, Groq as the cheap and fast tier for routing and extraction. Both are official Vercel AI SDK providers (`@ai-sdk/google`, `@ai-sdk/groq`) and Mastra accepts them as simple `"google/gemini-2.5-flash"` strings, so switching provider is a one line change. Build a `models.ts` that names tiers (`ROUTER`, `ANALYST`, `WRITER`) rather than hardcoding model names. That is both good engineering and a talking point for E12 (cost and latency).

Note: Google removed the per model free tier table from their docs. Check your live quota at aistudio.google.com/rate-limit before the demo.

(Updated 26 Sep 2026: the Groq fallback is now automatic. `MODELS.ANALYST` and `MODELS.WRITER` are Mastra model fallback lists, Gemini first and Groq second, so a Gemini quota error re-runs the step on Groq. See docs/DECISIONS.md D-48.)

### 2.3 Numerical analysis: the most important technical decision

The brief says calculations must be programmatic. There are three ways to do this, and the choice is a big part of the score.

| Approach | How it works | Verdict |
|---|---|---|
| Let the model do arithmetic in its head | Model reads rows and reports totals | Explicitly forbidden by the brief |
| Model writes Python/JS, we execute it | Real code interpreter, needs a sandbox | Powerful but heavy: needs Docker, E2B or `isolated-vm`, and real security work |
| **Model writes SQL, DuckDB executes it** | Uploaded file is registered as a table, agent queries it | **Recommended** |

**Why DuckDB wins here:**

- `@duckdb/node-api` (v1.5.5, actively maintained, MIT) runs in process, no server, no daemon, prebuilt binaries so no compiler needed.
- It reads **CSV, Excel (.xlsx), JSON and Parquet directly**. The Excel extension autoloads, so `SELECT * FROM 'campaigns.xlsx'` just works. That removes an entire parsing layer.
- It is out of core, so a 500 MB CSV does not kill the Node process. That answers E2 (large files) for free.
- SQL is the language LLMs generate most reliably, by a wide margin. Far more reliable than pandas code.
- Results are computed, never estimated. Exactly what R5 asks for.

**Safety.** SQL generation still needs guardrails, and having these in the code is itself a scoring point:

- One in memory database per uploaded file per session, so nothing leaks between users.
- `SET enable_external_access = false` after the file is loaded. This blocks `read_csv('/etc/passwd')` and any network exfiltration, which is the attack that actually matters.
- Allow only single `SELECT` or `WITH` statements. Reject anything else before execution.
- Statement timeout and a row cap on results.

**Also include** `simple-statistics` (zero dependencies, tiny) for things SQL is clumsy at: linear regression, R squared, correlation, t tests.

**Explicitly avoid** `danfojs-node`. It looks like the obvious "pandas for JS" choice but it is stale since 2022 and drags in TensorFlow.js as a native build that fails on most CI and servers.

**Decision: locked.** SQL over DuckDB is the analysis path. No Python sandbox, no code interpreter, no model arithmetic.

**How this looks in practice.** The Data Analyst agent gets four tools, not one:

| Tool | Purpose |
|---|---|
| `list_datasets` | What tables exist in this session, with row counts |
| `describe_dataset` | Column names, types, null counts, `SUMMARIZE` output, 20 row sample |
| `run_sql` | Execute a validated read only query, return rows plus the query text |
| `compute_stats` | Regression, correlation, significance tests via `simple-statistics` on a query result |

The agent is instructed to always call `describe_dataset` before writing SQL. This one rule removes most hallucinated column names, which is the main failure mode of text to SQL. Every result from `run_sql` returns the SQL text alongside the numbers, and that text becomes the `method` field on the evidence entry. That is how "explain how it arrived at important conclusions" gets answered mechanically instead of by asking the model to narrate.

### 2.4 File ingestion

| Type | Library | Why |
|---|---|---|
| PDF | **`unpdf`** (v1.8.1, MIT, zero dependencies) | Pure JS, no native build, gives positioned text items |
| PDF with tables | `pdf-parse` v2 (Apache 2.0) | Note: this is a full rewrite by a new maintainer, not the old abandoned package. Has a real `getTable()` |
| Scanned PDF | Detect, then fall back | If a page yields under ~100 characters it is a scan. Render it and send to the model's vision endpoint, or use `tesseract.js`. For this assignment, **detecting and reporting it honestly is enough** and actually demonstrates R6 |
| Word | **`mammoth`** (v1.12.3, actively maintained) | `extractRawText` for model input, `convertToMarkdown` when structure matters |
| Excel | **Hand the file straight to DuckDB** | No Excel parsing library needed on the analysis path |
| CSV | **`csv-parse`** (v7, zero deps, native Node stream) | Proper streaming. Or again, straight to DuckDB |
| Text | `fs` | Trivial |

**A trap to avoid:** the `xlsx` package on npm (SheetJS). It has been frozen at version 0.18.5 since March 2022 and carries two unpatched CVEs. SheetJS moved distribution to their own CDN. Using it will make security scanners complain forever. Use ExcelJS or DuckDB instead. Knowing this is a good detail to mention in the README.

### 2.5 Documents: full context by default, RAG when a document is large

Two kinds of information, two completely different strategies. This split is itself a design decision worth stating in the README.

| Information type | Where it lives | How the agent reaches it |
|---|---|---|
| **Structured** (xlsx, csv) | DuckDB tables | SQL queries (section 2.3) |
| **Unstructured** (pdf, docx, txt, web pages) | Document store, plus a vector index only when needed | **Whole document in context, with RAG as the large document path** |

**Tabular data never goes into the prompt.** Stream the file to disk, register it in DuckDB, and put only the schema, a 20 row sample and a `SUMMARIZE` output into context. A 200,000 row spreadsheet becomes about 500 tokens, and every number comes from a real query.

**Prose goes in whole, until it cannot.** This is the reversal from my first draft, and I think it is the right call.

#### Why full context wins for normal business documents

A company brief is 3 pages. A campaign retrospective is 12. A competitor's About page is 800 words. Gemini Flash has a very large context window, so all of these fit comfortably with room to spare.

For documents that size, RAG actively makes the system worse:

| Problem with RAG on a small document | Effect |
|---|---|
| Retrieval can miss the one relevant sentence | Wrong or incomplete answer, and you cannot tell it happened |
| The model never sees document structure | "Summarise this brief" becomes unanswerable from four chunks |
| Cross references between sections are severed | Positioning on page 1 and audience on page 4 stop connecting |
| Extra embedding call plus extra retrieval call | More latency, more failure points, for no gain |

That last row matters for the grade. Their brief explicitly lists **cost and latency** and **reliability**. Adding a retrieval layer that can silently return the wrong chunk, on a document that fits in context anyway, is a reliability regression dressed up as sophistication.

#### The routing rule

At ingest, after parsing to markdown, count tokens with `gpt-tokenizer` and route:

```
parse to markdown
        |
   count tokens
        |
   +----+------------------------------+
   |                                   |
 under budget                    over budget
   |                                   |
 store whole                    chunk -> embed -> LibSQLVector
   |                                   |
 get_document(sourceId)          search_documents(query, filter)
```

Working thresholds to start with, tuned once we see real files:

| Condition | Path |
|---|---|
| Single document under about 25,000 tokens | Full context |
| All loaded documents together under about 60,000 tokens | Full context for all of them |
| Any single document over 25,000 tokens | That one document gets indexed |
| Session total over budget | Largest documents get indexed first until it fits |

Note this is **per source, not per session**. A session can hold a 3 page brief read whole and a 400 page annual report served through retrieval, at the same time. The Document agent gets both tools and the source card tells it which applies to which source.

#### Keeping citations sharp without chunking

The obvious objection to full context is that chunk metadata is what gave us page numbers. The fix is to put the markers in the text during parsing rather than in a vector store.

`unpdf` returns positioned text items, so we know the page boundaries. We emit markdown with inline markers:

```markdown
<!-- page 2 -->
## Positioning
Acme targets mid-market SaaS teams in North America...
```

The agent sees the marker next to the sentence it is quoting, so it can cite "company-brief.pdf, page 2, Positioning" straight from full context. Same citation quality, no retrieval layer. Web pages get a `retrievedAt` header the same way.

#### The RAG path, for when it triggers

Still Mastra's own stack, so no LangChain and no separate vector library:

```
MDocument.fromMarkdown()  ->  chunk()  ->  embedMany()  ->  LibSQLVector
                                                                 |
                                       agent  <-  rerank  <-  vector query tool
```

- **Chunk** with `strategy: 'semantic-markdown'` (groups related header families so a section stays whole), or `recursive` with `maxSize: 512, overlap: 50` for unstructured text.
- **Embed** with `ModelRouterEmbeddingModel('google/gemini-embedding-001')` through Mastra's model router, so it stays on the same free tier as the chat model and needs no extra package or key.
- **Store** in `LibSQLVector` from `@mastra/libsql`: one SQLite compatible file, no server, no Docker, no signup. The same file already holds Mastra memory.
- **Metadata on every chunk**: `sourceId`, `sourceName`, `sourceType`, `page`, `heading`, `chunkIndex`, `retrievedAt`. This is what lets a retrieved answer cite as precisely as a full context one.
- **Retrieve** with `createVectorQueryTool({ enableFilter: true })`. Metadata filtering lets the orchestrator scope a search to one source, which is what keeps attribution honest when several documents are loaded.
- **Re-rank** `topK: 10` down to 4 with `rerankWithScorer` and `MastraAgentRelevanceScorer` on the cheap Groq model. Business documents are full of boilerplate that scores well against any query, so re-ranking is the cheapest accuracy win available.

#### Why this is the stronger answer in the interview

"We use RAG" is what everyone says. **"We measured, and RAG is the wrong tool below about 25,000 tokens, so we route"** is an actual engineering decision with a stated threshold, a stated reason and a working implementation of both paths.

It also demonstrates the thing their brief closes with: *"A focused, well-engineered solution with thoughtful design decisions is preferable to a large system with unnecessary complexity."* Building RAG and then deliberately not using it most of the time is exactly that sentence in code.

### 2.6 Web research

| Need | Choice | Cost |
|---|---|---|
| Search | **Exa** via `exa-js` ($10 of credit every month, no card required) with **Tavily** as backup (a plain `fetch` to its REST API, no SDK; 1,000 credits/month, and Tavily is free for students) | $0 |
| Read a page | **Jina AI Reader** (`https://r.jina.ai/<url>`) | $0, no API key, 20 requests/min. Returns clean Markdown, handles JavaScript rendered pages |
| Crawl a whole company site | **Firecrawl** REST API (a plain `fetch`, no SDK; 1,000 credits/month free, no card) | $0 |
| Local fallback | `@mozilla/readability` + `jsdom` | $0 |

Jina Reader is the standout: a plain `fetch` to a URL prefix, no SDK, no key, and it returns model ready Markdown. Use it as the default page reader and keep Firecrawl for multi page company profiling.

### 2.7 Artifact generation

| Artifact | Library | Notes |
|---|---|---|
| Excel | **`exceljs`** (MIT) | Multi sheet, formulas, styling, conditional formatting. No JS library writes native Excel charts, so embed a chart PNG with `addImage()` |
| PowerPoint | **`pptxgenjs`** (v4.0.1, MIT) | **Writes native editable PowerPoint charts**, so no image pipeline needed for decks. Also does tables with auto paging, slide masters and speaker notes. Cannot open an existing .pptx template, masters must be defined in code |
| Word | **`docx`** by dolanmiu (v9.7.1, actively maintained) | Headings, tables, images, TOC. Gotcha: a Word TOC is a field, so set `features: { updateFields: true }`. Word will prompt the user to update fields on open |
| PDF | **Puppeteer HTML to PDF** | Lets one HTML template serve both the on screen preview and the PDF, with Chart.js charts rendered in the page. Heavier install than `pdfkit` but far less layout pain |
| Charts as images | **QuickChart** (`quickchart-js`, free, zero dependencies) | Send a Chart.js config, get a PNG. Use `@napi-rs/canvas` if you want it fully offline |

**Do not use** `officegen` (dead since 2021) or `chartjs-node-canvas` (depends on node-canvas, which is the number one install failure source in the Node ecosystem).

**The design point that matters most here.** The brief says: *"Generated files should contain meaningful, usable content rather than simply copying the model's response into a file."* So the pipeline must be:

```
model produces STRUCTURED JSON  ->  Zod validates it  ->  code renders the file
```

Never: model produces prose, prose gets written to a file. The model outputs a typed document plan (sections, tables, chart specs, slide objects) and deterministic code turns that into the .xlsx / .pptx / .docx. That separation is the single clearest signal of good engineering in this assignment.

### 2.8 Mastra Skills: how each artifact knows what "good" looks like

The Zod schema in 2.7 guarantees an artifact is *structurally* valid. It says nothing about whether the deck is any good. That gap is what **Mastra Skills** fill.

A Skill is a reusable instruction file an agent loads on demand. Mastra gives every agent with skills three automatic tools: `skill` (load one), `skill_read` (open a reference file inside it), `skill_search` (find one). The agent pulls in only what it needs, when it needs it.

#### The three way separation

This is the cleanest idea in the whole build and the thing I would lead with in the interview.

| Layer | Owns | Form |
|---|---|---|
| **Skill** | How to write a *good* one | Markdown instructions plus example references |
| **Zod schema** | What shape it must be | TypeScript type |
| **Renderer** | How it becomes a file | Deterministic code (exceljs, pptxgenjs, docx) |

Editorial judgment, structure and rendering are three different problems. Most submissions will jam all three into one giant prompt. Splitting them means you can improve deck quality by editing a markdown file without touching a line of code, and the skill file is readable by a non engineer.

#### The skills we build

| Skill | Teaches the agent |
|---|---|
| `campaign-report` | Executive summary first, findings ordered by business impact, every number carries an evidence ID, no recommendation without a supporting figure |
| `excel-workbook` | Standard sheet layout (Summary, Data, Calculations, Sources), which cells are live formulas rather than pasted values, number and percent formats, no merged cells |
| `client-presentation` | Narrative arc (situation, complication, resolution), one message per slide, slide count guidance, which chart type fits which claim, speaker notes on every slide |
| `campaign-plan` | Required sections: objective, audience, channel mix, budget split, timeline, KPIs, risks |
| `content-brief` | Audience, angle, key messages, outline, tone, call to action |
| `evidence-citation` | The house rule every artifact skill inherits: cite evidence IDs, never assert an unsourced number, flag gaps explicitly |

Each skill carries a `references/` folder with a worked example plan and a short style guide, read via `skill_read` only when the agent needs it.

```ts
import { createSkill } from '@mastra/core/skills'

export const clientPresentation = createSkill({
  name: 'client-presentation',
  description: 'How to structure a persuasive client facing deck',
  instructions: `One message per slide, stated as the slide title...`,
  references: {
    'example-plan.json': examplePlan,
    'chart-selection.md': chartGuide,
  },
})
```

Skills can be defined inline in code or read from `SKILL.md` files on disk. **Use the filesystem form** (`skills/client-presentation/SKILL.md`) so they are visible as documents in the repository. A reviewer browsing the repo can read exactly what the system knows about deck writing without reading TypeScript, which is good for the grade.

#### Why this also fixes cost and latency (E12)

Skills load **on demand**, not upfront. Without them, every artifact instruction lives permanently in the system prompt and you pay for the Excel guidance on every single turn, including "hello". With skills, the deck guidance enters context only when someone asks for a deck. Mastra also supports resolving skills dynamically from request context, so the set available can be narrowed further per request.

That is a real, measurable token argument, not a hand wave, and it is exactly the kind of thing "cost and latency" is asking about.

### 2.9 Chat UI

| Option | Effort | Demo quality |
|---|---|---|
| Mastra Studio only (`mastra dev`, localhost:4111) | Zero | Fine for tool call traces, but looks like a dev tool |
| **Next.js + assistant-ui + `@mastra/ai-sdk`** | Half a day | **Proper chat UI with file upload, streaming and download links** |
| Build a chat UI from scratch | Two days | Not worth it |

**Recommendation:** Next.js with assistant-ui. It has an official Mastra integration, `npx assistant-ui@latest init` scaffolds it, and streaming works out of the box through `toAISdkStream`. Keep Mastra Studio running alongside during the demo to show the agent traces, which is genuinely impressive and costs nothing.

(Updated 26 Sep 2026: conversation history comes from Mastra Memory, converted with `toAISdkMessages` from `@mastra/ai-sdk/ui`. File previews reuse the ingestion libraries (exceljs, csv-parse, mammoth) plus **`jszip`** to read a .pptx's slide XML; jszip was already installed as a dependency of pptxgenjs, exceljs, docx and mammoth. See docs/DECISIONS.md D-49 and D-50.)

### 2.10 Final stack summary

```
Framework      Mastra (agents, subagents, workflows, memory, RAG, skills, studio)
Language       TypeScript
Models         Gemini Flash (primary) + Groq (fast tier) via AI SDK providers
Embeddings     google/gemini-embedding-001 via Mastra's model router (same free tier)

Structured     DuckDB (@duckdb/node-api) + simple-statistics
               -> SQL tools: list / describe / run_sql / compute_stats

Unstructured   Token count at ingest decides the path, per source

               under ~25k tokens  -> whole markdown in context
                                     get_document(sourceId)
                                     page markers inline for citations

               over  ~25k tokens  -> Mastra RAG
                                     MDocument -> chunk -> embedMany
                                     -> LibSQLVector
                                     -> createVectorQueryTool (filtered)
                                     -> rerankWithScorer

Ingest         unpdf (PDF), mammoth (DOCX to markdown), csv-parse, DuckDB (XLSX)
Research       Exa or Tavily (search) + Jina Reader (page read) + Firecrawl (crawl)

Artifacts      Skill (quality) + Zod (structure) + renderer (file)
               exceljs, pptxgenjs, docx, Puppeteer (PDF), QuickChart (chart images)

Memory         Mastra Memory + LibSQL
Storage        ONE LibSQL file holds memory, vectors and the evidence ledger
UI             Next.js + assistant-ui
Validation     Zod everywhere (tool inputs, artifact plans, analysis results)

Total recurring cost: $0
```

Worth noting: memory, vectors and the evidence ledger all live in a single LibSQL file. A reviewer can clone the repo, run one command and have a working system with no Docker, no Postgres and no cloud signup. That is a real engineering practices point.

---

## Part 3: Early shape of the system (preview)

Full architecture and module design comes next, but here is the shape so you can react to it before we go deeper.

### 3.1 Agent topology

Two levels only, following Mastra's own lesson from the `.network()` deprecation.

```
                       ORCHESTRATOR AGENT
                (understands intent, plans, delegates,
                 synthesises the final conversational answer)
                                |
     +---------------+----------+---------+------------------+
     |               |                    |                  |
 DATA ANALYST   DOCUMENT AGENT       RESEARCH AGENT      ARTIFACT
    AGENT                                                WORKFLOWS
     |               |                    |                  |
 describe        get_document          web search      author (agent
 run_sql         (small: whole doc)     page read       + SKILL)
 compute_stats   search_documents       crawl               |
     |           (large: RAG)               |           validate (Zod)
   DuckDB              |                    |                |
                 doc store +          Exa / Jina        render (code)
                 LibSQLVector                                 |
                                                      xlsx pptx docx pdf

                    ALL WRITE INTO -> EVIDENCE LEDGER
```

Two things to notice in that picture.

**The artifact side is a workflow, not a free roaming agent.** Building a file is a known sequence: pick the right Skill, author a typed plan, validate it, render it, store it, return a link. Only the authoring step needs a model, and even that is bounded by a Zod schema. The rest is deterministic code that cannot wander off, is unit testable, and costs nothing. The contrast (agents where the path is unknown, workflows where it is known) is the strongest architectural argument we can make, and it is Mastra's own stated default.

**Every specialist writes into the evidence ledger.** SQL results, retrieved chunks and web pages all become evidence entries in the same format. The orchestrator then reasons over evidence, not over raw tool output. That is what lets a single answer honestly combine a number from a spreadsheet, a claim from a PDF and a fact from a competitor's website.

### 3.2 The idea that separates this from an average submission

**An evidence ledger.**

Every fact that enters the system gets an ID and a source:

```
E1  "Email campaign conversion rate = 4.2%"
    source: computed
    origin: campaigns.xlsx
    method: SELECT SUM(conversions)/SUM(clicks) FROM campaigns WHERE channel='Email'
    value: 0.0423

E2  "Company targets mid-market SaaS teams in North America"
    source: document
    origin: company-brief.pdf, page 2

E3  "Competitor launched a free tier in August 2026"
    source: web
    origin: https://example.com/blog/free-tier, retrieved 2026-09-22
```

Every downstream artifact and every chat answer cites these IDs. This single mechanism answers four graded criteria at once:

- **R6 no fabrication:** if there is no evidence ID, the agent must say the data is unavailable rather than invent it
- **R7 traceability:** every claim points at a query, a page number or a URL
- **E5 multiple sources:** each fact knows which source it came from
- **E9 conflicting information:** when two evidence items disagree, show both with both sources instead of silently picking one

It is also cheap to build. It is a typed store plus a rule in the agent instructions.

### 3.3 The nine modules

| Module | Job |
|---|---|
| M1 Source Registry and Ingestion | Detect file type, parse, register, profile, produce a "source card" |
| M2 Analysis Engine | DuckDB session, safe SQL execution, statistics tools |
| M3 Document Store | Markdown conversion with inline page markers, token counting, and the routing decision: whole document in context by default, chunk plus embed plus LibSQLVector retrieval only for large sources |
| M4 Research Module | Web search, page reading, site crawling |
| M5 Evidence Ledger | The grounding spine described above |
| M6 Artifact Factory | Skills (quality rules) plus Zod plans plus renderers, producing xlsx, pptx, docx and pdf |
| M7 Orchestration | Orchestrator agent, three subagents, delegation contracts |
| M8 Session and Memory | Mastra memory plus a compact manifest of loaded sources and prior findings |
| M9 Reliability Layer | Typed errors, retries, graceful degradation, unsupported request handling, cost and latency controls |

---

## Part 4: Suggested plan for the six days

| Day | Focus |
|---|---|
| Tue 22 | Lock the architecture and module design. Scaffold the Mastra project. Get one agent answering in Studio |
| Wed 23 | M1 ingestion plus M2 DuckDB analysis. Ask real questions of a real spreadsheet and get real numbers |
| Thu 24 | M3 document store: markdown with page markers, token counting and routing. Full context path first, then the RAG path for large sources. Plus M4 research and M5 evidence ledger. Cross source reasoning working |
| Fri 25 | M6 artifact factory: write the Skills first, then the Zod plans, then the renderers. Excel and PowerPoint before Word or PDF |
| Sat 26 | M7 orchestration tightened, M9 reliability, Next.js chat UI |
| Sun 27 | README, demo scenario, sample data, record the demo, generate the two required artifacts |
| Mon 28 AM | Buffer, final review, submit before 12:00 PM |

Build the demo dataset early, on day two, not on day seven. A realistic fictional company plus a campaign spreadsheet plus a company brief PDF is what every later step gets tested against.

---

## Sources

- [Mastra Docs: Agents](https://mastra.ai/docs/agents/overview)
- [Mastra Docs: Subagents](https://mastra.ai/docs/subagents)
- [Mastra Docs: Workflows](https://mastra.ai/docs/workflows/overview)
- [Mastra Docs: Suspend and Resume](https://mastra.ai/docs/workflows/suspend-and-resume)
- [Mastra Docs: Memory](https://mastra.ai/docs/memory/overview)
- [Mastra Docs: Studio](https://mastra.ai/docs/studio/overview)
- [Mastra Docs: Sandboxes](https://mastra.ai/docs/sandbox/overview)
- [Mastra Docs: RAG overview](https://mastra.ai/docs/rag/overview)
- [Mastra Docs: Chunking and embedding](https://mastra.ai/docs/rag/chunking-and-embedding)
- [Mastra Docs: Vector databases](https://mastra.ai/docs/rag/vector-databases)
- [Mastra Docs: Retrieval and re-ranking](https://mastra.ai/docs/rag/retrieval)
- [Mastra Reference: libSQL vector store](https://mastra.ai/reference/vectors/libsql)
- [Mastra Docs: Skills](https://mastra.ai/docs/skills)
- [Mastra Blog: Multi-agent orchestration](https://mastra.ai/blog/multi-agent-orchestration)
- [Analysis of Mastra's .network() to Supervisor migration](https://dev.to/jackchenme/5-walls-multi-agent-frameworks-hit-receipts-from-mastras-year-of-network-to-supervisor-3am3)
- [assistant-ui: Mastra full-stack integration](https://www.assistant-ui.com/docs/integrations/frameworks/mastra/full-stack)
- [DuckDB Node Neo client](https://duckdb.org/docs/stable/clients/node_neo/overview.html)
- [DuckDB Excel extension](https://duckdb.org/docs/stable/core_extensions/excel)
- [unpdf](https://github.com/unjs/unpdf)
- [mammoth.js](https://github.com/mwilliamson/mammoth.js)
- [SheetJS npm registry notice](https://docs.sheetjs.com/docs/getting-started/installation/nodejs)
- [PptxGenJS charts](https://gitbrent.github.io/PptxGenJS/docs/api-charts/)
- [docx.js.org](https://docx.js.org/)
- [Jina AI Reader](https://jina.ai/reader/)
- [Exa pricing](https://exa.ai/pricing)
- [Tavily pricing](https://tavily.com/pricing)
- [Firecrawl pricing](https://www.firecrawl.dev/pricing)
- [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Groq rate limits](https://console.groq.com/docs/rate-limits)
