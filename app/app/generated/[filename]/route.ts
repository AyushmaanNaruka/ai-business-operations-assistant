import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

// Serves what src/mastra/workflows/artifactSteps.ts's storeAndLink step writes to
// `<repo root>/generated/` under the exact `downloadUrl` (`/generated/<filename>`)
// an Artifact carries (P6.6/P6.7) and the chat UI's download links use (P7.1).
const PROJECT_ROOT = resolve(process.cwd(), "..");
const GENERATED_DIR = resolve(PROJECT_ROOT, "generated");

const CONTENT_TYPES: Record<string, string> = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
};

export async function GET(_req: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename: rawFilename } = await params;
  const filename = basename(rawFilename); // never trust a path segment as a path
  const path = resolve(GENERATED_DIR, filename);

  if (!path.startsWith(GENERATED_DIR)) {
    return Response.json({ error: "Invalid filename." }, { status: 400 });
  }

  try {
    const data = await readFile(path);
    const contentType = CONTENT_TYPES[extname(filename).toLowerCase()] ?? "application/octet-stream";
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      },
    });
  } catch {
    return Response.json({ error: `"${filename}" was not found. It may not have finished generating yet.` }, { status: 404 });
  }
}
