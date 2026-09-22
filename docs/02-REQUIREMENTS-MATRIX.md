# Requirements coverage matrix

Every requirement in `00-BRIEF.md` mapped to where it is handled. This is the final cross check, done after three passes over the brief. Reproduce the relevant parts of this table in the README so a reviewer does not have to build it themselves.

Legend: **Spec** means designed and specified. **Build** means it exists in code. Update the Build column as you go; it is the real progress tracker.

---

## A. The six example requests from the problem statement

| Example request | Path through the system | Spec | Build |
|---|---|---|---|
| "Analyze this campaign data and tell me what performed well and what didn't" | Intent: data. Orchestrator to Data Analyst, describe then SQL, evidence to findings | Yes | [ ] |
| "Based on this data and the company information, suggest three campaign ideas" | Intent: **recommendation**. Orchestrator reasons over existing evidence itself, no delegation | Yes | [ ] |
| "Create a report summarizing the findings" | Artifact workflow, `campaign-report` skill, docx renderer | Yes | [ ] |
| "Turn the findings into a presentation" | Artifact workflow, `client-presentation` skill, pptxgenjs with native charts | Yes | [ ] |
| "Create an Excel file containing the recommendations and supporting data" | Artifact workflow, `excel-workbook` skill, five sheet convention including Recommendations | Yes | [ ] |
| "Research this company and combine the findings with the data I uploaded" | Intent: mixed. Parallel or sequential delegation, combined evidence, conflict detection | Yes | [ ] |

## B. Files and data

| Requirement | Where | Spec | Build |
|---|---|---|---|
| PDF / document files | M1 ingestion, `unpdf` to markdown with page markers | Yes | [ ] |
| Excel / CSV files | M1 to DuckDB, native `read_xlsx` and `read_csv_auto` | Yes | [ ] |
| Text files | M1, direct | Yes | [ ] |
| Public webpages | M4 Jina Reader, then the same document path | Yes | [ ] |
| **Tables inside documents** | M1 table detection, registered in DuckDB alongside the prose | Yes | [ ] |
| Reason across multiple sources | Evidence ledger, evidence conditioned queries, parallel and sequential delegation | Yes | [ ] |
| "Based on the actual information in the sources" | Rule 2: no evidence, no claim | Yes | [ ] |

## C. Analysis

| Requirement | Where | Spec | Build |
|---|---|---|---|
| "Which campaigns performed best?" | `run_sql` after mandatory `describe_dataset` | Yes | [ ] |
| "Which segment has the highest conversion rate?" | Same, with the metric formula from the analytics skill | Yes | [ ] |
| "What trends do you see?" | `campaign-analytics` skill checklist plus `compute_stats` regression | Yes | [ ] |
| "What should we change in the next campaign?" | Recommendation intent, findings grounded in evidence | Yes | [ ] |
| Calculations programmatic, not model estimated | M2 DuckDB and simple-statistics. No arithmetic in any prompt | Yes | [ ] |
| Explain how conclusions were reached | `Finding` type: statement, evidenceIds, reasoning, soWhat | Yes | [ ] |

## D. Business deliverables

| Deliverable | Skill plus renderer | Spec | Build |
|---|---|---|---|
| Structured report | `campaign-report` to docx | Yes | [ ] |
| Excel spreadsheet | `excel-workbook` to exceljs, live formulas | Yes | [ ] |
| Presentation | `client-presentation` to pptxgenjs | Yes | [ ] |
| Summary document | `summary-document` to docx, one page | Yes | [ ] |
| Content brief | `content-brief` to docx | Yes | [ ] |
| Campaign plan | `campaign-plan` to docx | Yes | [ ] |
| **Other appropriate outputs** | `generic-document` fallback so nothing is refused for being unlisted | Yes | [ ] |
| Meaningful content, not a pasted reply | Typed plan validated by Zod, rendered by code. Only step 4 of 8 uses a model | Yes | [ ] |

## E. Research

| Requirement | Where | Spec | Build |
|---|---|---|---|
| Research the public web | M4, Exa or Tavily, Jina Reader, Firecrawl | Yes | [ ] |
| Structured company profile | `company-research` skill defines the fields and the pages to look for | Yes | [ ] |
| Combine research with user data | Evidence ledger holds both kinds, orchestrator synthesises | Yes | [ ] |
| Claims traceable to underlying information | Evidence locator: URL plus retrievedAt for web, page plus heading for documents, SQL for computed | Yes | [ ] |

