import type { PreviewTarget } from "@/mastra/preview";

/**
 * Reads what to preview from the query string: `sourceId`, `artifactId` (plus an
 * optional `version`), or `file` for a `/generated/<file>` link in a chat answer.
 * The browser only ever names one of those, never a path on disk.
 */
export function parsePreviewRequest(req: Request): { threadId: string; target: PreviewTarget } | null {
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId") || "default-thread";
  const sourceId = url.searchParams.get("sourceId");
  const artifactId = url.searchParams.get("artifactId");
  const file = url.searchParams.get("file");
  if (sourceId) return { threadId, target: { sourceId } };
  if (artifactId) {
    const version = Number(url.searchParams.get("version"));
    return { threadId, target: Number.isInteger(version) && version > 0 ? { artifactId, version } : { artifactId } };
  }
  if (file) return { threadId, target: { artifactFile: file } };
  return null;
}
