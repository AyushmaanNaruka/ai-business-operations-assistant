import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getDocument, saveMarkdown } from './store';

const TEST_ID = 'test_src_store_roundtrip';

describe('store (saveMarkdown / getDocument)', () => {
  afterAll(async () => {
    await rm(join('data', 'documents', `${TEST_ID}.md`), { force: true });
  });

  it('round-trips markdown, markers included, keyed by source id', async () => {
    const markdown = '<!-- source: brief.pdf | page: 1 -->\n\nHello world.';
    const path = await saveMarkdown(TEST_ID, markdown);
    expect(path).toContain(TEST_ID);

    const result = await getDocument(TEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(markdown);
  });

  it('fails with SOURCE_NOT_FOUND, not a throw, for an id with nothing stored', async () => {
    const result = await getDocument('no_such_source_id');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SOURCE_NOT_FOUND');
  });
});
