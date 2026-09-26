# Requirements coverage matrix

Every requirement in `00-BRIEF.md` mapped to where it is handled. This is the final cross check, done after three passes over the brief. Reproduce the relevant parts of this table in the README so a reviewer does not have to build it themselves.

Legend: **Spec** means designed and specified. **Build** means it exists in code. Update the Build column as you go; it is the real progress tracker.

---

## A. The six example requests from the problem statement

| Example request | Path through the system | Spec | Build |
|---|---|---|---|
| "Analyze this campaign data and tell me what performed well and what didn't" | Intent: data. Orchestrator to Data Analyst, describe then SQL, evidence to findings | Yes | [x] |
| "Based on this data and the company information, suggest three campaign ideas" | Intent: **recommendation**. Orchestrator reasons over existing evidence itself, no delegation | Yes | [x] |
| "Create a report summarizing the findings" | Artifact workflow, `campaign-report` skill, docx renderer | Yes | [x] |
| "Turn the findings into a presentation" | Artifact workflow, `client-presentation` skill, pptxgenjs with native charts | Yes | [x] |
| "Create an Excel file containing the recommendations and supporting data" | Artifact workflow, `excel-workbook` skill, five sheet convention including Recommendations | Yes | [x] |
| "Research this company and combine the findings with the data I uploaded" | Intent: mixed. Parallel or sequential delegation, combined evidence, conflict detection | Yes | [x] |

## B. Files and data

| Requirement | Where | Spec | Build |
|---|---|---|---|
| PDF / document files | M1 ingestion, `unpdf` to markdown with page markers | Yes | [x] |
| Excel / CSV files | M1 to DuckDB, native `read_xlsx` and `read_csv_auto` | Yes | [x] |
| Text files | M1, direct | Yes | [x] |
| Public webpages | M4 Jina Reader, then the same document path | Yes | [x] |
| **Tables inside documents** | M1 table detection, registered in DuckDB alongside the prose | Yes | [x] |
| Reason across multiple sources | Evidence ledger, evidence conditioned queries, parallel and sequential delegation | Yes | [x] |
| "Based on the actual information in the sources" | Rule 2: no evidence, no claim | Yes | [x] |

## C. Analysis

| Requirement | Where | Spec | Build |
|---|---|---|---|
| "Which campaigns performed best?" | `run_sql` after mandatory `describe_dataset` | Yes | [x] partial: the mechanism is built and unit tested end to end, but it runs behind Data Analyst delegation, and `delegate()` (see contracts.ts doc comment, D-60) documents that Groq's structured-output mode — the fallback once Gemini's free daily quota is exhausted — can still fail a `SpecialistResult` parse in two distinct shapes, only partially mitigated |
| "Which segment has the highest conversion rate?" | Same, with the metric formula from the analytics skill | Yes | [x] |
| "What trends do you see?" | `campaign-analytics` skill checklist plus `compute_stats` regression | Yes | [x] |
| "What should we change in the next campaign?" | Recommendation intent, findings grounded in evidence | Yes | [x] |
| Calculations programmatic, not model estimated | M2 DuckDB and simple-statistics. No arithmetic in any prompt | Yes | [x] |
| Explain how conclusions were reached | `Finding` type: statement, evidenceIds, reasoning, soWhat | Yes | [x] |

## D. Business deliverables

| Deliverable | Skill plus renderer | Spec | Build |
|---|---|---|---|
| Structured report | `campaign-report` to docx | Yes | [x] |
| Excel spreadsheet | `excel-workbook` to exceljs, live formulas | Yes | [x] |
| Presentation | `client-presentation` to pptxgenjs | Yes | [x] |
| Summary document | `summary-document` to docx, one page | Yes | [x] |
| Content brief | `content-brief` to docx | Yes | [x] |
| Campaign plan | `campaign-plan` to docx | Yes | [x] |
| **Other appropriate outputs** | `generic-document` fallback so nothing is refused for being unlisted | Yes | [x] |
| Meaningful content, not a pasted reply | Typed plan validated by Zod, rendered by code. Only step 4 of 8 uses a model | Yes | [x] |

## E. Research

| Requirement | Where | Spec | Build |
|---|---|---|---|
| Research the public web | M4, Exa or Tavily, Jina Reader, Firecrawl | Yes | [x] |
| Structured company profile | `company-research` skill defines the fields and the pages to look for | Yes | [x] partial: the skill, tool, and Research agent all exist and are tested, but the agent's answer reaches the orchestrator through the same `delegate()` structured-output call as Data Analyst, so it carries the same Groq-under-quota-pressure risk (contracts.ts doc comment, D-60) — degrades to a reported gap, not a crash, but a specialist delegation can genuinely fail |
| Combine research with user data | Evidence ledger holds both kinds, orchestrator synthesises | Yes | [x] |
| Claims traceable to underlying information | Evidence locator: URL plus retrievedAt for web, page plus heading for documents, SQL for computed | Yes | [x] |

