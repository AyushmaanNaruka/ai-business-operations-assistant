import type { Artifact, Finding, SessionManifest, Source } from '@/types';

/**
 * The builder and updater functions for a SessionManifest (docs/04-MODULES.md M8).
 * Pure functions: each takes a manifest and returns a new one, never mutating
 * the input. Sources, findings and artifacts are upserted by id so a status
 * change (a source moving from pending to ready, an artifact gaining a new
 * version) replaces the prior entry in place rather than duplicating it, and
 * moves that entry to the end of its list. That end-of-list position is what
 * `resolveReference` in `./reference.ts` reads as "most recently touched",
 * so re-adding an item after a status change is also how recency updates.
 */

export function emptyManifest(): SessionManifest {
  return { sources: [], findings: [], artifacts: [], openGaps: [] };
}

export function addSource(manifest: SessionManifest, source: Source): SessionManifest {
  const sources = manifest.sources.filter((s) => s.id !== source.id);
  sources.push(source);
  return { ...manifest, sources };
}

export function addFinding(manifest: SessionManifest, finding: Finding): SessionManifest {
  const findings = manifest.findings.filter((f) => f.id !== finding.id);
  findings.push(finding);
  return { ...manifest, findings };
}

export function addArtifact(manifest: SessionManifest, artifact: Artifact): SessionManifest {
  const artifacts = manifest.artifacts.filter((a) => a.id !== artifact.id);
  artifacts.push(artifact);
  return { ...manifest, artifacts };
}

export function addOpenGap(manifest: SessionManifest, gap: string): SessionManifest {
  if (manifest.openGaps.includes(gap)) return manifest;
  return { ...manifest, openGaps: [...manifest.openGaps, gap] };
}

export function removeOpenGap(manifest: SessionManifest, gap: string): SessionManifest {
  if (!manifest.openGaps.includes(gap)) return manifest;
  return { ...manifest, openGaps: manifest.openGaps.filter((g) => g !== gap) };
}
