/**
 * Markdown carries its own citations (docs/04-MODULES.md M3): every page or
 * source boundary gets an HTML comment marker so a later reader (a model, or
 * `search`) can cite "page 2" without a separate sidecar index.
 */

/** A page boundary inside a PDF or a web page rendered as paginated markdown. */
export function formatPageMarker(sourceName: string, page: number): string {
  return `<!-- source: ${sourceName} | page: ${page} -->`;
}

/** A single marker for a source with no page concept (txt, md, docx). */
export function formatSourceMarker(sourceName: string): string {
  return `<!-- source: ${sourceName} -->`;
}

/** A web source marker, carrying the URL and retrieval time instead of a page number (Phase 4). */
export function formatWebMarker(url: string, retrievedAt: string): string {
  return `<!-- source: ${url} | retrieved: ${retrievedAt} -->`;
}
