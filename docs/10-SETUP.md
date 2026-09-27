# Setup

Written for a reviewer starting from a clean clone. Every command runs from the repository root unless it says otherwise.

## Prerequisites

- Node 22.13 or later (`node -v`). `package.json` pins `"engines": { "node": ">=22.13.0" }`, and DuckDB and Mastra both need it
- npm 10 or later (ships with Node 22)
- Git
- Network access on first use: `npm install` downloads the DuckDB native binary for your platform and a Chromium build for puppeteer (PDF artifacts only), and DuckDB downloads its `excel` extension the first time an `.xlsx` file is read

No compiler toolchain is needed: `@duckdb/node-api` installs a prebuilt binary for the platform (Windows x64, macOS, Linux).

## 1. Clone and install

```bash
git clone https://github.com/AyushmaanNaruka/ai-business-operations-assistant.git
cd ai-business-operations-assistant
npm install
```

One `npm install` at the root installs both the Mastra backend and the Next.js chat UI: `app/` is an npm workspace. Do not run `npm install` inside `app/` separately, and do not run `npm audit fix --force` (the two remaining low severity advisories are explained in the README trade-offs table).

## 2. Keys

```bash
cp .env.example .env
```

`.env` stays at the repository root. The chat UI loads it from there (`app/next.config.ts`), so there is no second `.env` inside `app/`.

**Required: at least one model provider key.** Every model tier is a fallback chain built from the providers that have a key, paid first, then free (`src/mastra/models.ts`). With no provider key set, nothing can answer. The cheapest complete setup is the two free keys, Gemini plus Groq.

| Key | Where | Needed for |
|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | https://aistudio.google.com/apikey | Free tier. Chat models (Gemini 2.5 Flash, then Gemini 3.5 Flash Lite) and the embedding model for large documents |
| `GROQ_API_KEY` | https://console.groq.com/keys | Free tier. The fast routing tier, re-ranking, and the last fallback when Gemini's quota runs out |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys | Optional, paid. When set, Claude (`claude-sonnet-5`, with `claude-haiku-4-5` for routing) becomes the primary model, with prompt caching on |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys | Optional, paid. GPT models, and OpenAI embeddings when there is no Gemini key |

**Embeddings need Gemini or OpenAI.** Anthropic and Groq offer no embedding model. Documents under about 25,000 tokens go into context whole and need no embeddings, so the sample files work on any provider; a larger document is chunked and embedded, and that path needs `GOOGLE_GENERATIVE_AI_API_KEY` or `OPENAI_API_KEY`.

**Optional: web research.** Without a search key, research requests are reported as unavailable rather than answered from the model's memory.

| Key | Where | Needed for |
|---|---|---|
| `EXA_API_KEY` | https://exa.ai | Web search, tried first |
| `TAVILY_API_KEY` | https://tavily.com | Web search fallback. Free for students. One of Exa or Tavily is enough |
| `FIRECRAWL_API_KEY` | https://firecrawl.dev | Optional. Site crawling; without it the crawler follows the homepage's own links |
| `JINA_API_KEY` | https://jina.ai/reader | Optional. Page reading works with no key at 20 requests a minute; a key raises it to 500 |

Everything else in `.env.example` has a working default and can stay as it is for a local run.

Check your live Gemini quota at https://aistudio.google.com/rate-limit before a demo. Google removed the per model table from the docs. A spent Gemini quota no longer stops the chat: each step falls back to Gemini 3.5 Flash Lite (a separate daily quota on the same key), then to Groq if `GROQ_API_KEY` is set (docs/DECISIONS.md D-48, D-53). The free tier for `gemini-2.5-flash` allows only 20 requests a day, which a few multi specialist questions use up. Set `MODEL_FALLBACK=off` to pin the first model alone, for example to reproduce a Gemini specific failure.

## 3. Run

```bash
npm run dev --workspace app   # the chat UI at http://localhost:3000 (same as: cd app && npm run dev)
npm run dev                   # optional: Mastra Studio at http://localhost:4111
```

The chat UI is the app. It runs the Mastra agents in its own Next.js server process, so it works on its own. Mastra Studio is a second, optional process for inspecting agents, workflows and traces; run it in another terminal if you want it. Both read the same `.env` and the same `data/app.db`.

To try it, open http://localhost:3000, attach the files in `samples/` and ask one of the questions in `docs/08-DEMO-SCENARIOS.md`, for example "Analyze this campaign data and tell me what performed well and what didn't".

### Where files land

| Path | What |
|---|---|
| `data/app.db` | Conversations (Mastra Memory), the evidence ledger and document vectors, in one LibSQL file. Created on first run. Set by `DATABASE_URL` |
| `data/uploads/`, `data/documents/` | Uploaded files and their parsed text |
| `generated/` | Every artifact the app produces (xlsx, pptx, docx, pdf), versioned, never overwritten. Downloadable from the Files button in the chat UI |
| `samples/generated/` | The artifacts committed for submission, copied from `generated/` after a run of scenario A |

`data/` contents and `generated/` are git ignored. Delete them to start from nothing.

### Sample files

`samples/` holds the Northwind demo set described in `docs/08-DEMO-SCENARIOS.md`: `campaigns.xlsx` (1,203 rows, 11 columns, with deliberate duplicates, mixed date formats and missing revenue), `northwind-brief.pdf`, `customer-notes.docx` (which contradicts the spreadsheet on Paid Social) and `research-requirements.txt` (six stakeholder questions, which the app proposes as tasks rather than running, per rule 4 in `AGENTS.md`). `npm run samples` regenerates `campaigns.xlsx` deterministically; the other files come from `scripts/make-brief-pdf.ts` and `scripts/make-customer-notes.ts`.

## 4. Tests and evals

