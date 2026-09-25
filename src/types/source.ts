/** A single piece of input. One registry regardless of origin, so an uploaded PDF and a fetched web page are the same kind of thing downstream. */

export type SourceKind = 'xlsx' | 'csv' | 'pdf' | 'docx' | 'txt' | 'json' | 'web';
export type SourceStatus = 'pending' | 'ready' | 'failed';
export type DocMode = 'full' | 'indexed';

/** A table registered in DuckDB, from a tabular file or extracted out of a document. */
export type TableRef = {
  tableName: string; // the DuckDB table name
  rowCount: number;
  columns: { name: string; type: string; nullRate: number }[];
  qualityWarnings: string[]; // "date column has 3 formats", "18 duplicate rows"
};

/** A source can be both tabular and prose at once: a PDF with a pricing table has both `tables` and `doc`. */
export type Source = {
  id: string; // "src_1"
  name: string; // "campaigns.xlsx"
  kind: SourceKind;
  origin: 'upload' | 'url';
  status: SourceStatus;
  /** Absolute path of the uploaded file on disk, for the chat UI's file preview. Unset for URLs. Never sent to the browser. */
  path?: string;

  // a source can be BOTH of these
  tables?: TableRef[]; // set when tabular, or when tables were found in a document
  doc?: {
    mode: DocMode;
    tokenCount: number;
    pageCount?: number;
    markdownPath: string;
  };

  summary: string; // the source card the orchestrator reads
  proposedTasks?: string[]; // questions found in a requirements document, NEVER auto executed
  addedAt: string;
  error?: { code: string; message: string };
};