## F. Conversational workflow, the brief's own four turn example

| Turn | Mechanism | Spec | Build |
|---|---|---|---|
| "Analyze this campaign data" | Manifest, delegation, evidence | Yes | [x] |
| "Now compare it with the target company's audience" | Reference resolution from the manifest; one clarifying question if unresolvable | Yes | [x] |
| "Great. Turn this into a campaign proposal" | Artifact workflow scoped to the conversation's findings | Yes | [x] |
| "Put the metrics into Excel and create a presentation" | Two artifact workflow runs in parallel, progress streamed | Yes | [x] |
| Maintain sufficient context | Session manifest plus Mastra Memory | Yes | [x] |

## G. Hard requirements

| # | Requirement | Where | Spec | Build |
|---|---|---|---|---|
| R1 | TypeScript | Throughout, Zod at every boundary | Yes | [x] |
| R2 | Mastra | Agents, subagents, workflows, memory, RAG, skills, studio | Yes | [x] |
| R3 | Multi agent where appropriate | Orchestrator plus three specialists, two levels, typed contracts. Artifact builder deliberately a workflow | Yes | [x] |
| R4 | Conversational | M8 | Yes | [x] |
| R5 | Programmatic calculation | M2 | Yes | [x] |
| R6 | No fabrication | Evidence ledger, `gaps` field, four grounding evals | Yes | [x] partial: the evidence ledger and `gaps` field are built and unit tested (`npm test`, 488/488 green), and are the actual enforcement mechanism; the four grounding evals in `tests/grounding/` exist and are wired to `npm run eval`, but they require live model calls and real API keys, are not part of `npm test`, and tonight's runs were unreliable once Gemini's free daily quota (20 req/day) was exhausted — do not read this row as "the evals always pass," they depend on live quota being available |
| R7 | Traceability | Findings to evidence to SQL or page or URL | Yes | [x] |

## H. The twelve engineering expectations

| # | Concern | Answer | Spec | Build |
|---|---|---|---|---|
| E1 | Different file types | Type router by extension plus magic bytes. Sources can be both prose and tabular | Yes | [x] |
| E2 | Large files | Streamed upload with a cap, DuckDB out of core for tables, token routing for documents | Yes | [x] |
| E3 | Structured and unstructured | Two stores, two agents, two toolsets, one registry | Yes | [x] |
| E4 | Numerical analysis | SQL only, analytics skill supplies method | Yes | [x] |
| E5 | Multiple sources | Registry, evidence kinds, evidence conditioned queries | Yes | [x] |
| E6 | Long running tasks | Workflow runs with IDs past about 20s, async ingestion, streamed progress, suspend and resume | Yes | [x] |
| E7 | Errors and failed operations | `ToolResult<T>`, error codes, three retry classes, source status | Yes | [x] partial: `ToolResult<T>` (tools never throw), error codes, retry classes and source status are all built and tested at the tool layer; but one real failure mode still reaches the user as a specialist-level error rather than a typed tool failure — Groq's structured-output mode failing a `SpecialistResult` parse under Gemini-quota pressure (contracts.ts, D-60) — caught by the orchestrator and turned into a reported gap, not a crash, but it is a genuine, only-partially-mitigated failure path |
| E8 | Unsupported requests | Capability list plus explicit refusal path | Yes | [x] |
| E9 | Conflicting information | Normalised metric key, tolerance by unit, both sides surfaced | Yes | [x] partial: `detectConflicts` (src/modules/evidence/conflicts.ts) is built, unit tested, and wired into synthesis; the live-quality end of this — a genuinely disagreeing web fact and a spreadsheet fact both surfacing in one live conversation — is the same territory as the `contradiction` grounding eval, which depends on live quota (see R6) and was not reliably re-verified tonight |
| E10 | Generated artifacts | Skill plus schema plus renderer, versioned, evidence recorded | Yes | [x] |
| E11 | Conversation context | Manifest plus Mastra Memory plus reference resolution | Yes | [x] |
| E12 | Cost and latency | Model tiers, on demand skills, parse cache, row caps, parallel delegation | Yes | [x] |
| Extra | File content is data, never instruction | Orchestrator rule 9. Not asked for, worth having | Yes | [ ] |
| Extra | Provider choice | Anthropic, OpenAI, Gemini and Groq, switched on by their keys, paid first, with an allowlist (D-54) | Yes | [x] |
| Extra | Security for a shared deployment | SSRF guard, validated routes, rate limits, optional password gate, security headers (docs/11-SECURITY.md, D-55 to D-58) | Yes | [x] |
| Extra | Conversation history and file preview | Sidebar over Mastra Memory, Claude style preview panel (D-49, D-50) | Yes | [x] |

