import type { Artifact, Finding, SessionManifest, Source } from '@/types';

/**
 * Renders a SessionManifest into the compact text form the orchestrator
 * reads first every turn (docs/03-ARCHITECTURE.md section 7, "Session and
 * memory"; docs/04-MODULES.md M8). Kept terse on purpose: this is meant to
 * stay in context permanently across a long conversation, not to read well
 * as a report.
 *
 * Source cards reuse `Source.summary`, which is the exact text
 * `buildSourceCard` (src/modules/sources/sourceCard.ts) wrote at ingest
 * time, so source formatting lives in one place. This module only appends
 * the status, since `summary` does not carry it.
 */
export function renderManifest(manifest: SessionManifest): string {
  const sections = [
    renderSection('SOURCES', manifest.sources, renderSource),
    renderSection('FINDINGS', manifest.findings, renderFinding),
    renderSection('ARTIFACTS', manifest.artifacts, renderArtifact),
    renderSection('OPEN GAPS', manifest.openGaps, (gap) => `  - ${gap}`),
  ];
  return sections.join('\n\n');
}

function renderSection<T>(heading: string, items: T[], renderItem: (item: T) => string): string {
  const body = items.length > 0 ? items.map(renderItem).join('\n') : '  (none)';
  return `${heading}\n${body}`;
}

function renderSource(source: Source): string {
  const failed = source.status === 'failed' && source.error;
  // A failed source's `summary` is still whatever placeholder ingest() wrote
  // before parsing even started ("detecting type...", "reading..."):
  // ingest.ts never rewrites it on failure, since buildSourceCard needs a
  // parsed doc/table shape a failed source never gets. Showing that stale
  // "still working" phrase right next to "[failed: ...]" reads as broken to
  // a non technical user, so a failed source ignores `summary` entirely and
  // renders from just its id and name instead.
  const base = failed ? `${source.id}  ${source.name}` : source.summary.length > 0 ? source.summary : `${source.id}  ${source.name}`;
  const lines = base.split('\n');
  const statusText = failed ? `failed: ${source.error!.message}` : source.status;
  lines[0] = `${lines[0]}  [${statusText}]`;
  return lines.map((line) => `  ${line}`).join('\n');
}

function renderFinding(finding: Finding): string {
  const caveats = finding.caveats && finding.caveats.length > 0 ? `  (${finding.caveats.join('; ')})` : '';
  return `  ${finding.id}  ${finding.statement}  [${finding.evidenceIds.join(', ')}]  ${finding.confidence}${caveats}`;
}

function renderArtifact(artifact: Artifact): string {
  return `  ${artifact.id}  ${artifact.title}  ${artifact.kind}  v${artifact.version}`;
}
