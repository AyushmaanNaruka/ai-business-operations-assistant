/**
 * What the chat UI's preview panel renders for one file. Built by deterministic
 * code from the file on disk, never by a model (AGENTS.md rules 3 and 4): the
 * preview shows file content as data and nothing in it is ever acted on.
 */

export type PreviewTable = {
  name: string; // sheet name, or the file name for a CSV
  columns: string[];
  rows: string[][];
  totalRows: number; // data rows in the file, which may be more than `rows` holds
};

export type PreviewSlide = {
  number: number;
  title: string;
  body: string[];
};

export type FilePreview =
  /** The browser's own PDF viewer shows the raw file; nothing to extract. */
  | { type: 'pdf' }
  | { type: 'text'; format: 'markdown' | 'plain' | 'json'; text: string; truncated: boolean }
  | { type: 'table'; sheets: PreviewTable[] }
  /** A Word document as HTML. The UI renders it in a sandboxed, script free iframe. */
  | { type: 'html'; html: string }
  | { type: 'slides'; slides: PreviewSlide[] };
