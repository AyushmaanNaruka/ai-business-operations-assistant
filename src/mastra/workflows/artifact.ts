import { resolve } from 'node:path';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import type { Artifact, ArtifactKind, Evidence, Finding } from '@/types';
import { ArtifactPlanKindSchema } from '@/modules/artifacts/schemas';
import { openArtifactStore, type ArtifactStore } from '@/modules/artifacts/store';
import { openLedger, type EvidenceLedger } from '@/modules/evidence';
import { EvidenceSchema } from '../agents/contracts';
import {
  authorAndValidate,
  gatherEvidenceForArtifact,
  loadSkillText,
  renderArtifactFile,
  renderChartsPrecheck,
  resolveFormat,
  storeArtifactFile,
} from './artifactSteps';

/**
 * The real Mastra workflow for the artifact builder (docs/03-ARCHITECTURE.md 4.2,
 * docs/PROMPTBOOK.md P6.6): a thin `createStep`/`createWorkflow` graph whose steps call
 * the plain, heavily-tested functions in `artifactSteps.ts` for their actual logic. The
 * eight-step diagram maps onto six graph nodes here, per D-40 (docs/DECISIONS.md):
 * steps 4 ("author plan") and 5 ("validate") are combined into one `authorAndValidate`
 * node (that function owns its own retry loop, including the suspend-worthy failure
 * case), and step 6 ("render charts") is a pass-through pre-check node, not a node that
 * threads rendered buffers into step 7.
 *
 * Node graph: resolveKind -> gatherEvidence -> loadSkill -> authorAndValidate
 *             (may suspend) -> renderChartsPrecheck -> render -> storeAndLink.
 *
 * **Output schema and the suspended case, read carefully:** `outputSchema` below (via
 * `completedOutputSchema`) only shapes what a *completed* run's `result` field looks
 * like: `{ status: 'completed', artifact: <Artifact> }`. It does NOT need a "suspended"
 * variant, because a suspended run is not reported through this schema at all,
 * confirmed against `node_modules/@mastra/core/dist/workflows/types.d.ts`'s
 * `WorkflowResult` union, whose SUSPENDED branch is a structurally different object
 * carrying its own top-level `status: 'suspended'` literal, a `suspendPayload: any`
 * (confirmed empirically, not assumed: namespaced by the suspending step's id, i.e.
 * `{ authorAndValidate: { errors, lastPlan } }`, that inner object being exactly what
 * the `authorAndValidate` step below hands to `suspend()`), and `suspended: [string[],
 * ...string[][]]` (here, `[['authorAndValidate']]`, the step-id path(s) that
 * suspended). A caller detects this by checking `result.status` after `run.start(...)`:
 * `'completed'` means read `result.result` against this workflow's own `outputSchema`;
 * `'suspended'` means read `result.suspendPayload` for the validation errors and the
 * last attempted plan instead, and never look for an `Artifact` at all, because none was
 * ever rendered or stored (P6.6: "After two failed attempts, SUSPEND the workflow and
 * ask the user rather than shipping a bad file").
 */

// mastra dev runs with its cwd set to src/mastra/public, not the project root
// (docs/DECISIONS.md D-09); INIT_CWD is npm's original invocation directory, the one
// thing that reliably points back at the project root. This duplicates
// orchestrator.ts's exact resolution block rather than importing it, for the same
// reason D-26 gives: importing anything from a file with import-time side effects
// (agent construction) into this module's import graph would drag more in than eleven
// lines of path math justify.
const PROJECT_ROOT = process.env.INIT_CWD || process.cwd();

function resolveDatabaseUrl(raw: string): string {
  if (!raw.startsWith('file:')) return raw;
  const filePath = raw.slice('file:'.length);
  const isAbsolute = filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath);
  return isAbsolute ? raw : `file:${resolve(PROJECT_ROOT, filePath)}`;
}

let ledgerPromise: Promise<EvidenceLedger> | null = null;

/**
 * Lazy singleton evidence ledger connection for the live (non-test) workflow, mirroring
 * `orchestrator.ts`'s `getEvidenceLedger()` exactly, against the same `DATABASE_URL`
 * every other live connection in this codebase uses. Not caching a rejected promise: a
 * transient init failure would otherwise permanently break every run for the rest of
 * the process.
 */
async function getEvidenceLedgerForWorkflow(): Promise<EvidenceLedger> {
  if (!ledgerPromise) {
    ledgerPromise = openLedger(resolveDatabaseUrl(process.env.DATABASE_URL || 'file:./data/app.db')).catch((err: unknown) => {
      ledgerPromise = null;
      throw err;
    });
  }
  return ledgerPromise;
}

let storePromise: Promise<ArtifactStore> | null = null;

/** Same lazy-singleton-promise pattern as `getEvidenceLedgerForWorkflow` above, for the artifact store. */
async function getArtifactStore(): Promise<ArtifactStore> {
  if (!storePromise) {
    storePromise = openArtifactStore(resolveDatabaseUrl(process.env.DATABASE_URL || 'file:./data/app.db')).catch((err: unknown) => {
      storePromise = null;
      throw err;
    });
  }
  return storePromise;
}

