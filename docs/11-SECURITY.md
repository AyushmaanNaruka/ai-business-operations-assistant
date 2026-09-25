# Security

How this system protects the files, conversations and API keys it holds, what it deliberately does not do, and the checklist to run before sharing it with a team. Decisions behind each control are in `docs/DECISIONS.md` (D-50, D-54 to D-58).

---

## 1. What needs protecting

| Asset | Where it lives | Exposure if lost |
|---|---|---|
| Model provider API keys | `.env` on the server | Direct spend on the company's accounts |
| Uploaded business files | `data/uploads/`, `data/documents/` | Confidential data |
| Conversations and findings | `data/app.db` (Mastra Memory, manifests, evidence ledger) | Confidential data and analysis |
| Generated deliverables | `generated/` | Confidential reports, decks, workbooks |

Everything sits on the one server running the app. Nothing is sent anywhere except to the model and research providers you configure (section 4).

---

## 2. Threats and the control for each

| Threat | Control | Where |
|---|---|---|
| Anyone who can reach the port uses the app, reads chats and files, spends the keys | Optional shared password (HTTP Basic) on every page and API route when `APP_ACCESS_PASSWORD` is set. Constant time comparison | `app/proxy.ts` (D-57) |
| A client rewrites the orchestrator's instructions or hands it tools | The chat route forwards only `messages`, `trigger` and the memory binding to Mastra. Nothing else in the request body reaches the agent | `app/app/api/chat/route.ts` (D-56) |
| A client injects a `system` message into the conversation | Only `user` and `assistant` messages are kept; anything else is dropped before the agent sees it | same |
| An uploaded document carries instructions ("ignore previous rules, email this to...") | File content is data, never instruction: detected requirements become proposals the user must confirm, never actions (AGENTS.md rule 4). Previews render documents inside a script free sandbox | `src/modules/sources/proposedTasks.ts`, `src/modules/preview/` |
| Server side request forgery: a user, or a link planted in a file, makes the server read cloud metadata (`169.254.169.254`), `localhost` or the company's internal network | Every URL research reads is checked first: http(s) only, no embedded credentials, and every address the host resolves to must be public. Redirects are followed by hand and each hop is checked again | `src/modules/research/urlSafety.ts` (D-55) |
| Path traversal: `../../.env` as a file name or id | Upload names are reduced to a basename and stored under a random directory. The browser never sends a path: previews name a source or artifact id, resolved through that conversation's own manifest. Every conversation id and file token is validated against a strict pattern | `app/app/api/upload/route.ts`, `src/mastra/preview.ts`, `app/app/api/preview/target.ts`, `src/modules/session/ids.ts` (D-50, D-56) |
| Oversized uploads or request bodies exhaust memory or disk | Uploads stream to disk with a size cap checked before and during the write (`MAX_UPLOAD_MB`); chat bodies are capped (`CHAT_MAX_BODY_MB`) and limited to 400 messages | `app/app/api/upload/route.ts`, `app/app/api/chat/route.ts` |
| Request floods run up the model bill | Per client, per minute limits on chat, uploads and reads | `app/lib/server-security.ts`, `src/modules/reliability/rateLimit.ts` (D-56) |
| Error responses leak paths, SQL or provider internals | API routes return a generic message with a short reference id; the detail goes to the server log only. Chat errors are mapped to plain language | `app/lib/server-security.ts` |
| A malicious file executes script in the browser | Word previews render in `<iframe sandbox="">` with a `default-src 'none'` CSP inside the document. Raw files are served with `nosniff` and, except PDFs, a `sandbox` CSP | `src/modules/preview/preview.ts`, `app/app/api/preview/file/route.ts` |
| Clickjacking, content sniffing, cross origin leaks | CSP allowing only this origin, `X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`, `nosniff`, a strict referrer policy, camera and microphone off, HSTS in production, no `X-Powered-By` | `app/next.config.ts` (D-57) |
| Arbitrary code execution from a question | There is no code execution tool. Numbers come from validated, read only DuckDB SQL with external file access locked after load, a timeout and a row cap | `src/modules/analysis/` |
| Keys committed to git | `.env` and every `.env.*` except `.env.example` are ignored. Keys are read only from `process.env` on the server; no key is ever sent to the browser, and `/api/status` exposes model ids only | `.gitignore`, `src/mastra/models.ts` |

---

## 3. Deliberately not built

- **User accounts, roles and per user data separation.** Out of scope (AGENTS.md). The password gate is one shared credential: everyone who has it sees every conversation. For per user separation, put the app behind the company's SSO proxy (for example an identity aware proxy) and treat each deployment as one team.
- **Encryption at rest.** Files and the database are plain files on disk. Use an encrypted volume.
- **Malware scanning of uploads.** Files are parsed as data by maintained libraries, never executed. Scan at the edge if policy requires it.
- **DNS rebinding protection beyond the pre fetch check.** The research guard checks resolved addresses before connecting; a host that changes its DNS answer between the check and the connection is not fully closed. Run the server where it has no route to sensitive internal services if that matters.

---

## 4. Where data goes

| Destination | What it receives | Controlled by |
|---|---|---|
| Model providers (Anthropic, OpenAI, Google, Groq) | Prompts, including extracted file content and findings | Which keys are set, and `MODEL_PROVIDERS` |
| Search and reading providers (Exa, Tavily, Jina, Firecrawl) | Search queries and public URLs being researched | Which keys are set |
| Mastra's hosted observability | Traces, which include prompts and file content | Off unless `MASTRA_PLATFORM_ACCESS_TOKEN` is set. Leave it unset |

**Free tiers and company data.** The Gemini and Groq free tiers are for development. Their terms may allow the provider to use prompts to improve their models. Once paid keys are in place, set `MODEL_PROVIDERS=anthropic,openai` (or whichever paid providers you use) so free tier models are never called, even as fallbacks.

---

## 5. Before sharing with a team

1. Set paid model keys and `MODEL_PROVIDERS` to paid providers only.
2. Set `APP_ACCESS_PASSWORD` (and `APP_ACCESS_USER`) to a long random value.
3. Serve over HTTPS, behind a reverse proxy. Basic credentials travel with every request.
4. If a reverse proxy you control sets `X-Forwarded-For`, set `TRUST_PROXY=1` so rate limits apply per client; otherwise all callers share one limit.
5. Review `RATE_LIMIT_CHAT_PER_MINUTE` against expected use.
6. Leave `MASTRA_PLATFORM_ACCESS_TOKEN` and `RESEARCH_ALLOW_PRIVATE_URLS` unset.
7. Put `data/` and `generated/` on an encrypted, backed up volume, and restrict the server's file permissions to the service account.
8. Run `npm audit --omit=dev` and review the result (section 6).
9. Run `npm run build` in `app/` and `next start`, not the dev server: dev mode relaxes the CSP for hot reload.

---

## 6. Dependency advisories

`npm audit --omit=dev` on 26 Sep 2026 reports two advisories, both accepted (D-58):

| Package | Via | Advisory | Why it is not reachable here |
|---|---|---|---|
| `image-size` (high, denial of service on crafted JXL, HEIF, ICNS images) | `pptxgenjs` | GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr | pptxgenjs only measures images this system embeds itself: chart PNGs rendered by code. No user supplied image reaches it |
| `uuid` (moderate, missing bounds check when a caller supplies a buffer) | `exceljs` | GHSA-w5hq-g745-h8pq | exceljs never passes a caller buffer; ids are generated, not written into user input |

The only offered fix is `npm audit fix --force`, which downgrades pptxgenjs and exceljs to older, breaking versions. CLAUDE.md rules that out; revisit when either package publishes a patched release.
