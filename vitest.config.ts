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
});
