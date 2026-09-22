---
description: Build one module from its spec, test it, then wire it as a Mastra tool
---

Build the module named in $ARGUMENTS.

Follow this order and do not skip a step:

1. Read the module's section in `docs/04-MODULES.md` and the matching part of `docs/03-ARCHITECTURE.md`.
2. Read `docs/05-DATA-MODEL.md` and import the shared types. Do not redefine them.
3. Write the module under `src/modules/<name>/` as pure logic. No Mastra imports, no model calls, so it can be tested without an API key.
4. Write a Vitest test covering the happy path and at least two failure paths.
5. Run the test. Fix until green.
6. Wire the module into `src/mastra/tools/` as typed tools. Every tool returns `ToolResult<T>` and never throws.
7. Tick the item in `docs/07-BUILD-PLAN.md`.
8. If you made a non obvious choice, append it to `docs/DECISIONS.md` as what, alternative, why.

Report at the end: files created, tests passing, and anything in the spec you could not implement and why.
