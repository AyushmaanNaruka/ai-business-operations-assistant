# M9 Reliability: ToolResult, errors, retry
Spec: `docs/04-MODULES.md` section M9.
Build this first. Everything else returns `ToolResult<T>`. No tool throws. Three retry classes: transient, correctable, terminal.

`rateLimit.ts` is the in memory, fixed window limiter the chat UI's API routes use per client (docs/DECISIONS.md D-56).
