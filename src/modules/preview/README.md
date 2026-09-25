# Preview
File previews for the chat UI's right hand panel: an uploaded source or a generated artifact, opened without downloading it.

Pure logic, no model, no Mastra. `previewFile(path)` picks a previewer from the extension and returns `ToolResult<FilePreview>`:

| File | Preview |
|---|---|
| `.pdf` | `{ type: 'pdf' }`, the UI embeds the raw file in the browser's own viewer |
| `.xlsx`, `.csv` | first 100 rows per sheet, plus the true row count |
| `.docx` | HTML from mammoth, shown in a sandboxed iframe with a no script CSP |
| `.pptx` | each slide's text in order, first paragraph as the title |
| `.md`, `.txt`, `.json` | text, truncated at 200,000 characters |

File content is data, never instruction (AGENTS.md rule 4): nothing here interprets what a file says, and the Word HTML can run no script and load nothing from the network.
