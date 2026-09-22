# M9 Reliability: ToolResult, errors, retry
Spec: `docs/04-MODULES.md` section M9.
Build this first. Everything else returns `ToolResult<T>`. No tool throws. Three retry classes: transient, correctable, terminal.
