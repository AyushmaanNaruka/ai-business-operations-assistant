import { describe, expect, it } from 'vitest';
import { recordEvidenceTool } from './documents';

describe('record_evidence (documents)', () => {
  it('refuses a metric key with no numeric value, since it could never be compared', async () => {
    const result = await recordEvidenceTool.execute!(
      {
        claim: 'Growth team says Paid Social is the strongest performing channel',
        sourceId: 'src_notes',
        sourceName: 'customer-notes.docx',
        locator: 'Jan 28',
        value: 'strongest performing channel',
        metric: { name: 'conversion_rate_rank', scope: 'channel=paid_social', unit: 'count' },
        retrieved: false,
      },
      {} as never,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED', recoverable: true } });
  });
});
