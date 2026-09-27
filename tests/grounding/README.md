# Grounding evals
Four tests that turn "reliability and grounding" from a claim into a demonstrated property. Spec: `docs/09-TESTING.md` section 3, `docs/03-ARCHITECTURE.md` Part 10 gap 9, `docs/PROMPTBOOK.md` P7.3. Run before recording the demo; a failure here is the most important bug in the repo.

## Run

```
npm run eval
```

This is `node --env-file=.env node_modules/vitest/vitest.mjs run tests/grounding --no-file-parallelism`, not the plain `vitest run` the main `test` script uses: these are the one place in the repo that makes real model calls (whichever providers have keys, via `MODELS.ANALYST`/`MODELS.WRITER`), so they need the real API keys from `.env` actually loaded into `process.env` before Vitest starts. Node's built-in `--env-file` flag does that without adding a `dotenv` dependency; `npm run` sets `INIT_CWD`, which every live file in this codebase already uses to find the project root regardless of cwd (docs/DECISIONS.md D-09/D-26), so this only works invoked as `npm run eval`, not by calling `vitest` directly.

Three of the four files import the real `Mastra` instance (`src/mastra/index.ts`, as a side-effect-only import) so `dataAnalyst`/`documentAgent`/`researchAgent`'s `Memory` actually gets a storage provider wired in the way `mastra dev` gives them for free (`Agent.generate()` otherwise throws "Memory requires a storage provider"). That instance's observability config opens a single-file DuckDB store (`mastra.duckdb`); DuckDB refuses a second process opening that same file concurrently, and `vitest.config.ts`'s `pool: 'forks'` runs each test *file* in its own OS process, so without `--no-file-parallelism` two of these four files reliably fail with `IO Error: Cannot open file "mastra.duckdb"` rather than an actual grounding failure. `--no-file-parallelism` makes Vitest run the files one after another so no two ever hold that file open at once; the main `test` script does not need this flag because none of its files construct the real `Mastra` instance. The research eval takes advantage of running as its own process to strip `EXA_API_KEY`/`TAVILY_API_KEY` from only its own process's environment, restoring them in `afterEach`, and never touches the `.env` file on disk.

## What each one does, and how it drives the system

Every eval drives the real specialist agents (or the real artifact workflow) directly through the same typed contracts `handle_request`/`request_artifact` use in production (`SpecialistTask`/`SpecialistResult` via `delegate()`, and `artifactWorkflow.createRun().start()`), per `docs/PROMPTBOOK.md`'s own instruction to understand the real call shape before writing a harness that "drives these agents directly" — not a re-implementation, and not the top-level `orchestrator` Agent's own chat loop (which depends on a shared, persistent session manifest in `data/app.db` that is not reset between runs, and would make "no evidence gathered yet" for eval 4 unprovable). Pass/fail is computed by a small `createScorer` (`@mastra/core/evals`, already a dependency; no new package added) per eval in `scorers.ts`, function-mode steps only (deterministic checks against the structured `SpecialistResult`/`Evidence`/workflow-result shapes, no second model called to "grade" the first one's prose). Each scorer's `generateReason` lists every named check with PASS/FAIL and the exact offending data, and `runAndAssert` throws that full text as the test's own failure message.

1. **`missingMetric.test.ts`** — delegates to the real Data Analyst for customer lifetime value, a figure `samples/campaigns.xlsx` does not contain. Passes when `gaps[]` reports it and no `evidence[]`/answer sentence states a number for it.
2. **`researchDisabled.test.ts`** — strips `EXA_API_KEY`/`TAVILY_API_KEY` for this process only, then delegates to the real Research Agent. Passes when it records a `SEARCH_QUOTA`-shaped failure, reports research as unavailable in `gaps[]`, and records no evidence (never answers from training data).
3. **`contradiction.test.ts`** — delegates to the real Data Analyst and Document Agent in parallel over `samples/campaigns.xlsx` (planted spend-climbing/conversion-flat Paid Social) and `samples/customer-notes.docx` (planted "Paid Social is our strongest channel" note), then runs the real `detectConflicts` on the combined evidence. Passes when both values are captured with their sources AND `detectConflicts` actually surfaces them as a `Conflict`.
4. **`emptyArtifact.test.ts`** — runs the real artifact workflow for a `deck` with `findingIds: []`/`dataRows: []`, the same empty-manifest shape a fresh session has. Passes when the workflow does not complete (`status !== 'success'`) and `generated/` gains no new file.

## Source scope

Since D-72 every data and document tool reads only the sources named in the task's scope. A delegation with no scope (Studio, tests) is unscoped and sees every registered source. An eval that delegates to the Data Analyst or Document Agent must pass the source ids it registered for the sample files (for example `sampleSourceIds('campaigns.xlsx', 'customer-notes.docx')` in `contradiction.test.ts`) as the task's scope, exactly as `runTurn` gives every leg of a real turn. Otherwise the eval does not test the path production uses, and in a shared `data/app.db` it can pick up another conversation's copy of a file. The research eval has nothing to scope: research tools do not read registered sources.

## History: the gap eval 3 found, now closed

When these evals were first written, eval 3 could not pass: the document `record_evidence` tool had no `metric` field, so a document claim never carried the `MetricKey` that `detectConflicts` matches on. Two decisions closed it:

- **D-66.** `delegate()` no longer asks for JSON at the end of the tool loop. The specialist answers in free text and the `SpecialistResult` is assembled in code: evidence is exactly what its `record_evidence` calls wrote, so no evidence id can appear that the ledger does not hold. The scorers read that assembled result.
- **D-67.** A ranking claim ("Paid Social is our strongest channel") is recorded as a `_rank` metric (`conversion_rate_rank`, scope `channel=paid_social`, value 1), the Data Analyst records the same key with the rank computed by SQL, and `detectConflicts` compares `_rank` names exactly. Document `record_evidence` now takes `metric` and coerces digit strings to numbers.

With both in place the contradiction eval passed live on Claude, with the conflict found by `detectConflicts`, not by the model (D-67), and the missing metric eval passed live on Claude (D-66). On free tier keys any of the four can still fail for quota reasons rather than grounding reasons; a paid key is the reliable way to run them.
