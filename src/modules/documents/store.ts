import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';

const DOCUMENTS_DIR = process.env.DOCUMENTS_DIR || 'data/documents';

/** Persists a source's converted markdown (with its citation markers) to disk, keyed by source id. */
export async function saveMarkdown(sourceId: string, markdown: string): Promise<string> {
  await mkdir(DOCUMENTS_DIR, { recursive: true });
  const path = join(DOCUMENTS_DIR, `${sourceId}.md`);
  await writeFile(path, markdown, 'utf8');
  return path;
}

/**
 * Returns a source's whole markdown, markers included: the `full` mode read
 * path (docs/04-MODULES.md M3). The tool-facing version that takes a bare
 * source id and resolves it through the registry is wired in P3.6; this
 * reads back exactly what `saveMarkdown` wrote.
 */
export async function getDocument(sourceId: string): Promise<ToolResult<string>> {
  const path = join(DOCUMENTS_DIR, `${sourceId}.md`);
  try {
    const markdown = await readFile(path, 'utf8');
    return ok(markdown);
  } catch (err) {
    return fail('SOURCE_NOT_FOUND', `No stored document for "${sourceId}": ${(err as Error).message}`, {
      recoverable: false,
    });
  }
}
