import { previewForSession } from "@/mastra/preview";
import { parsePreviewRequest } from "./target";

// The preview panel's content for one source or generated file: a typed
// FilePreview built by deterministic code (src/modules/preview), never by a model.
export async function GET(req: Request) {
  const parsed = parsePreviewRequest(req);
  if (!parsed) return Response.json({ error: "Name a sourceId, artifactId or file to preview." }, { status: 400 });
  try {
    const result = await previewForSession(parsed.threadId, parsed.target);
    if (!result.ok) {
      const status = result.error.code === "SOURCE_NOT_FOUND" ? 404 : result.error.code === "SOURCE_PENDING" ? 409 : 422;
      return Response.json({ error: result.error.message }, { status });
    }
    return Response.json(result.data);
  } catch (err) {
    return Response.json({ error: `Could not build a preview: ${(err as Error).message}` }, { status: 500 });
  }
}
