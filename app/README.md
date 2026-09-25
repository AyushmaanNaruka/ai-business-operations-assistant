# Chat UI

The Next.js front end of the Business Operations Assistant. It imports the Mastra backend directly from `../src` (the `@/*` path alias), so there is no separate API server to run. Setup, keys and running are in `docs/10-SETUP.md` at the repo root; this file is the map of this folder.

Environment variables are read from the repo root `.env` (loaded by `next.config.ts`), not from a `.env.local` here.

```bash
npm run dev      # development, localhost:3000
npm run build    # production build
npm run start    # production server: use this when sharing, dev relaxes the CSP
npm run lint     # oxlint and oxfmt
```

## Layout

| Path | What it is |
|---|---|
| `app/assistant.tsx` | The shell: conversation sidebar, chat, files and preview panels, and `?c=<id>` routing |
| `app/api/chat/route.ts` | Streams an orchestrator turn. Forwards only validated messages (docs/11-SECURITY.md) |
| `app/api/upload/route.ts` | Streams an upload to disk with a size cap, then ingests it |
| `app/api/manifest/route.ts` | A conversation's sources and generated files, polled by the UI |
| `app/api/conversations/` | List, load, rename and delete conversations (Mastra Memory) |
| `app/api/preview/` | Typed file previews, and the raw file for the PDF viewer |
| `app/api/status/route.ts` | Which models are configured (ids only) |
| `app/generated/[filename]/route.ts` | Downloads for generated artifacts |
| `proxy.ts` | Optional shared password gate (`APP_ACCESS_PASSWORD`) |
| `next.config.ts` | Loads the root `.env`, keeps Mastra's native packages unbundled, sets security headers |
| `lib/server-security.ts` | Rate limits, id validation, generic error responses |
| `components/conversation-sidebar.tsx` | The left sidebar |
| `components/session-files.tsx` | Per conversation files, uploads and preview state |
| `components/sources-panel.tsx`, `components/preview-panel.tsx` | The right hand Files and Preview panels |
| `components/assistant-ui/elements/` | The chat thread, composer and message rendering (assistant-ui) |

Built on [assistant-ui](https://github.com/assistant-ui/assistant-ui). This Next.js version names middleware `proxy.ts`; read `node_modules/next/dist/docs/` before changing framework conventions (see `AGENTS.md` in this folder).
