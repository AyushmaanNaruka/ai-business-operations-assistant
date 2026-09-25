import { readdir, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import type { ToolResult } from '@/types';
import { previewFile, previewText, type FilePreview } from '@/modules/preview';
import { fail, ok } from '@/modules/reliability';
import { getManifestSnapshot } from './runtime';

/**
 * Resolves what the chat UI asked to preview to a file on disk, strictly through
 * the conversation's own session manifest: the browser names a source id or an
 * artifact, never a path, so it can only ever open files this conversation
 * actually holds (docs/DECISIONS.md D-50).
 */

const PROJECT_ROOT = process.env.INIT_CWD || process.cwd();
const GENERATED_DIR = resolve(PROJECT_ROOT, 'generated');
const UPLOAD_DIR = resolve(PROJECT_ROOT, 'data/uploads');
const SAMPLES_DIR = resolve(PROJECT_ROOT, 'samples');

/**
 * Sources registered before `Source.path` existed carry only a name. Uploads are
 * stored as `data/uploads/<uuid>/<original name>` (app/app/api/upload/route.ts), so
 * the newest upload with that exact name is the file; the demo samples live in
 * samples/. Exact basename match only, never a path the browser supplied.
 */
async function findStoredFile(name: string): Promise<string | undefined> {
  const safe = basename(name);
  let best: { path: string; mtime: number } | undefined;
  try {
    for (const dir of await readdir(UPLOAD_DIR)) {
      const candidate = resolve(UPLOAD_DIR, dir, safe);
      try {
        const info = await stat(candidate);
        if (info.isFile() && (!best || info.mtimeMs > best.mtime)) best = { path: candidate, mtime: info.mtimeMs };
      } catch {
        // not in this upload directory
      }
    }
  } catch {
    // no uploads directory yet
  }
  if (best) return best.path;
  const sample = resolve(SAMPLES_DIR, safe);
  try {
    if ((await stat(sample)).isFile()) return sample;
  } catch {
    // not a sample either
  }
  return undefined;
}

export type PreviewTarget = { sourceId: string } | { artifactId: string; version?: number } | { artifactFile: string };

export type ResolvedPreviewFile = {
  name: string;
  kind: string; // SourceKind or ArtifactKind
  origin: 'source' | 'artifact';
  /** The file the preview is built from. For a PDF or web source this may be its extracted markdown. */
  previewPath: string;
  /** The original file, when there is one on disk (what the raw file route serves). */
  originalPath?: string;
  downloadUrl?: string;
};

export async function resolvePreviewFile(sessionId: string, target: PreviewTarget): Promise<ToolResult<ResolvedPreviewFile>> {
  const manifest = await getManifestSnapshot(sessionId);

  if ('sourceId' in target) {
    const source = manifest.sources.find((s) => s.id === target.sourceId);
    if (!source) return fail('SOURCE_NOT_FOUND', `No source ${target.sourceId} in this conversation.`);
    if (source.status === 'pending') return fail('SOURCE_PENDING', `${source.name} is still being read. Try again in a moment.`);
    // Prefer the original upload; fall back to the extracted text, which is all a
    // web page has and all a source registered before paths were recorded has.
    const originalPath = source.path ?? (source.origin === 'upload' ? await findStoredFile(source.name) : undefined);
    const previewPath = originalPath ?? source.doc?.markdownPath;
    if (!previewPath) {
      return fail('SOURCE_NOT_FOUND', `${source.name} has no stored copy to preview. Upload it again to preview it.`);
    }
    return ok({
      name: source.name,
      kind: source.kind,
      origin: 'source',
      previewPath,
      ...(originalPath ? { originalPath } : {}),
    });
  }

  if ('artifactId' in target) {
    const versions = manifest.artifacts.filter((a) => a.id === target.artifactId);
    const artifact =
      target.version !== undefined
        ? versions.find((a) => a.version === target.version)
        : versions.sort((a, b) => b.version - a.version)[0];
    if (!artifact) return fail('SOURCE_NOT_FOUND', `No generated file ${target.artifactId} in this conversation.`);
    return ok({
      name: basename(artifact.path),
      kind: artifact.kind,
      origin: 'artifact',
      previewPath: artifact.path,
      originalPath: artifact.path,
      downloadUrl: artifact.downloadUrl,
    });
  }

  // A `/generated/<file>` link written into a chat answer. Matched against the
  // manifest first; failing that, the file itself under generated/, which the
  // download route already serves to anyone holding the link.
  const filename = basename(target.artifactFile);
  const artifact = manifest.artifacts.find((a) => basename(a.downloadUrl) === filename);
  const path = artifact?.path ?? resolve(GENERATED_DIR, filename);
  if (!path.startsWith(GENERATED_DIR) && !artifact) return fail('SOURCE_NOT_FOUND', `No generated file named ${filename}.`);
  return ok({
    name: filename,
    kind: artifact?.kind ?? extname(filename).slice(1),
    origin: 'artifact',
    previewPath: path,
    originalPath: path,
    downloadUrl: artifact?.downloadUrl ?? `/generated/${filename}`,
  });
}

export async function previewForSession(
  sessionId: string,
  target: PreviewTarget,
): Promise<ToolResult<{ file: Omit<ResolvedPreviewFile, 'previewPath' | 'originalPath'>; preview: FilePreview }>> {
  const resolved = await resolvePreviewFile(sessionId, target);
  if (!resolved.ok) return resolved;
  const { previewPath, originalPath: _originalPath, ...file } = resolved.data;

  let preview = await previewFile(previewPath);
  // An upload that has since been deleted from disk can still show its extracted text.
  if (!preview.ok && preview.error.code === 'SOURCE_NOT_FOUND' && resolved.data.origin === 'source') {
    const manifest = await getManifestSnapshot(sessionId);
    const markdownPath = manifest.sources.find((s) => 'sourceId' in target && s.id === target.sourceId)?.doc?.markdownPath;
    if (markdownPath && markdownPath !== previewPath) preview = await previewText(markdownPath, 'markdown');
  }
  if (!preview.ok) return preview;
  return ok({ file, preview: preview.data });
}
