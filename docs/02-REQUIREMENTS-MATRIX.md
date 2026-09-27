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
| "Which campaigns performed best?" | `run_sql` after mandatory `describe_dataset` | Yes | [x] |
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
| Meaningful content, not a pasted reply | Typed plan validated by Zod, rendered by code. Only step 4 of 7 (author and validate) uses a model | Yes | [x] |

## E. Research

| Requirement | Where | Spec | Build |
|---|---|---|---|
| Research the public web | M4, Exa or Tavily, Jina Reader, Firecrawl | Yes | [x] |
| Structured company profile | `company-research` skill defines the fields and the pages to look for | Yes | [x] Scenario B ran end to end live on free tier Gemini and Groq: a cited profile, every claim with its URL and read date (D-75) |
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
| R6 | No fabrication | Evidence ledger, `gaps` field, four grounding evals | Yes | [x] partial: the evidence ledger and `gaps` field are built and unit tested (`npm test`, 704/704 green), and are the actual enforcement mechanism. The four grounding evals in `tests/grounding/` make live model calls, run only through `npm run eval` and are not part of `npm test`. The missing metric and contradiction evals have passed live on Claude (D-66, D-67); on free tier keys any of them can fail for quota reasons, so do not read this row as "the evals always pass" |
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
| E7 | Errors and failed operations | `ToolResult<T>`, error codes, three retry classes, source status | Yes | [x] The Groq structured output parse failure that kept this partial (D-60, D-62) is gone: since D-66 `delegate()` runs the tool loop with no structured output and assembles the `SpecialistResult` in code. Rate limits and spend caps are reported once, in plain language (D-65, D-71) |
| E8 | Unsupported requests | Capability list plus explicit refusal path | Yes | [x] |
| E9 | Conflicting information | Normalised metric key, tolerance by unit, both sides surfaced | Yes | [x] `detectConflicts` is wired into synthesis, and ranking claims are compared as `_rank` metrics (D-67). The live contradiction eval passed on Claude, with the conflict found by `detectConflicts`, not by the model |
| E10 | Generated artifacts | Skill plus schema plus renderer, versioned, evidence recorded | Yes | [x] |
| E11 | Conversation context | Manifest plus Mastra Memory plus reference resolution | Yes | [x] |
| E12 | Cost and latency | Model tiers, on demand skills, parse cache, row caps, parallel delegation | Yes | [x] |
| Extra | File content is data, never instruction | Orchestrator rule 9. Not asked for, worth having | Yes | [x] Orchestrator rule 9 (`src/mastra/agents/orchestrator.ts`); requirement shaped files and pages become `proposedTasks` at ingest, never actions (tested in `src/modules/sources/ingest.test.ts`) |
| Extra | Provider choice | Anthropic, OpenAI, Gemini and Groq, switched on by their keys, paid first, with an allowlist (D-54) | Yes | [x] |
| Extra | Security for a shared deployment | SSRF guard, validated routes, rate limits, optional password gate, security headers (docs/11-SECURITY.md, D-55 to D-58) | Yes | [x] |
| Extra | Conversation history and file preview | Sidebar over Mastra Memory, Claude style preview panel (D-49, D-50) | Yes | [x] |

## I. Submission deliverables

| Deliverable | Where | Done |
|---|---|---|
| Working application | The repo, one setup command | [ ] partial: `tsc --noEmit` clean, `npm test` 704/704 green, and every phase's "Demonstrable" milestone through Saturday holds; but the build plan's own Sunday item "fresh clone test: does `10-SETUP.md` actually work from zero" has not been run yet, and after `npm install` the chat UI is one command (`npm run dev --workspace app`; Mastra Studio is an optional second process) |
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

No gap against the brief's requirements is left undesigned: everything in section 4 of the PRD is a deliberate scope exclusion, documented as a decision rather than left silent. What is still open is execution, listed here so it matches the partial and unticked rows above.

**Open**

1. **Generated artifacts not committed.** `samples/generated/` holds only its README; `northwind-q3-review.pptx` and `northwind-campaign-metrics.xlsx` still have to be produced from scenario A and committed (section I).
2. **Fresh clone test not run.** `docs/10-SETUP.md` has been rewritten for a clean clone but not yet followed from zero on a second machine (section I, "Working application").
3. **Uncommitted work.** The working tree carries changes not yet committed and pushed (section I, "GitHub repository").
4. **Live grounding evals depend on quota.** The four evals in `tests/grounding/` make real model calls and run only through `npm run eval`, not `npm test`. The missing metric and contradiction evals have passed live on Claude (D-66, D-67); on the free tier they can fail for quota reasons, not grounding reasons (R6, E9).
5. **Free tier limits.** On 26 Sep 2026 the free tier for gemini-2.5-flash was measured at 20 requests a day. The fallback chain (Gemini Flash, Flash Lite, Groq) softens this, and a paid Anthropic or OpenAI key removes it (D-53, D-54). A full scenario A run on free keys alone does not complete in one day.
6. **Specialist gaps can be dropped on a failed extraction.** Since D-66 a specialist answers in free text and its `SpecialistResult` is assembled in code, which replaced the structured output path behind the Groq parse failures of D-60 and D-62. The remaining edge: if the small extraction call fails, the answer is returned with no `gaps`, so a gap can be stated in the answer text but missing from `openGaps`.

**Resolved**

- **Time.** The artifact renderers were the most likely thing to run late. Resolved on 27 Sep (P8.4 audit): xlsx, pptx, docx and pdf renderers all shipped; nothing was cut.
