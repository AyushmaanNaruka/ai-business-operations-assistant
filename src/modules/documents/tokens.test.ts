import { describe, expect, it } from 'vitest';
import { countTokens } from './tokens';

describe('countTokens', () => {
  it('counts more tokens for longer text', () => {
    const short = countTokens('hello world');
    const long = countTokens('hello world '.repeat(200));
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
  });

  it('counts zero for an empty string', () => {
    expect(countTokens('')).toBe(0);
  });
});
