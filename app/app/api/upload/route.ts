import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { randomUUID } from "node:crypto";
import { ingestForSession } from "@/mastra/runtime";

// docs/03-ARCHITECTURE.md Part 10 gap 4 / PROMPTBOOK P7.2: uploads stream straight
// to disk, never buffered into memory, and type + size are checked BEFORE the
// heavy work starts, so a wrong file fails in about a second. The client sends
// the raw file bytes as the request body (not multipart/form-data), which is
// what lets `req.body` be piped to disk with zero new dependencies — no
// multipart parser needed, matching AGENTS.md's "free tiers / deliberate
// dependency set" rule (no busboy/formidable required for this).
export const maxDuration = 60;

const PROJECT_ROOT = resolve(process.cwd(), "..");
const UPLOAD_DIR = resolve(PROJECT_ROOT, "data/uploads");

const SUPPORTED_EXTENSIONS = new Set([".xlsx", ".csv", ".pdf", ".docx", ".txt", ".json"]);

function maxUploadBytes(): number {
  const mb = Number(process.env.MAX_UPLOAD_MB || "100");
  return (Number.isFinite(mb) && mb > 0 ? mb : 100) * 1024 * 1024;
}

class UploadTooLargeError extends Error {}

/** Backstop against a missing/understated Content-Length: aborts the write mid-stream, not just at the door. */
function capBytes(limit: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk, _enc, callback) {
      seen += chunk.length;
      if (seen > limit) {
        callback(new UploadTooLargeError(`Upload exceeds the ${(limit / (1024 * 1024)).toFixed(0)}MB limit.`));
        return;
      }
      callback(null, chunk);
    },
  });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId") || "default-thread";
  const rawName = url.searchParams.get("name") || "upload";
  const name = basename(rawName); // strips any path component a client could smuggle in

  const ext = extname(name).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return Response.json(
      {
        error:
          ext === ".xls" || ext === ".doc"
            ? `"${name}" is a legacy binary Office file (${ext}), which this system does not read. Save it as ${ext === ".xls" ? ".xlsx" : ".docx"} and upload that instead.`
            : `"${name}" has an unsupported extension (${ext || "none"}). Supported: .xlsx, .csv, .pdf, .docx, .txt, .json.`,
      },
      { status: 415 },
    );
  }

  const limit = maxUploadBytes();
  const declaredLength = Number(req.headers.get("content-length") || "0");
  if (declaredLength > limit) {
    return Response.json(
      { error: `"${name}" is ${(declaredLength / (1024 * 1024)).toFixed(1)}MB, over the ${(limit / (1024 * 1024)).toFixed(0)}MB limit.` },
      { status: 413 },
    );
  }
  if (!req.body) {
    return Response.json({ error: "No file content received." }, { status: 400 });
  }

  // A per-upload directory named by uuid, with the ORIGINAL filename inside it,
  // rather than a uuid-prefixed filename: `ingest()` (src/modules/sources) takes
  // the Source's display name from `basename(path)`, so this is what keeps the
  // user's own filename showing in the sources panel instead of a mangled one,
  // while still guaranteeing no collision between two uploads of the same name.
  const uploadDir = resolve(UPLOAD_DIR, randomUUID());
  await mkdir(uploadDir, { recursive: true });
  const diskPath = resolve(uploadDir, name);

  try {
    await pipeline(Readable.fromWeb(req.body as never), capBytes(limit), createWriteStream(diskPath));
  } catch (err) {
    await unlink(diskPath).catch(() => {});
    if (err instanceof UploadTooLargeError) {
      return Response.json({ error: err.message }, { status: 413 });
    }
    return Response.json({ error: `Could not save "${name}": ${(err as Error).message}` }, { status: 500 });
  }

  // Returns immediately with a `pending` source card; ingestForSession finishes
  // detection/parsing/profiling in the background (docs/03-ARCHITECTURE.md Part
  // 10 gap 1) and mirrors the final status into this thread's manifest itself.
  // AGENTS.md rule 5 (never let an exception reach the caller unhandled) applies
  // just as much to an HTTP route as to a Mastra tool: a dropped manifest-store
  // write here should read as a clear error, not a raw framework 500 page.
  try {
    const source = await ingestForSession(threadId, { path: diskPath });
    return Response.json({ source });
  } catch (err) {
    return Response.json({ error: `"${name}" was saved but could not be registered: ${(err as Error).message}` }, { status: 500 });
  }
}
