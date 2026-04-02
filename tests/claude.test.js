const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

process.env.ANTHROPIC_API_KEY = 'test-key';

const { classifyMessage } = require('../src/claude');

describe('classifyMessage', () => {
  beforeEach(() => mockCreate.mockClear());

  test('returns classification with all required fields', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        confidence: 0.9,
        topic: 'tracking',
        escalateCustomer: false,
        escalateFulfillment: false,
        escalateReason: null,
      })}],
    });

    const result = await classifyMessage(
      [{ role: 'customer', content: 'Where is my order?' }],
      'Where is my order?'
    );

    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('topic');
    expect(result).toHaveProperty('escalateCustomer');
    expect(result).toHaveProperty('escalateFulfillment');
    expect(result.confidence).toBe(0.9);
    expect(result.topic).toBe('tracking');
  });

  test('calls Anthropic API with a system prompt', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        confidence: 0.5,
        topic: 'general',
        escalateCustomer: true,
        escalateFulfillment: false,
        escalateReason: 'low confidence',
      })}],
    });

    await classifyMessage([], 'test message');

    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toBe('claude-opus-4-6');
    expect(call.system).toBeDefined();
    expect(call.messages).toBeDefined();
  });

  test('handles JSON parse error gracefully', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'not valid json' }],
    });

    const result = await classifyMessage([], 'test');
    expect(result.confidence).toBe(0.5);
    expect(result.escalateCustomer).toBe(true);
  });
});
