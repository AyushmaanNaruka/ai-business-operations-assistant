import { readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';
import { artifactWorkflow } from '@/mastra/workflows/artifact';
import { emptyArtifactScorer, runAndAssert, type EmptyArtifactOutput } from './scorers';

// Same PROJECT_ROOT resolution every other live file in this codebase uses
// (docs/DECISIONS.md D-09/D-26: `mastra dev` runs with its cwd set to
// src/mastra/public, so INIT_CWD, set by npm for any `npm run` invocation, is the one
// thing that reliably points back at the project root); storeArtifactFile
// (src/mastra/workflows/artifactSteps.ts) resolves its default `outDir` the same way,
// against the same 'generated' folder this test checks.
const PROJECT_ROOT = process.env.INIT_CWD || process.cwd();
const GENERATED_DIR = resolve(PROJECT_ROOT, 'generated');

async function listGenerated(): Promise<string[]> {
  try {
    return await readdir(GENERATED_DIR);
  } catch {
    return []; // directory does not exist yet: equivalent to "no files"
  }
}

/**
 * Grounding eval 4/4 (docs/09-TESTING.md section 3, docs/03-ARCHITECTURE.md Part 10
 * gap 9, docs/PROMPTBOOK.md P7.3): asks for a deck at the start of a session with no
 * evidence gathered yet (`findingIds: []`, `dataRows: []`, exactly what
 * request_artifact passes when the manifest has no findings — see
 * src/mastra/agents/orchestrator.ts's requestArtifactTool). Passes when the workflow
 * declines (does not complete) and produces no file on disk, rather than shipping a
 * hollow deck built on fabricated, evidence-free content.
 *
 * A LIVE test: this runs the real `artifactWorkflow` (src/mastra/workflows/artifact.ts)
 * end to end, exactly the code request_artifact's tool execute() calls (`run =
 * artifactWorkflow.createRun(); run.start({ inputData })`), not a reimplementation of
 * it. The one model call in the eight-step pipeline (authorAndValidate's "AUTHOR PLAN")
 * runs against the real MODELS.WRITER model, up to its own two-attempt limit.
 */
describe('Grounding eval: empty artifact', () => {
  it(
    'declines rather than shipping a hollow deck when no evidence has been gathered yet',
    async () => {
      const filesBefore = await listGenerated();

      const run = await artifactWorkflow.createRun();
      const result = await run.start({
        inputData: {
          planKind: 'deck',
          title: 'Untitled session deck',
          objective:
            'Build a slide deck for the client, at the very start of a session, before any data, documents or research have been gathered.',
          findingIds: [],
          dataRows: [],
        },
      });

      const filesAfter = await listGenerated();

      try {
        const output: EmptyArtifactOutput = {
          status: result.status,
          filesBefore,
          filesAfter,
          ...(result.status === 'suspended'
            ? {
                suspendErrors: (result.suspendPayload as { authorAndValidate?: { errors?: string[] } } | undefined)?.authorAndValidate
                  ?.errors,
              }
            : {}),
        };

        await runAndAssert(emptyArtifactScorer, { objective: 'empty-session deck request' }, output, 'Grounding eval 4 (empty artifact)');
      } finally {
        // If the workflow DID complete (the very failure mode this eval checks for),
        // it really did write a file to disk; clean it up so re-running `npm run eval`
        // does not pile up stray .pptx files in generated/ every time this eval catches
        // the same gap. Never deletes anything that was already there before this run.
        const newFiles = filesAfter.filter((f) => !filesBefore.includes(f));
        await Promise.all(newFiles.map((f) => unlink(resolve(GENERATED_DIR, f)).catch(() => {})));
      }
    },
    90_000,
  );
});