```bash
npm test          # unit, integration and wire tests. No API key, no network, no model calls
npm run eval      # the four live grounding evals in tests/grounding/
```

`npm test` is the full offline suite and should pass on a clean clone.

`npm run eval` makes real model calls and needs a filled in `.env` (it loads it with `node --env-file=.env`, so it fails at once if the file is missing). It runs the files one after another, takes a few minutes, and spends quota: on the free tier it can fail for quota reasons rather than grounding reasons. A paid key is the reliable way to run it. `tests/grounding/README.md` explains what each eval checks.

## 5. Choosing models

Every provider with a key set is used, paid first: Anthropic, then OpenAI, then Gemini, then Groq, each tier falling back down that list. Three settings adjust it (all in `.env.example`, details in docs/DECISIONS.md D-54):

| Setting | Effect |
|---|---|
| `MODEL_PROVIDERS=anthropic,openai` | Only these providers are ever called, even if other keys are present. Use it with company data: free tiers may use prompts to improve their models |
| `MODEL_ANALYST=anthropic/claude-sonnet-5,openai/gpt-5.5` (and `MODEL_WRITER`, `MODEL_ROUTER`, `MODEL_RERANK`, `MODEL_EMBEDDER`) | Replaces that tier's chain |
| `MODEL_FALLBACK=off` | Only the first available model per tier |

The sidebar footer shows the model in use and how many fallbacks stand behind it.

## 6. Sharing it with a team

Before anyone else uses it, work through the checklist in `docs/11-SECURITY.md` section 5. The essentials: set `APP_ACCESS_PASSWORD`, serve over HTTPS, set `MODEL_PROVIDERS` to paid providers only, and run the production build (`npm run build --workspace app && npm run start --workspace app`), since dev mode relaxes the content security policy.

## 7. Using the chat UI

| Area | What it does |
|---|---|
| Left sidebar | Every past conversation, newest first, grouped by day. Search, rename or delete from the `...` menu. Click one to reopen it where you left off, files included. The open chat is in the URL (`?c=<id>`), so a refresh keeps it |
| Composer | Type a question, or attach files with the paperclip or by dropping them on the box. Attached files show as chips until you send |
| Files button (top right) | The chat's uploaded sources with their status, and every generated file with a download button |
| Preview panel | Click any source, chip, or file link in an answer to open it beside the chat: spreadsheets as a table, PDFs in the browser viewer, Word documents as pages, decks as a slide outline |

## Dependency notes

**Do not install `xlsx`.** The npm copy is frozen at 0.18.5 from 2022 and carries unpatched CVEs. The project uses `exceljs` for writing and DuckDB for reading. See `06-RESEARCH-STACK.md`.

**Do not install `danfojs-node`.** Stale since 2022 and pulls TensorFlow.js as a native build that fails on most machines.

A new dependency that is not in `06-RESEARCH-STACK.md` needs its reason appended to `docs/DECISIONS.md`.

---

## Working with AI coding agents

**Claude Code:** run `claude` in the project root. It reads `CLAUDE.md`, which points at `AGENTS.md`. Two slash commands are provided: `/build-module <name>` and `/review-grounding`.

**Antigravity:** point it at the project root. It reads `AGENTS.md` directly.

Both: start a task by naming the module and the day from `07-BUILD-PLAN.md`. The full phased prompt book, one prompt per working session, is in `docs/PROMPTBOOK.md`.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `npm install` fails on `@duckdb/node-api` | Node under 22.13, or no network to fetch the prebuilt binary. Upgrade Node and retry |
| The first `.xlsx` upload fails with an extension or HTTP error | DuckDB downloads its `excel` extension on first use and caches it under `~/.duckdb/extensions`. Allow network access once (a proxy or offline machine blocks it), then retry. CSV files do not need it |
| `npm run eval` fails straight away with a missing file error | There is no `.env` at the repository root. Run `cp .env.example .env` and add keys |
| Every answer says every free tier model is rate limited | Both Gemini models' daily quotas are spent (they reset at midnight Pacific) and Groq hit its 8,000 tokens per minute limit, which one tool heavy turn can exceed. Wait a minute and retry, check the live quota at https://aistudio.google.com/rate-limit, or add a paid key |
| A multi step data question stops part way on the free tier | Scenario A needs more requests than the free quotas allow in a day (README, Testing status). Use a paid key for a full run |
| Embedding calls fail | Gemini quota, or no Gemini or OpenAI key (only needed for documents over about 25,000 tokens). Check AI Studio, or set `MODEL_EMBEDDER` |
| Puppeteer download fails during `npm install` | Only PDF artifacts need it. Set `PUPPETEER_SKIP_DOWNLOAD=1` and reinstall; xlsx, pptx and docx still work |
| A reopened chat cannot query its spreadsheet after a server restart | The DuckDB session is in memory. Upload the file again in that chat; its messages and file list were kept (D-49) |
| The browser keeps asking for a password | `APP_ACCESS_PASSWORD` is set. Any user name works unless `APP_ACCESS_USER` is set too |
| "Too many requests. Please wait..." | A rate limit (docs/11-SECURITY.md). Raise `RATE_LIMIT_CHAT_PER_MINUTE`, or set `TRUST_PROXY=1` behind a proxy so each client gets its own limit |
| "A model provider rejected its API key" | Every model in the chain failed and the last error was an authentication error. Check the keys in `.env` |
| Research says an address is "private or internal" | The SSRF guard (D-55). Only public web addresses are read; `RESEARCH_ALLOW_PRIVATE_URLS=1` lifts it in a trusted single user setup |
| The sidebar is empty but chats existed | The chat UI reads Mastra Memory from `DATABASE_URL`. Check it points at the same `data/app.db` the chats were written to |