// ---------------------------------------------------------------------------
// Zod schemas for the workflow graph. Evidence's mirror is imported from contracts.ts
// (already exported there for exactly this "second, hand-mirrored description of a
// plain TS type" purpose); Finding, ArtifactKind and Artifact get their own mirrors
// here, the same `z.ZodType<T>` discipline so a drift from the plain type fails `tsc`
// rather than surfacing later as a silent validation gap.
// ---------------------------------------------------------------------------

const FindingSchema: z.ZodType<Finding> = z.object({
  id: z.string(),
  statement: z.string(),
  evidenceIds: z.array(z.string()),
  reasoning: z.string(),
  soWhat: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  caveats: z.array(z.string()).optional(),
  createdAt: z.string(),
});

const ArtifactKindSchema: z.ZodType<ArtifactKind> = z.enum(['xlsx', 'pptx', 'docx', 'pdf']);

const ArtifactSchema: z.ZodType<Artifact> = z.object({
  id: z.string(),
  version: z.number(),
  kind: ArtifactKindSchema,
  skillUsed: z.string(),
  title: z.string(),
  path: z.string(),
  downloadUrl: z.string(),
  findingIds: z.array(z.string()),
  evidenceIds: z.array(z.string()),
  createdAt: z.string(),
});

// The state each step adds to as it flows down the chain. Every step's outputSchema is
// the previous step's schema `.extend()`-ed with whatever that step newly produces, so
// every later step still has everything an earlier step gathered (the request's own
// fields, the resolved format, the gathered evidence, and so on) without re-fetching it.

const workflowInputSchema = z.object({
  planKind: ArtifactPlanKindSchema,
  format: ArtifactKindSchema.optional(),
  title: z.string(),
  objective: z.string(),
  findingIds: z.array(z.string()).default([]),
  dataRows: z.array(z.record(z.string(), z.unknown())).default([]),
  revisionOf: z.string().optional(),
});

const afterResolveKindSchema = workflowInputSchema.extend({ format: ArtifactKindSchema });
const afterGatherEvidenceSchema = afterResolveKindSchema.extend({
  findings: z.array(FindingSchema),
  evidence: z.array(EvidenceSchema),
});
const afterLoadSkillSchema = afterGatherEvidenceSchema.extend({ skillText: z.string() });
const afterAuthorSchema = afterLoadSkillSchema.extend({ plan: z.unknown() });
// renderChartsPrecheck is a pass-through step: same shape in and out.
const afterRenderSchema = afterAuthorSchema.extend({
  // Buffer is a Node runtime value, not a JSON-serialisable shape; z.instanceof keeps
  // this step's output honest at the type level for the in-process run this workflow
  // actually executes (a persisted snapshot of an in-flight run crossing this exact
  // step is not a case this project's single-process demo needs to survive).
  buffer: z.instanceof(Buffer),
  html: z.string().optional(),
});

const completedOutputSchema = z.object({ status: z.literal('completed'), artifact: ArtifactSchema });

/** The payload `authorAndValidate`'s step hands to `suspend()`; see the module doc comment above. */
const authorSuspendSchema = z.object({ errors: z.array(z.string()), lastPlan: z.unknown() });

// ---------------------------------------------------------------------------
// The factory. `artifactWorkflow` below is the live singleton `mastra dev`/production
// registers; `artifact.test.ts` calls `buildArtifactWorkflow` directly with every
// dependency stubbed, the same "thin, swappable integration layer" pattern the rest of
// this codebase uses (D-33's own reasoning, one level up: there is no clean per-run DI
// point on a `Workflow` built from module-level step functions in this @mastra/core
// version, so the pragmatic answer is a factory whose closures capture the dependencies
// for that build, exactly mirroring how `orchestrator.ts`'s tools close over
// `getManifestStore`/`getEvidenceLedger`).
// ---------------------------------------------------------------------------

export type ArtifactWorkflowDeps = {
  getLedger?: () => Promise<Pick<EvidenceLedger, 'getFindings' | 'getEvidence'>>;
  getStore?: () => Promise<Pick<ArtifactStore, 'saveVersion'>>;
  gatherEvidence?: typeof gatherEvidenceForArtifact;
  loadSkill?: typeof loadSkillText;
  authorAndValidateFn?: typeof authorAndValidate;
  renderChartsPrecheckFn?: typeof renderChartsPrecheck;
  renderArtifactFileFn?: typeof renderArtifactFile;
  storeArtifactFileFn?: typeof storeArtifactFile;
};

