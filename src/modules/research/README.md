# M4 Research: search, read, crawl
Spec: `docs/04-MODULES.md` section M4.
Exa with Tavily fallback, Jina Reader with readability fallback, Firecrawl for crawls. Page cap per task, URL cache per session, retrievedAt on everything. Quota exhaustion is a reported gap, never a guess.

`urlSafety.ts` is the SSRF guard (docs/DECISIONS.md D-55): `checkPublicUrl` refuses any URL whose host is or resolves to a private, loopback, link local or internal address, and `safeFetch` re checks every redirect hop. Every server side fetch of a researched URL goes through it.
