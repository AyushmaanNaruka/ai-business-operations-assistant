import type { PreviewTarget } from "@/mastra/preview";
import { readSessionId } from "@ui/lib/server-security";

/**
 * Reads what to preview from the query string: `sourceId`, `artifactId` (plus an
 * optional `version`), or `file` for a `/generated/<file>` link in a chat answer.
 * The browser only ever names one of those, never a path on disk.
 */
export function parsePreviewRequest(req: Request): { threadId: string; target: PreviewTarget } | null {
  const url = new URL(req.url);
  const threadId = readSessionId(url.searchParams.get("threadId"));
  if (!threadId) return null;
  // Ids are short tokens ("src_4", "art_1") and file names a plain basename; anything
  // else is refused here, before it reaches the manifest lookup (D-56).
  const token = (v: string | null) => (v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);
  const sourceId = token(url.searchParams.get("sourceId"));
  const artifactId = token(url.searchParams.get("artifactId"));
  const rawFile = url.searchParams.get("file");
  const file = rawFile && /^[A-Za-z0-9._-]{1,200}$/.test(rawFile) && !rawFile.startsWith(".") ? rawFile : null;
  if (sourceId) return { threadId, target: { sourceId } };
  if (artifactId) {
    const version = Number(url.searchParams.get("version"));
    return { threadId, target: Number.isInteger(version) && version > 0 ? { artifactId, version } : { artifactId } };
  }
  if (file) return { threadId, target: { artifactFile: file } };
  return null;
}
