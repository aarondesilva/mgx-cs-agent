const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

process.env.ANTHROPIC_API_KEY = 'test-key';

const { classifyMessage, draftReply, draftFollowUp } = require('../src/claude');

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

describe('draftReply', () => {
  beforeEach(() => mockCreate.mockClear());

  test('returns a reply string', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'I understand your concern about the tracking. Let me look that up for you right now.' }],
    });

    const context = {
      systemPrompt: 'You are a CS agent.',
      knowledgeBase: '## FAQ\nShipping takes 5-7 days.',
      products: [],
    };

    const result = await draftReply(
      [{ role: 'customer', content: 'Where is my order?' }],
      'Where is my order?',
      context,
      'jane@example.com'
    );

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('calls API with humanizer in system prompt', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Here is my reply.' }],
    });

    const context = { systemPrompt: 'Base prompt.', knowledgeBase: '', products: [] };
    await draftReply([], 'Hi', context, 'test@test.com');

    const call = mockCreate.mock.calls[0][0];
    expect(call.system).toContain('acknowledge the customer');
    expect(call.tools).toBeDefined();
    expect(call.tools.length).toBe(8);
  });
});

describe('draftFollowUp', () => {
  beforeEach(() => mockCreate.mockClear());

  test('returns a follow-up string', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Just checking in to make sure everything arrived okay.' }],
    });

    const result = await draftFollowUp('Jane', 'tracking');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(10);
  });
});
