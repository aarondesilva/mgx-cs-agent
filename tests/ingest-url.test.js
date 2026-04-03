'use strict';

jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => ({
    messages: { create: jest.fn() },
  })),
}));

const Anthropic = require('@anthropic-ai/sdk').default;
const { stripHtml, extractKBContent } = require('../scripts/ingest-url');

describe('stripHtml', () => {
  test('removes HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  test('removes script content', () => {
    expect(stripHtml('<script>alert(1)</script>clean')).toBe('clean');
  });

  test('removes style content', () => {
    expect(stripHtml('<style>body{color:red}</style>clean')).toBe('clean');
  });

  test('decodes &amp; and &nbsp;', () => {
    expect(stripHtml('a&amp;b&nbsp;c')).toBe('a&b c');
  });
});

describe('extractKBContent', () => {
  test('returns extracted text from Claude', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Product: Wavy Capsules, 300mg, $65 for 10 caps.' }],
    });
    Anthropic.mockImplementation(() => ({ messages: { create: mockCreate } }));

    const result = await extractKBContent('https://microgenix.net/products/wavy', 'Wavy 300mg capsules $65');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result).toContain('Wavy Capsules');
  });

  test('returns NOT_RELEVANT when Claude says so', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'NOT_RELEVANT' }],
    });
    Anthropic.mockImplementation(() => ({ messages: { create: mockCreate } }));

    const result = await extractKBContent('https://unrelated.com', 'some random page content');
    expect(result.trim()).toBe('NOT_RELEVANT');
  });
});