export function buildArtifactWorkflow(deps: ArtifactWorkflowDeps = {}) {
  const getLedger = deps.getLedger ?? getEvidenceLedgerForWorkflow;
  const getStore = deps.getStore ?? getArtifactStore;
  const gatherEvidence = deps.gatherEvidence ?? gatherEvidenceForArtifact;
  const loadSkill = deps.loadSkill ?? loadSkillText;
  const runAuthorAndValidate = deps.authorAndValidateFn ?? authorAndValidate;
  const runRenderChartsPrecheck = deps.renderChartsPrecheckFn ?? renderChartsPrecheck;
  const runRenderArtifactFile = deps.renderArtifactFileFn ?? renderArtifactFile;
  const runStoreArtifactFile = deps.storeArtifactFileFn ?? storeArtifactFile;

  // Step 1: resolveKind.
  const resolveKindStep = createStep({
    id: 'resolveKind',
    inputSchema: workflowInputSchema,
    outputSchema: afterResolveKindSchema,
    execute: async ({ inputData }) => ({
      ...inputData,
      format: resolveFormat(inputData.planKind, inputData.format),
    }),
  });

  // Step 2: gatherEvidence.
  const gatherEvidenceStep = createStep({
    id: 'gatherEvidence',
    inputSchema: afterResolveKindSchema,
    outputSchema: afterGatherEvidenceSchema,
    execute: async ({ inputData }) => {
      const ledger = await getLedger();
      const { findings, evidence } = await gatherEvidence(inputData.findingIds, ledger);
      return { ...inputData, findings, evidence };
    },
  });

  // Step 3: loadSkill.
  const loadSkillStep = createStep({
    id: 'loadSkill',
    inputSchema: afterGatherEvidenceSchema,
    outputSchema: afterLoadSkillSchema,
    execute: async ({ inputData }) => ({ ...inputData, skillText: await loadSkill(inputData.planKind) }),
  });

  // Steps 4+5 combined: authorPlan + validate, with the retry loop and the suspend on
  // exhausted attempts, per D-40.
  const authorAndValidateStep = createStep({
    id: 'authorAndValidate',
    inputSchema: afterLoadSkillSchema,
    outputSchema: afterAuthorSchema,
    suspendSchema: authorSuspendSchema,
    execute: async ({ inputData, suspend }) => {
      const result = await runAuthorAndValidate({
        skillText: inputData.skillText,
        planKind: inputData.planKind,
        objective: inputData.objective,
        findings: inputData.findings,
        evidence: inputData.evidence,
      });

      if (!result.ok) {
        // Two failed attempts (authorAndValidate's own default maxAttempts): suspend
        // rather than ship a bad file. No render step runs, nothing is written to
        // disk, and no Artifact is ever saved for this run.
        return await suspend({ errors: result.errors, lastPlan: result.lastPlan });
      }

      return { ...inputData, plan: result.plan };
    },
  });

  // Step 6: renderChartsPrecheck. A pass-through step: it exists only to fail fast, in
  // parallel, before step 7 builds the whole file (per D-40, it does not thread
  // rendered buffers forward).
  const renderChartsPrecheckStep = createStep({
    id: 'renderChartsPrecheck',
    inputSchema: afterAuthorSchema,
    outputSchema: afterAuthorSchema,
    execute: async ({ inputData }) => {
      const check = await runRenderChartsPrecheck(inputData.plan);
      if (!check.ok) {
        // A pre-render failure is not a validation failure: there is nothing for the
        // user to fix by re-authoring the plan, so this does not suspend, it fails the
        // run outright (RENDER_FAILED-shaped, in spirit).
        throw new Error(check.error);
      }
      return inputData;
    },
  });

  // Step 7: render.
  const renderStep = createStep({
    id: 'render',
    inputSchema: afterAuthorSchema,
    outputSchema: afterRenderSchema,
    execute: async ({ inputData }) => {
      const { buffer, html } = await runRenderArtifactFile({
        format: inputData.format,
        planKind: inputData.planKind,
        plan: inputData.plan,
        dataRows: inputData.dataRows,
        evidence: inputData.evidence,
      });
      return { ...inputData, buffer, ...(html !== undefined ? { html } : {}) };
    },
  });

  // Step 8: storeAndLink.
  const storeAndLinkStep = createStep({
    id: 'storeAndLink',
    inputSchema: afterRenderSchema,
    outputSchema: completedOutputSchema,
    execute: async ({ inputData }) => {
      const store = await getStore();
      const artifact = await runStoreArtifactFile(
        {
          buffer: inputData.buffer,
          format: inputData.format,
          planKind: inputData.planKind,
          title: inputData.title,
          findingIds: inputData.findingIds,
          evidenceIds: (inputData.evidence as Evidence[]).map((e) => e.id),
          ...(inputData.revisionOf ? { revisionOf: inputData.revisionOf } : {}),
        },
        store,
      );
      return { status: 'completed' as const, artifact };
    },
  });

  return createWorkflow({
    id: 'artifact',
    inputSchema: workflowInputSchema,
    outputSchema: completedOutputSchema,
  })
    .then(resolveKindStep)
    .then(gatherEvidenceStep)
    .then(loadSkillStep)
    .then(authorAndValidateStep)
    .then(renderChartsPrecheckStep)
    .then(renderStep)
    .then(storeAndLinkStep)
    .commit();
}

/** The live singleton workflow, wired against real connections, registered by `mastra dev`/production. */
export const artifactWorkflow = buildArtifactWorkflow();
