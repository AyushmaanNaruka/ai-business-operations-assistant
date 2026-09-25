import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { resolvePreviewFile } from "@/mastra/preview";
import { parsePreviewRequest } from "../target";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

// The original file behind a preview, served inline so the browser's own PDF
// viewer can show it in the preview panel's iframe. Resolved through the
// conversation's manifest (src/mastra/preview.ts), so it can only serve a file
// the conversation holds, never an arbitrary path.
export async function GET(req: Request) {
  const parsed = parsePreviewRequest(req);
  if (!parsed) return Response.json({ error: "Name a sourceId, artifactId or file." }, { status: 400 });
  try {
    const resolved = await resolvePreviewFile(parsed.threadId, parsed.target);
    if (!resolved.ok) return Response.json({ error: resolved.error.message }, { status: 404 });
    const path = resolved.data.originalPath;
    if (!path) return Response.json({ error: `${resolved.data.name} has no original file on disk.` }, { status: 404 });
    const data = await readFile(path);
    const ext = extname(path).toLowerCase();
    const headers: Record<string, string> = {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${basename(path).replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
    };
    // Belt and braces for a user supplied file opened directly: nothing it contains
    // may run script. Not applied to PDFs, because Chrome's built in PDF viewer
    // refuses to render a document served under a `sandbox` policy.
    if (ext !== ".pdf") headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";
    return new Response(new Uint8Array(data), { headers });
  } catch (err) {
    return Response.json({ error: `Could not read that file: ${(err as Error).message}` }, { status: 500 });
  }
}
