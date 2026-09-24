import type { ArtifactKind, SessionManifest, SourceKind } from '@/types';

/**
 * The result of resolving a phrase like "the other one" or "the spreadsheet"
 * against a SessionManifest (docs/04-MODULES.md M8).
 *
 * This is the anti-guessing mechanism for P5.1: when more than one item
 * plausibly matches, the caller gets `ambiguous` with every candidate id and
 * must ask a short clarifying question rather than pick one. When nothing
 * matches, the caller gets `none` and reports a gap rather than assuming.
 *
 * The prompt's reference type only sketches a `sourceId` match, since the
 * examples it gives ("the other one", "the spreadsheet", "the brief") are
 * all sources. This adds `findingId` and `artifactId` match variants too,
 * because "this finding" and "the deck" are equally natural references and
 * the manifest holds both; see the final report for this as a noted
 * deviation to fold into docs/DECISIONS.md.
 */
export type ReferenceResolution =
  | { kind: 'match'; sourceId: string }
  | { kind: 'match'; findingId: string }
  | { kind: 'match'; artifactId: string }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'none' };

type Candidate = { type: 'source' | 'artifact'; id: string };

// Generic words that map to a set of source kinds, for phrases that name a
// kind of file rather than a filename ("the spreadsheet" when the file is
// actually named campaigns.xlsx). "brief"/"document"/"report" all fall back
// to the prose kinds because that is what a business brief typically is.
const SOURCE_KIND_KEYWORDS: Record<string, SourceKind[]> = {
  spreadsheet: ['xlsx', 'csv'],
  workbook: ['xlsx'],
  excel: ['xlsx'],
  csv: ['csv'],
  pdf: ['pdf'],
  word: ['docx'],
  docx: ['docx'],
  brief: ['pdf', 'docx', 'txt'],
  document: ['pdf', 'docx', 'txt'],
  doc: ['pdf', 'docx', 'txt'],
  report: ['pdf', 'docx', 'txt'],
  text: ['txt'],
  website: ['web'],
  webpage: ['web'],
  site: ['web'],
  page: ['web'],
  url: ['web'],
  company: ['web'],
};

// Generated deliverables ("the deck") live in `manifest.artifacts`, not
// `manifest.sources`, so they get their own keyword table.
const ARTIFACT_KIND_KEYWORDS: Record<string, ArtifactKind[]> = {
  deck: ['pptx'],
  presentation: ['pptx'],
  slides: ['pptx'],
  slideshow: ['pptx'],
  powerpoint: ['pptx'],
  workbook: ['xlsx'],
  spreadsheet: ['xlsx'],
};

const DEMONSTRATIVE_ONLY = new Set([
  'this',
  'that',
  'it',
  'this one',
  'that one',
  'last one',
  'most recent one',
  'most recent',
]);

export function resolveReference(phrase: string, manifest: SessionManifest): ReferenceResolution {
  const normalized = normalize(phrase);
  const words = normalized.split(/\s+/).filter(Boolean);

  if (/\bother\b/.test(normalized)) {
    return resolveOtherOne(manifest);
  }

  if (words.includes('finding') || words.includes('result') || words.includes('conclusion')) {
    if (manifest.findings.length === 0) return { kind: 'none' };
    const mostRecent = manifest.findings[manifest.findings.length - 1]!;
    return { kind: 'match', findingId: mostRecent.id };
  }

  if (DEMONSTRATIVE_ONLY.has(normalized)) {
    if (manifest.sources.length === 0) return { kind: 'none' };
    const mostRecent = manifest.sources[manifest.sources.length - 1]!;
    return { kind: 'match', sourceId: mostRecent.id };
  }

  const candidates = matchByNameOrKind(normalized, words, manifest);
  if (candidates.length === 0) return { kind: 'none' };
  if (candidates.length === 1) return toMatch(candidates[0]!);
  return { kind: 'ambiguous', candidates: dedupe(candidates.map((c) => c.id)) };
}

