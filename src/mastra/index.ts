import { resolve } from 'node:path';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import {
  MastraStorageExporter,
  MastraPlatformExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';
import { agent } from './agents/agent';

// `mastra dev` runs the bundled server with its cwd set to src/mastra/public, not the
// project root, so a relative `file:` URL resolves to the wrong place. npm sets
// INIT_CWD to the directory `npm run dev` was invoked from, which is the project root;
// fall back to process.cwd() for other entry points (tests, `mastra build` output).
const projectRoot = process.env.INIT_CWD || process.cwd();

function resolveDatabaseUrl(raw: string): string {
  if (!raw.startsWith('file:')) return raw; // remote libsql:// / Turso URLs pass through untouched
  const filePath = raw.slice('file:'.length);
  const isAbsolute = filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath);
  return isAbsolute ? raw : `file:${resolve(projectRoot, filePath)}`;
}

// One LibSQL file holds memory, vectors and the evidence ledger, per docs/06-RESEARCH-STACK.md.
const DATABASE_URL = resolveDatabaseUrl(process.env.DATABASE_URL || 'file:./data/app.db');

export const mastra = new Mastra({
  bundler: {
    externals: ['@duckdb/node-bindings'],
  },
  agents: { agent },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: DATABASE_URL,
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new MastraStorageExporter(), new MastraPlatformExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
