import { describe, expect, it } from 'vitest';
import { DEFAULT_CONVERSATION_TITLE, deriveConversationTitle, firstUserText, isPlaceholderTitle, messageText } from './title';

describe('deriveConversationTitle', () => {
  it('uses a short message as is', () => {
    expect(deriveConversationTitle('Which channel converts best?')).toBe('Which channel converts best?');
  });

  it('takes the first non empty line and strips markdown markers', () => {
    expect(deriveConversationTitle('\n\n## **Q3 review**\nmore detail here')).toBe('Q3 review');
    expect(deriveConversationTitle('- compare `campaigns.xlsx` to the brief')).toBe('compare campaigns.xlsx to the brief');
  });

  it('cuts a long message at a word boundary with an ellipsis', () => {
    const title = deriveConversationTitle(
      'Analyse the campaign spreadsheet and tell me which channels performed best last quarter and why',
    );
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toMatch(/\s…$/);
  });

  it('cuts a single long token mid word rather than returning nothing', () => {
    const title = deriveConversationTitle('x'.repeat(100), 20);
    expect(title).toBe(`${'x'.repeat(20)}…`);
  });

  it('falls back to the default title for blank input', () => {
    expect(deriveConversationTitle('   \n  ')).toBe(DEFAULT_CONVERSATION_TITLE);
  });
});

describe('isPlaceholderTitle', () => {
  it('recognises empty, default and Mastra placeholder titles', () => {
    expect(isPlaceholderTitle(undefined)).toBe(true);
    expect(isPlaceholderTitle('')).toBe(true);
    expect(isPlaceholderTitle('New chat')).toBe(true);
    expect(isPlaceholderTitle('New Thread 2026-09-26T01:00:00.000Z')).toBe(true);
    expect(isPlaceholderTitle('Q3 campaign review')).toBe(false);
  });
});

describe('messageText and firstUserText', () => {
  it('joins text parts and ignores tool parts', () => {
    expect(
      messageText({ parts: [{ type: 'text', text: 'hello' }, { type: 'tool-x' }, { type: 'text', text: 'world' }] }),
    ).toBe('hello\nworld');
  });

  it('finds the first user message with text', () => {
    expect(
      firstUserText([
        { role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
        { role: 'user', parts: [{ type: 'file' }] },
        { role: 'user', parts: [{ type: 'text', text: 'the real question' }] },
      ]),
    ).toBe('the real question');
    expect(firstUserText([])).toBe('');
  });
});
