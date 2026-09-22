# Tools
Thin typed wrappers over `src/modules/*`. Every tool has a Zod input schema and returns `ToolResult<T>`. No business logic here; it belongs in the module so it can be tested without a model.