## I. Submission deliverables

| Deliverable | Where | Done |
|---|---|---|
| Working application | The repo, one setup command | [ ] partial: `tsc --noEmit` clean, `npm test -- --run` 488/488 green, and every phase's "Demonstrable" milestone through Saturday holds; but the build plan's own Sunday item "fresh clone test: does `10-SETUP.md` actually work from zero" has not been run yet, and quick start is two `npm run dev` commands (root Mastra + `app/`), not literally one |
| GitHub repository | Clean history, conventional commits | [ ] partial: history so far is clean and conventional (`feat:`, `fix:`, `docs:`); as of this audit there are uncommitted working-tree changes (this session's D-60/D-61 work and this matrix edit) still to be committed and pushed |
| README: architecture | Section 1 of README.md | [x] real prose, not a placeholder (confirmed by reading it; README.md is 495 lines, rewritten tonight per the c48eeb1/1aab380 commits) |
| README: key design decisions | Section 2, drawn from DECISIONS.md | [x] real prose, four decisions plus a "behind those four" paragraph, drawn from DECISIONS.md as specified |
| README: how the multi agent system works | Section 3 | [x] real prose, including the `SpecialistTask`/`SpecialistResult` contract and the parallel-vs-sequential delegation explanation |
| README: how files and data are processed | Section 4 | [x] real prose, with a type-routing diagram and the async/failure-handling behaviour described |
| README: how generated artifacts are created | Section 5 | [x] real prose |
| README: important trade offs | Section 6, the hardest section, written incrementally | [x] real prose, a ten row trade-off table plus two worked defences |
| Short demonstration, realistic scenario | `docs/08-DEMO-SCENARIOS.md`, recorded | [x] `docs/media/demo.mp4`, `demo-teaser.gif` and `demo-poster.png` exist and are committed (commit c48eeb1) and embedded in the README; note per D-59 this is a Remotion redraw of the UI with figures computed from `samples/campaigns.xlsx`, not a screen capture of the live app — a deliberate, documented choice, not a live recording |
| At least two generated artifacts | Scenario A produces a deck and a workbook, committed to `samples/generated/` | [ ] confirmed still open: `samples/generated/` contains only a placeholder `README.md` naming the two files (`northwind-q3-review.pptx`, `northwind-campaign-metrics.xlsx`); neither file exists yet |

---

## Known gaps

None outstanding against the brief after three review passes. Everything in section 4 of the PRD is a deliberate scope exclusion, documented as a decision rather than left silent.

The two risks that remain are execution risks, not design gaps:

1. **Time.** The artifact renderers are the most likely thing to run late. If Saturday slips, ship Excel and PowerPoint only; that still satisfies "at least two generated business artifacts". *(Amended 27 Sep, P8.4 audit: resolved — both renderers, plus docx and pdf, shipped Friday; not cut.)*
2. **Free tier limits.** Gemini and Exa quotas are finite: on 26 Sep 2026 the free tier for gemini-2.5-flash was measured at 20 requests a day. Cache aggressively, and do a full dry run of both demo scenarios on Sunday morning while there is still quota to recover from a mistake. The fallback chain (Gemini Flash, Flash Lite, Groq) softens this, and a paid Anthropic or OpenAI key removes it (D-53, D-54).
3. **Amended 27 Sep, P8.4 audit — the fallback chain has its own edge, not just a quota ceiling.** Once Gemini's free tier is exhausted and `MODELS.ANALYST`'s chain reaches Groq, Groq's structured-output mode can fail a specialist's `SpecialistResult` parse in two distinct shapes (see `src/mastra/agents/contracts.ts`'s `delegate()` doc comment and D-60). One is retried automatically and recovers; the other is not fully solved, so a specialist delegation can genuinely fail under quota pressure. By design (contracts.ts) this degrades to an honest reported gap rather than a crash, but it is a real, currently open gap, not a resolved one. Relatedly, the four grounding evals in `tests/grounding/` require live model calls and real API keys, run only via `npm run eval` (not part of `npm test`), and tonight's runs were unreliable for the same quota reason — they should not be assumed to always pass; re-run them once quota resets, ideally with a paid key primary.
