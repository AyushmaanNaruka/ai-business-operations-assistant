import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

// Mirrors tsconfig.json's "@/*" -> "./src/*" path alias. tsconfig paths alone
// only help TypeScript's type checker and `import type` (which esbuild elides
// before resolution); a runtime value import across modules, e.g.
// `import { ok } from '@/modules/reliability'`, needs this to actually resolve
// under Vitest.
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(rootDir, 'src'),
    },
  },
  test: {
    // 'forks' gives every test file its own process instead of sharing a worker
    // thread's globalThis. src/modules/research/readPage.test.ts stubs global
    // fetch with vi.stubGlobal and restores it in afterEach, which is correct
    // in isolation, but under the default 'threads' pool a same-worker
    // neighbour file can still observe stale fetch mock state mid-run once
    // enough test files exist to change how Vitest bin-packs them into
    // workers. 'forks' trades a little startup cost for real isolation.
    pool: 'forks',
  },
});
