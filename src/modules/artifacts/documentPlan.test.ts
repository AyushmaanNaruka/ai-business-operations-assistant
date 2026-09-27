import { describe, expect, it } from 'vitest';
import { cite, toDocumentPlan } from './documentPlan';
import type { GenericDocumentPlan } from './schemas/generic';

describe('cite', () => {
  it('appends ids in the inline citation format', () => {
    expect(cite('Email leads', ['E1', 'E4'])).toBe('Email leads [E1, E4]');
  });

  it('never repeats an id the text already cites (the "[E199]. [E199]" bug)', () => {
    expect(cite('Spend rose 60% [E199].', ['E199'])).toBe('Spend rose 60% [E199].');
    expect(cite('Spend rose [E1].', ['E1', 'E2'])).toBe('Spend rose [E1]. [E2]');
  });

  it('matches whole ids only, so E1 in the text does not hide E12', () => {
    expect(cite('Per [E1]', ['E12'])).toBe('Per [E1] [E12]');
    expect(cite('Per [E12]', ['E1'])).toBe('Per [E12] [E1]');
  });

  it('merges several id lists without duplicates, and returns the text unchanged when nothing is left', () => {
    expect(cite('Do this', ['F1'], ['E2', 'E2'])).toBe('Do this [F1, E2]');
    expect(cite('Plain', undefined, [])).toBe('Plain');
  });
});

describe('toDocumentPlan citations', () => {
  it('does not double a citation the author already wrote inline', () => {
    const plan = {
      title: 'Doc',
      purpose: 'Explain',
      structureRationale: 'One section',
      sections: [{ heading: 'Spend', body: 'Paid social spend rose 60% [E199].', evidenceIds: ['E199'] }],
    } as unknown as GenericDocumentPlan;
    const doc = toDocumentPlan(plan, 'generic');
    expect(doc.sections[1]!.body).toBe('Paid social spend rose 60% [E199].');
  });
});
