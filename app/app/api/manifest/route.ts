import { getManifestSnapshot } from "@/mastra/runtime";
import { enforceRateLimit, internalError, invalidSessionIdResponse, readSessionId } from "@ui/lib/server-security";

// Polled by the Sources panel (app/components/sources-panel.tsx) every couple of
// seconds so uploads show live pending/ready/failed status and finished
// artifacts show up as download links, without needing a websocket/SSE channel
// for what is, for a demo-scale UI, a small and infrequently changing manifest.
export async function GET(req: Request) {
  const limited = enforceRateLimit(req, "read");
  if (limited) return limited;
  const threadId = readSessionId(new URL(req.url).searchParams.get("threadId"));
  if (!threadId) return invalidSessionIdResponse();
  try {
    const manifest = await getManifestSnapshot(threadId);
    return Response.json({
      // `path` is a server side disk path (src/types/source.ts); the browser
      // previews a source by id through /api/preview, never by path.
      sources: manifest.sources.map(({ path: _path, ...source }) => source),
      artifacts: manifest.artifacts,
      openGaps: manifest.openGaps,
    });
  } catch (err) {
    // AGENTS.md rule 5: an exception here should read as a clear error to the
    // polling Sources panel, not a raw framework 500.
    return internalError("Could not read this conversation's files", err);
  }
}
