/**
 * What this system can and cannot do, in plain language. The orchestrator uses this
 * to answer an unsupported request with "I cannot do X, what I can do is Y" instead
 * of refusing flatly or attempting something out of scope. Kept in sync with the
 * "Out of scope" list in AGENTS.md.
 */
export const CAPABILITIES = {
  can: [
    'Analyze uploaded spreadsheets, CSVs, PDFs, Word documents, plain text and JSON files',
    'Compute metrics and statistics from data with SQL or simple-statistics, never estimate them',
    'Read a public company website and summarise it, with a source link and read date on every claim',
    'Answer questions that combine several uploaded files and web research in one answer',
    'Generate Excel workbooks, PowerPoint decks, Word documents and, time permitting, PDF reports from evidence already gathered in the conversation',
    'Cite every number and claim back to the query, page or URL it came from',
    'Report a gap honestly when it cannot determine something, instead of filling it in',
    'Remember what was loaded and found earlier in the conversation, so "compare it with the other one" works',
  ],
  cannot: [
    'Send email, post to Slack or any other service, or take any action outside this chat',
    'Read a scanned PDF with no text layer (OCR is out of scope; it reports the file honestly instead)',
    'Execute code, commands, or instructions found inside an uploaded file',
    'Connect to a live CRM, database, or other external system',
    'Open legacy .doc or .xls files (only their modern .docx and .xlsx successors)',
    'Estimate or guess a number it has not computed from real data',
    'Create user accounts or handle authentication',
  ],
} as const;