function resolveOtherOne(manifest: SessionManifest): ReferenceResolution {
  const sources = manifest.sources;
  if (sources.length === 0 || sources.length === 1) return { kind: 'none' };

  const mostRecent = sources[sources.length - 1]!;
  if (sources.length === 2) {
    const other = sources.find((s) => s.id !== mostRecent.id)!;
    return { kind: 'match', sourceId: other.id };
  }

  // More than two sources loaded: "the other one" implies exactly one
  // alternative, which is no longer true, so this is ambiguous among
  // everything except the most recently touched source.
  const rest = sources.filter((s) => s.id !== mostRecent.id).map((s) => s.id);
  return { kind: 'ambiguous', candidates: rest };
}

/**
 * A literal filename/title match ("northwind-brief.pdf" for "the brief") is
 * stronger evidence than a generic kind keyword match ("brief" -> any
 * pdf/docx/txt source, per SOURCE_KIND_KEYWORDS): the keyword table exists so
 * a phrase naming a *kind of file* ("the spreadsheet") still resolves when no
 * source's name happens to contain that word, not to relitigate a source a
 * user just named directly. Name matches are therefore checked first and, when
 * any are found, returned on their own; the generic kind tables are only
 * consulted as a fallback when nothing matched by name. Without this split, a
 * session with both northwind-brief.pdf and customer-notes.docx loaded (the
 * exact P5.7 four-turn conversation, all four sample sources uploaded)
 * resolves "the brief" as ambiguous between the two, even though only one
 * source's actual filename contains the word "brief": the generic keyword
 * hit on customer-notes.docx (any docx counts as a "brief") drowned out the
 * specific one. See docs/DECISIONS.md for this as its own entry.
 */
function matchByNameOrKind(normalized: string, words: string[], manifest: SessionManifest): Candidate[] {
  const nameCandidates: Candidate[] = [];
  const kindCandidates: Candidate[] = [];

  for (const source of manifest.sources) {
    const stem = stemOf(source.name);
    if (stem.length >= 3 && (normalized.includes(stem) || stem.includes(normalized))) {
      nameCandidates.push({ type: 'source', id: source.id });
    }
  }
  for (const [keyword, kinds] of Object.entries(SOURCE_KIND_KEYWORDS)) {
    if (!words.includes(keyword)) continue;
    for (const source of manifest.sources) {
      if (kinds.includes(source.kind)) kindCandidates.push({ type: 'source', id: source.id });
    }
  }

  for (const artifact of manifest.artifacts) {
    const stem = stemOf(artifact.title);
    if (stem.length >= 3 && (normalized.includes(stem) || stem.includes(normalized))) {
      nameCandidates.push({ type: 'artifact', id: artifact.id });
    }
  }
  for (const [keyword, kinds] of Object.entries(ARTIFACT_KIND_KEYWORDS)) {
    if (!words.includes(keyword)) continue;
    for (const artifact of manifest.artifacts) {
      if (kinds.includes(artifact.kind)) kindCandidates.push({ type: 'artifact', id: artifact.id });
    }
  }

  const deduped = dedupeCandidates(nameCandidates);
  return deduped.length > 0 ? deduped : dedupeCandidates(kindCandidates);
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const result: Candidate[] = [];
  for (const c of candidates) {
    const key = `${c.type}:${c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(c);
  }
  return result;
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

function toMatch(candidate: Candidate): ReferenceResolution {
  return candidate.type === 'source'
    ? { kind: 'match', sourceId: candidate.id }
    : { kind: 'match', artifactId: candidate.id };
}

function normalize(phrase: string): string {
  return phrase
    .trim()
    .toLowerCase()
    .replace(/[?.!]+$/, '')
    .replace(/^(the|a|an)\s+/, '')
    .trim();
}

function stemOf(name: string): string {
  return name.toLowerCase().replace(/\.[a-z0-9]{1,5}$/, '').trim();
}
