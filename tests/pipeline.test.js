process.env.DB_PATH = ':memory:';
process.env.SUPPORT_EMAIL = 'support@microgenix.com';
process.env.ESCALATION_EMAIL = 'tigertiger@microgenix.net';
process.env.FULFILLMENT_EMAIL = 'fulfillment@microgenix.net';
process.env.SUPABASE_URL = 'http://fake';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
process.env.ANTHROPIC_API_KEY = 'fake';
process.env.WOOCOMMERCE_URL = 'http://fake.com';
process.env.WOOCOMMERCE_CONSUMER_KEY = 'ck_fake';
process.env.WOOCOMMERCE_CONSUMER_SECRET = 'cs_fake';
process.env.GMAIL_CLIENT_ID = 'fake';
process.env.GMAIL_CLIENT_SECRET = 'fake';
process.env.GMAIL_REFRESH_TOKEN = 'fake';

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ data: [], error: null }) }) })
}));
jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ confidence: 0.9, topic: 'general', escalateCustomer: false, escalateFulfillment: false, escalateReason: null }) }],
      }),
    },
  })),
}));
jest.mock('../src/gmail', () => ({ sendReply: jest.fn().mockResolvedValue() }));
jest.mock('../src/escalation', () => ({
  shouldEscalate: jest.fn().mockReturnValue({ customer: false, fulfillment: false }),
  sendEscalationEmail: jest.fn().mockResolvedValue(),
}));
jest.mock('@woocommerce/woocommerce-rest-api', () => ({
  default: jest.fn(() => ({ get: jest.fn(), put: jest.fn(), post: jest.fn() }))
}));

const { initDb } = require('../src/db');
initDb();

const { processMessage } = require('../src/pipeline');

describe('processMessage', () => {
  test('processes a message without throwing', async () => {
    await expect(processMessage({
      customerEmail: 'jane@test.com',
      customerName: 'Jane',
      message: 'Where is my order?',
      gmailThreadId: 'thread_test_001',
      orderId: null,
    })).resolves.not.toThrow();
  });

  test('returns a result object with reply and escalation info', async () => {
    const result = await processMessage({
      customerEmail: 'bob@test.com',
      customerName: 'Bob',
      message: 'What supplements do you sell?',
      gmailThreadId: 'thread_test_002',
      orderId: null,
    });

    expect(result).toHaveProperty('replied');
    expect(result).toHaveProperty('escalated');
    expect(typeof result.replied).toBe('boolean');
  });
});
