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
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys | Optional, paid. When set, Claude (`claude-opus-5`, `claude-haiku-4-5`) becomes the primary model |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys | Optional, paid. GPT models, and OpenAI embeddings when there is no Gemini key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | https://aistudio.google.com/apikey | The free development setup: chat model and embeddings |
| `GROQ_API_KEY` | https://console.groq.com/keys | The fast tier, re-ranking, and the automatic fallback whenever Gemini fails or runs out of quota |
| `EXA_API_KEY` | https://exa.ai | Web search |
| `TAVILY_API_KEY` | https://tavily.com | Search fallback. Free for students |
| `FIRECRAWL_API_KEY` | https://firecrawl.dev | Site crawling. Optional |
| `JINA_API_KEY` | https://jina.ai/reader | Optional. Page reading works with no key at 20 rpm |

Check your live Gemini quota at https://aistudio.google.com/rate-limit before the demo. Google removed the per model table from the docs. A spent Gemini quota no longer stops the chat: each step falls back to Gemini 3.5 Flash Lite (a separate daily quota on the same key), then to Groq if `GROQ_API_KEY` is set (docs/DECISIONS.md D-48, D-53). The free tier for `gemini-2.5-flash` allows only 20 requests a day, which a few multi specialist questions use up. Set `MODEL_FALLBACK=off` to pin Gemini alone, for example to reproduce a Gemini specific failure.

## 4. Run

```bash
npm run dev                  # Mastra Studio at localhost:4111
cd app && npm run dev        # Next.js chat UI at localhost:3000
npm test                     # Vitest
npm run eval                 # the four grounding evals
```

### Choosing models

Every provider with a key set is used, paid first: Anthropic, then OpenAI, then Gemini, then Groq, each tier falling back down that list. Three settings adjust it (all in `.env.example`, details in docs/DECISIONS.md D-54):

| Setting | Effect |
|---|---|
| `MODEL_PROVIDERS=anthropic,openai` | Only these providers are ever called, even if other keys are present. Use it with company data: free tiers may use prompts to improve their models |
| `MODEL_ANALYST=anthropic/claude-sonnet-5,openai/gpt-5.5` (and `MODEL_WRITER`, `MODEL_ROUTER`, `MODEL_RERANK`, `MODEL_EMBEDDER`) | Replaces that tier's chain |
| `MODEL_FALLBACK=off` | Only the first available model per tier |

The sidebar footer shows the model in use and how many fallbacks stand behind it.

### Sharing it with a team

Before anyone else uses it, work through the checklist in `docs/11-SECURITY.md` section 5. The essentials: set `APP_ACCESS_PASSWORD`, serve over HTTPS, set `MODEL_PROVIDERS` to paid providers only, and run the production build (`cd app && npm run build && npm run start`), since dev mode relaxes the content security policy.

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
| Every answer says every free tier model is rate limited | Both Gemini models' daily quotas are spent (they reset at midnight Pacific) and Groq hit its 8,000 tokens per minute limit, which one tool heavy turn can exceed. Wait a minute and retry, or check the live quota at https://aistudio.google.com/rate-limit |
| A reopened chat cannot query its spreadsheet after a server restart | The DuckDB session is in memory. Upload the file again in that chat; its messages and file list were kept (D-49) |
| The browser keeps asking for a password | `APP_ACCESS_PASSWORD` is set. Any user name works unless `APP_ACCESS_USER` is set too |
| "Too many requests. Please wait..." | A rate limit (docs/11-SECURITY.md). Raise `RATE_LIMIT_CHAT_PER_MINUTE`, or set `TRUST_PROXY=1` behind a proxy so each client gets its own limit |
| "A model provider rejected its API key" | Every model in the chain failed and the last error was an authentication error. Check the keys in `.env` |
| Research says an address is "private or internal" | The SSRF guard (D-55). Only public web addresses are read; `RESEARCH_ALLOW_PRIVATE_URLS=1` lifts it in a trusted single user setup |
| The sidebar is empty but chats existed | The chat UI reads Mastra Memory from `DATABASE_URL`. Check it points at the same `data/app.db` the chats were written to |