## F. Conversational workflow, the brief's own four turn example

| Turn | Mechanism | Spec | Build |
|---|---|---|---|
| "Analyze this campaign data" | Manifest, delegation, evidence | Yes | [ ] |
| "Now compare it with the target company's audience" | Reference resolution from the manifest; one clarifying question if unresolvable | Yes | [ ] |
| "Great. Turn this into a campaign proposal" | Artifact workflow scoped to the conversation's findings | Yes | [ ] |
| "Put the metrics into Excel and create a presentation" | Two artifact workflow runs in parallel, progress streamed | Yes | [ ] |
| Maintain sufficient context | Session manifest plus Mastra Memory | Yes | [ ] |

## G. Hard requirements

| # | Requirement | Where | Spec | Build |
|---|---|---|---|---|
| R1 | TypeScript | Throughout, Zod at every boundary | Yes | [ ] |
| R2 | Mastra | Agents, subagents, workflows, memory, RAG, skills, studio | Yes | [ ] |
| R3 | Multi agent where appropriate | Orchestrator plus three specialists, two levels, typed contracts. Artifact builder deliberately a workflow | Yes | [ ] |
| R4 | Conversational | M8 | Yes | [ ] |
| R5 | Programmatic calculation | M2 | Yes | [ ] |
| R6 | No fabrication | Evidence ledger, `gaps` field, four grounding evals | Yes | [ ] |
| R7 | Traceability | Findings to evidence to SQL or page or URL | Yes | [ ] |

## H. The twelve engineering expectations

| # | Concern | Answer | Spec | Build |
|---|---|---|---|---|
| E1 | Different file types | Type router by extension plus magic bytes. Sources can be both prose and tabular | Yes | [ ] |
| E2 | Large files | Streamed upload with a cap, DuckDB out of core for tables, token routing for documents | Yes | [ ] |
| E3 | Structured and unstructured | Two stores, two agents, two toolsets, one registry | Yes | [ ] |
| E4 | Numerical analysis | SQL only, analytics skill supplies method | Yes | [ ] |
| E5 | Multiple sources | Registry, evidence kinds, evidence conditioned queries | Yes | [ ] |
| E6 | Long running tasks | Workflow runs with IDs past about 20s, async ingestion, streamed progress, suspend and resume | Yes | [ ] |
| E7 | Errors and failed operations | `ToolResult<T>`, error codes, three retry classes, source status | Yes | [ ] |
| E8 | Unsupported requests | Capability list plus explicit refusal path | Yes | [ ] |
| E9 | Conflicting information | Normalised metric key, tolerance by unit, both sides surfaced | Yes | [ ] |
| E10 | Generated artifacts | Skill plus schema plus renderer, versioned, evidence recorded | Yes | [ ] |
| E11 | Conversation context | Manifest plus Mastra Memory plus reference resolution | Yes | [ ] |
| E12 | Cost and latency | Model tiers, on demand skills, parse cache, row caps, parallel delegation | Yes | [ ] |
| Extra | File content is data, never instruction | Orchestrator rule 9. Not asked for, worth having | Yes | [ ] |

## I. Submission deliverables

| Deliverable | Where | Done |
|---|---|---|
| Working application | The repo, one setup command | [ ] |
| GitHub repository | Clean history, conventional commits | [ ] |
| README: architecture | Section 1 of README.md | [ ] |
| README: key design decisions | Section 2, drawn from DECISIONS.md | [ ] |
| README: how the multi agent system works | Section 3 | [ ] |
| README: how files and data are processed | Section 4 | [ ] |
| README: how generated artifacts are created | Section 5 | [ ] |
| README: important trade offs | Section 6, the hardest section, written incrementally | [ ] |
| Short demonstration, realistic scenario | `docs/08-DEMO-SCENARIOS.md`, recorded | [ ] |
| At least two generated artifacts | Scenario A produces a deck and a workbook, committed to `samples/generated/` | [ ] |

---

## Known gaps

None outstanding against the brief after three review passes. Everything in section 4 of the PRD is a deliberate scope exclusion, documented as a decision rather than left silent.

The two risks that remain are execution risks, not design gaps:

1. **Time.** The artifact renderers are the most likely thing to run late. If Saturday slips, ship Excel and PowerPoint only; that still satisfies "at least two generated business artifacts".
2. **Free tier limits.** Gemini and Exa quotas are generous but finite. Cache aggressively, and do a full dry run of both demo scenarios on Sunday morning while there is still quota to recover from a mistake.
