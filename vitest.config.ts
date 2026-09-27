import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

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
    // Excludes Vitest's own defaults (node_modules, dist, .git, ...) plus
    // .claude/worktrees: an agent worktree checked out under the repo root
    // duplicates every test file, and if its checkout isn't cleaned up
    // afterwards those duplicates run alongside the real ones and collide
    // over the same on-disk DuckDB/LibSQL files.
    exclude: [...configDefaults.exclude, '.claude/**'],
    // Vitest's 5s default is too tight once every fork loads DuckDB (and its excel
    // extension) at the same time: DuckDB-heavy tests that take ~1s alone were timing
    // out under a full parallel run. A test that needs longer still sets its own.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
