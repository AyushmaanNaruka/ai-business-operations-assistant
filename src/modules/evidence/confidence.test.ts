import { describe, expect, it } from 'vitest';
import { assignConfidence } from './confidence';

describe('assignConfidence', () => {
  it('computed evidence is always high confidence', () => {
    expect(assignConfidence('computed')).toBe('high');
  });

  it('document evidence quoted from full context is high confidence', () => {
    expect(assignConfidence('document')).toBe('high');
    expect(assignConfidence('document', { retrieved: false })).toBe('high');
  });

  it('document evidence retrieved via RAG is medium confidence', () => {
    expect(assignConfidence('document', { retrieved: true })).toBe('medium');
  });

  it('web evidence is always medium confidence', () => {
    expect(assignConfidence('web')).toBe('medium');
  });

  it('anything inferred is low confidence, overriding kind', () => {
    expect(assignConfidence('computed', { inferred: true })).toBe('low');
    expect(assignConfidence('document', { inferred: true })).toBe('low');
    expect(assignConfidence('web', { inferred: true })).toBe('low');
  });
});
