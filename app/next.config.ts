import { resolve } from "node:path";
import { withAui } from "@assistant-ui/next";
import type { NextConfig } from "next";

// Next only auto-loads .env* files from ITS OWN project root (this directory),
// not the repo root where the real GOOGLE_GENERATIVE_AI_API_KEY / EXA_API_KEY /
// DATABASE_URL etc. live (docs/10-SETUP.md). `process.loadEnvFile` is Node's own
// loader (stable on Node >=20.6, same one src/modules/sources/ingest.test.ts
// already uses) — no dotenv dependency, matching this repo's existing convention.
try {
  process.loadEnvFile(resolve(__dirname, "../.env"));
} catch {
  // no .env file to load; process.env may already carry the keys (CI, shell export)
}

// Every src/mastra/* file that resolves a project-relative path (DATABASE_URL,
// samples/, generated/) does it via `process.env.INIT_CWD || process.cwd()`
// (docs/DECISIONS.md D-09: `mastra dev`'s own cwd quirk). `next dev`/`next
// start` run with cwd set to THIS directory (app/), not the repo root, so
// without this those files would resolve against the wrong root the moment
// they run inside the Next.js process. Setting INIT_CWD here, before any of
// them are imported, makes every one of those existing call sites correct
// with no changes to them.
process.env.INIT_CWD = resolve(__dirname, "..");

/**
 * Browser security headers (docs/DECISIONS.md D-57). The CSP allows only this
 * origin: no third party script, frame, font or connection. 'unsafe-inline' on
 * scripts is what Next.js needs without a nonce setup, and 'unsafe-eval' plus the
 * websocket are dev only (Fast Refresh). frame-src 'self' is what lets the preview
 * panel frame /api/preview/file; frame-ancestors stops anyone else framing the app.
 */
const isDev = process.env.NODE_ENV !== "production";
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const BASE_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: BASE_HEADERS },
      // Not on the raw file route: Chrome's built in PDF viewer will not render a
      // document served with object-src 'none', and that route sets its own
      // sandbox CSP for every non PDF file (app/app/api/preview/file/route.ts).
      { source: "/((?!api/preview/file).*)", headers: [{ key: "Content-Security-Policy", value: CSP }] },
    ];
  },
  // Mastra (and everything it transitively pulls in: DuckDB's native bindings,
  // libsql, Puppeteer, exceljs, pptxgenjs, docx, mammoth, unpdf) must run as real
  // Node modules on the server, never get bundled by webpack/Turbopack — several
  // have native bindings or dynamic requires that bundling breaks (P7.1).
  serverExternalPackages: [
    "@mastra/*",
    "@duckdb/node-api",
    "@duckdb/node-bindings",
    "@libsql/client",
    "puppeteer",
    "pptxgenjs",
    "exceljs",
    "docx",
    "mammoth",
    "unpdf",
    "pdf-parse",
    "jsdom",
    "quickchart-js",
    "gpt-tokenizer",
    "simple-statistics",
    "csv-parse",
    "exa-js",
  ],
};

export default withAui(nextConfig);
