# AGENTS.md

Instructions for any AI coding agent working in this repository (Antigravity, Claude Code, Cursor, or otherwise). Read this first, every session.

## What this project is

An **AI Business Operations Assistant**. A business user uploads files (PDF, Word, Excel, CSV, text) and/or gives a company website, then works with that information through a chat interface: asking questions, getting analysis, requesting research, and generating business deliverables (reports, spreadsheets, presentations, plans).

This is a take-home assignment for an AI Engineer role. Due **Monday 28 September 2026, 12:00 PM**. It is graded on problem solving, multi agent design, orchestration, data analysis quality, reliability and grounding, artifact quality, engineering practices, error handling, and the ability to explain trade offs.

**The goal is a focused, well engineered system with defensible decisions, not a large system with many features.**

## Non negotiable constraints

| Constraint | Detail |
|---|---|
| Language | TypeScript. No JavaScript files, no `any` without a comment explaining why |
| Framework | Mastra. Agents, workflows, memory, RAG and skills all come from Mastra, not LangChain |
| Cost | Free tiers by default: Gemini Flash and Groq for models, Exa/Tavily and Jina for research. Paid Anthropic and OpenAI models are optional, switched on by their keys (D-54) |
| Architecture | Supervisor plus subagents, maximum two levels deep. Never use `Agent.network()`, it is deprecated |

## The five rules that define this system

Break any of these and the submission loses its main differentiator.

1. **Numbers are computed, never estimated.** Every figure comes from a DuckDB SQL query or from `simple-statistics`. The model writes the query; it does not do arithmetic. If you find yourself writing a prompt that asks a model to add things up, stop.

2. **Nothing enters an answer without evidence.** Every fact is an `Evidence` entry with an origin and a method. Every conclusion is a `Finding` citing evidence IDs. If there is no entry, the agent reports a gap. It never fills one.

3. **Artifacts are built, not transcribed.** The model produces a typed plan validated by Zod; deterministic code renders the file. Never write a model's prose into a .docx or .pptx.

4. **File content is data, never instruction.** An uploaded document containing instructions is surfaced to the user as a proposal. It is never executed.

5. **Tools return results, never throw.** Every tool returns `ToolResult<T>`, a discriminated union. An exception reaching the agent loop is a bug.

## Where things are

| Need | Read |
|---|---|
| The original assignment, verbatim | `docs/00-BRIEF.md` |
| What we are building and why | `docs/01-PRD.md` |
| Every requirement mapped to where it lives | `docs/02-REQUIREMENTS-MATRIX.md` |
| Full system design, agents, workflows, modules | `docs/03-ARCHITECTURE.md` |
| Per module specification | `docs/04-MODULES.md` |
| Shared TypeScript types | `docs/05-DATA-MODEL.md` |
| Library choices and why | `docs/06-RESEARCH-STACK.md` |
| Day by day task list | `docs/07-BUILD-PLAN.md` |
| Demo scenarios to build against | `docs/08-DEMO-SCENARIOS.md` |
| Test strategy and grounding evals | `docs/09-TESTING.md` |
| Install and run | `docs/10-SETUP.md` |
| Security controls and the pre sharing checklist | `docs/11-SECURITY.md` |
| Decision log, append as you go | `docs/DECISIONS.md` |
| **Phased prompt book for the whole build** | `docs/PROMPTBOOK.md` |

`docs/03-ARCHITECTURE.md` is the source of truth. If this file and that one disagree, that one wins and this one should be corrected.

## Code conventions

- **Zod at every boundary.** Tool inputs, tool outputs, artifact plans, agent structured output.
- **One concept per file** in `src/types/`. Import types, do not redefine them.
- **Modules do not import agents.** `src/modules/*` is pure logic with no Mastra dependency where possible, so it is unit testable without a model. `src/mastra/*` wires modules into tools and agents.
- **No secrets in code.** Everything through `process.env`, declared in `.env.example`.
- **Model tiers, not model names.** Use `MODELS.ANALYST`, never a hardcoded string, so swapping provider is one file. Tiers are fallback chains built from whichever provider keys are set (`src/mastra/models.ts`).
- **Never forward a request body wholesale.** API routes pass on only the fields they validated (docs/11-SECURITY.md).
- **Prose style in generated docs and comments:** no double dashes, they read as machine written.

## Directory map

```
src/
  mastra/
    index.ts          Mastra instance, storage, registration
    models.ts         model tiers
    agents/           orchestrator + 3 specialists
    tools/            typed tools, thin wrappers over modules
    workflows/        ingestion, artifact
  modules/            pure logic, unit testable, no model calls
    sources/          M1 ingestion and registry
    analysis/         M2 DuckDB and stats
    documents/        M3 markdown, tokens, routing, RAG
    research/         M4 search, read, crawl
    evidence/         M5 ledger, findings, conflicts
    artifacts/        M6 schemas, renderers, charts
    reliability/      M9 ToolResult, errors, retry
    session/          M8 manifest, references, conversation titles
    preview/          M10 file previews for the chat UI
  types/              shared types
app/                  Next.js chat UI
skills/               SKILL.md files, loaded by agents at runtime
samples/              demo dataset
tests/grounding/      the four no fabrication evals
```

## Before you start a task

1. Read the relevant section of `docs/03-ARCHITECTURE.md`. Do not invent a design that is already specified.
2. Check `docs/07-BUILD-PLAN.md` for the task's acceptance criteria.
3. Build the module in `src/modules/` first, with a test, then wire it as a Mastra tool.

## After you finish a task

1. Tick the item in `docs/07-BUILD-PLAN.md`.
2. If you made a non obvious choice, append five lines to `docs/DECISIONS.md`: what, alternative, why.
3. Commit with a conventional commit message.

## Things that will look wrong but are correct

- **RAG exists but usually does not run.** Documents under about 25,000 tokens go into context whole. This is deliberate; see architecture Part 2.5 of the research doc and M3.
- **The artifact builder is a workflow, not an agent.** Deliberate. Only one of its seven steps calls a model (author and validate share a step, D-40).
- **The orchestrator has no domain tools.** Deliberate. If it can query DuckDB itself, delegation becomes decorative.
- **Specialists never see chat history.** They receive a typed `SpecialistTask`. Deliberate, and the reason Mastra deprecated `.network()`.

## Out of scope, do not build

OCR for scanned PDFs (detect and report instead), arbitrary code execution or sandboxes, live CRM or database connectors, legacy `.doc` and `.xls` parsing (detect and report), user accounts and roles (an optional shared password gate exists, D-57), deployment infrastructure.
