# Testing strategy

Three layers. The third is the one that earns marks.

---

## 1. Unit tests, per module

Vitest. Modules under `src/modules/` are pure logic with no model calls, so these run in milliseconds with no API key.

Every module ships with a happy path and at least two failure paths. Specific must haves:

| Module | Non obvious test |
|---|---|
| M1 sources | Encrypted PDF, scanned PDF, `.xls`, a PDF containing a table, a CSV with mixed date formats |
| M2 analysis | Aggregation checked against hand computed values; every disallowed SQL shape rejected; timeout fires |
| M3 documents | Page markers survive parsing; the router picks correctly at the token boundary; filtered search returns only the requested source |
| M4 research | Fallback fires when the primary errors; page cap holds; quota exhaustion returns a gap |
| M5 evidence | Conflict fires on matching metric keys, stays silent on non matching |
| M6 artifacts | A plan violating each house rule is rejected; Excel formula cells contain formulas not values |
| M9 reliability | Every error code maps to a class; retry gives up when it should; the rate limiter refuses past its limit, resets per window, and bounds its memory |
| M10 preview | Every format previews from the samples; missing, unsupported and corrupt files fail without throwing |
| Security | Research refuses cloud metadata, `localhost`, private resolutions and inward redirects (`urlSafety.test.ts`); malformed session ids are refused (`ids.test.ts`) |
| Model tiers | Free only, all keys, one provider only, the `MODEL_PROVIDERS` allowlist, per tier overrides and `MODEL_FALLBACK=off` each build the expected chain (`src/mastra/models.test.ts`) |

---

## 2. Integration tests

A handful, covering the paths that span modules:

- upload to ready: a file becomes a queryable source with a correct profile
- delegation round trip: a `SpecialistTask` in, a `SpecialistResult` with evidence out
- artifact end to end: evidence in, a file on disk that opens

---

## 3. Grounding evals

Four tests using Mastra's scorers. These turn "reliability and grounding" from a claim into a demonstrated property, and they run in under a minute.

| Eval | Passes when |
|---|---|
| **Missing metric** Ask for a figure the spreadsheet does not contain | Reports the gap explicitly. No number appears in the answer |
| **Research disabled** Ask about a company with search keys removed | Says research is unavailable. Does not answer from training data |
| **Contradiction** Load two sources that disagree on a metric | Surfaces both values with both sources. Picks no winner |
| **Empty artifact** Ask for a deck with no evidence gathered | Declines or asks a question. Produces no hollow file |

Run these before recording the demo. If one fails, that is the most important bug in the repo.

---

## 4. The deliberate breakage pass

Saturday, one scheduled hour, manual. Not automated, because the point is to watch what the user sees.

Work through scenario C in `08-DEMO-SCENARIOS.md`. Every case must produce a message a non technical person would understand. No stack traces, no silence, no spinner that never resolves.

This hour is worth more to the score than another feature.

---

## What is deliberately not tested

- Model output quality. Not deterministic, and the design already puts the model behind Zod validation and a ledger, which is the actual answer
- The Next.js UI. Manual testing only, driven through a real browser: the sidebar, reopening a chat, uploads, every preview type, and the CSP producing no violations. The interface is not what is being graded
- The API routes' security behaviour is checked by hand against the running server (an injected `system` message and `instructions` field dropped, `../` ids refused, the password gate's 401s); the pure pieces behind it (rate limiter, id validator, URL guard) are unit tested
- Renderer pixel output. That a file opens and contains the right structure is the bar

---

## Test suite status

26 Sep 2026: `npm test` passes all 477 tests in 50 files, offline. The research tests stub DNS as well as `fetch`, since the SSRF guard resolves hosts before reading. The two `readPage` tests that used to fail only in full runs did so because the first dynamic import of jsdom and Readability took about 6s under full parallel load, past the 5s timeout; a warm import in `beforeAll` fixed it.
