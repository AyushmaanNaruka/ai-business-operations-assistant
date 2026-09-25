import { getManifestSnapshot } from "@/mastra/runtime";

// Polled by the Sources panel (app/components/sources-panel.tsx) every couple of
// seconds so uploads show live pending/ready/failed status and finished
// artifacts show up as download links, without needing a websocket/SSE channel
// for what is, for a demo-scale UI, a small and infrequently changing manifest.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId") || "default-thread";
  try {
    const manifest = await getManifestSnapshot(threadId);
    return Response.json({
      sources: manifest.sources,
      artifacts: manifest.artifacts,
      openGaps: manifest.openGaps,
    });
  } catch (err) {
    // AGENTS.md rule 5: an exception here should read as a clear error to the
    // polling Sources panel, not a raw framework 500.
    return Response.json({ error: `Could not read session state: ${(err as Error).message}` }, { status: 500 });
  }
}
