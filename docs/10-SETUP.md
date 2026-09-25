# Setup

## Prerequisites

- Node 22 or later (`node -v`). Several dependencies require it
- npm 10 or later
- Git

## 1. Scaffold Mastra

This kit deliberately ships no `package.json`, so the Mastra scaffolder runs cleanly into it.

```bash
cd D:\Projects\business-operations-assitant
npm create mastra@latest .
```

When prompted, choose agents and workflows, and pick Google as the provider. Move any files it places under a different `src/mastra` path to match the structure in `AGENTS.md`.

## 2. Install the stack

```bash
# Mastra
npm i @mastra/core @mastra/memory @mastra/libsql @mastra/rag @mastra/ai-sdk

# Models
npm i ai @ai-sdk/google @ai-sdk/groq

# Analysis
npm i @duckdb/node-api simple-statistics

# Ingestion
npm i unpdf mammoth csv-parse gpt-tokenizer

# Artifacts
npm i exceljs pptxgenjs docx quickchart-js

# Validation and tests
npm i zod
npm i -D vitest @types/node typescript tsx

# Optional, PDF artifacts only
npm i puppeteer
```

**Do not install `xlsx`.** The npm copy is frozen at 0.18.5 from 2022 and carries unpatched CVEs. Use `exceljs` for writing and DuckDB for reading. See `06-RESEARCH-STACK.md`.

**Do not install `danfojs-node`.** Stale since 2022 and pulls TensorFlow.js as a native build that fails on most machines.

## 3. Keys

```bash
cp .env.example .env
```

Fill in, in this order of importance:

| Key | Where | Needed for |
|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | https://aistudio.google.com/apikey | Everything. Chat model and embeddings |
| `GROQ_API_KEY` | https://console.groq.com/keys | The fast tier, re-ranking, and the automatic fallback whenever Gemini fails or runs out of quota |
| `EXA_API_KEY` | https://exa.ai | Web search |
| `TAVILY_API_KEY` | https://tavily.com | Search fallback. Free for students |
| `FIRECRAWL_API_KEY` | https://firecrawl.dev | Site crawling. Optional |
| `JINA_API_KEY` | https://jina.ai/reader | Optional. Page reading works with no key at 20 rpm |

Check your live Gemini quota at https://aistudio.google.com/rate-limit before the demo. Google removed the per model table from the docs. With `GROQ_API_KEY` set, a spent Gemini quota no longer stops the chat: each step falls back to Groq automatically (docs/DECISIONS.md D-48). Set `MODEL_FALLBACK=off` to pin Gemini alone, for example to reproduce a Gemini specific failure.

## 4. Run

```bash
npm run dev                  # Mastra Studio at localhost:4111
cd app && npm run dev        # Next.js chat UI at localhost:3000
npm test                     # Vitest
npm run eval                 # the four grounding evals
```

### Using the chat UI

| Area | What it does |
|---|---|
| Left sidebar | Every past conversation, newest first, grouped by day. Search, rename or delete from the `...` menu. Click one to reopen it where you left off, files included. The open chat is in the URL (`?c=<id>`), so a refresh keeps it |
| Composer | Type a question, or attach files with the paperclip or by dropping them on the box. Attached files show as chips until you send |
| Files button (top right) | The chat's uploaded sources with their status, and every generated file with a download button |
| Preview panel | Click any source, chip, or file link in an answer to open it beside the chat: spreadsheets as a table, PDFs in the browser viewer, Word documents as pages, decks as a slide outline |

## 5. Verify

```bash
mkdir -p data
npm run dev
```

Open localhost:4111, chat with an agent, confirm traces appear. If the model errors, the key is wrong or the quota is spent.

---

## Working with AI coding agents

**Claude Code:** run `claude` in the project root. It reads `CLAUDE.md`, which points at `AGENTS.md`. Two slash commands are provided: `/build-module <name>` and `/review-grounding`.

**Antigravity:** point it at the project root. It reads `AGENTS.md` directly.

Both: start a task by naming the module and the day from `07-BUILD-PLAN.md`. The full phased prompt book, one prompt per working session, is in `docs/PROMPTBOOK.md`.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| DuckDB install fails | Node under 22. Upgrade |
| `Cannot find module '@mastra/...'` in Next.js | Add `serverExternalPackages: ["@mastra/*"]` to `next.config.mjs` |
| Embedding calls fail | Gemini quota. Check AI Studio, or switch the embedding tier in `models.ts` |
| Turn dies around 30 seconds | `maxDuration` in the API route. Raise it to 60 and move long work to a workflow run |
| Puppeteer download fails | Skip PDF artifacts. They are first on the cut list |
| Every answer says both providers are rate limited | Gemini's daily quota is spent and the Groq fallback also hit its 8,000 tokens per minute limit. Wait a minute, or check `GROQ_API_KEY` is set |
| A reopened chat cannot query its spreadsheet after a server restart | The DuckDB session is in memory. Upload the file again in that chat; its messages and file list were kept (D-49) |
| The sidebar is empty but chats existed | The chat UI reads Mastra Memory from `DATABASE_URL`. Check it points at the same `data/app.db` the chats were written to |
