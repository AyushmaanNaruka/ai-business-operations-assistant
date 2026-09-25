import { describe, expect, it } from 'vitest';
import { isValidSessionId } from './ids';

describe('isValidSessionId', () => {
  it('accepts every id shape the app has used', () => {
    for (const id of ['3cf7d1fb-1fdf-44be-a165-fa60b1591137', 'default-thread', 'orchestrator-default-session', '__LOCALID_goZpC89']) {
      expect(isValidSessionId(id), id).toBe(true);
    }
  });

  it('refuses paths, quotes, empty and oversized values, and non strings', () => {
    for (const id of ['', '../etc/passwd', 'a b', "x'); DROP TABLE t;--", 'a'.repeat(129), 42, null, undefined, { id: 'x' }]) {
      expect(isValidSessionId(id), String(id)).toBe(false);
    }
  });
});
