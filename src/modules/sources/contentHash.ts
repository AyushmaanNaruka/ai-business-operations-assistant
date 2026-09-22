import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Hashes a file's bytes so identical uploads are recognised regardless of
 * name or path. Re-ingesting a file with a hash already in the registry
 * should cost nothing (docs/04-MODULES.md M1: "parsed output cached by file
 * hash").
 */
export async function hashFile(path: string): Promise<string> {
  const buffer = await readFile(path);
  return createHash('sha256').update(buffer).digest('hex');
}
