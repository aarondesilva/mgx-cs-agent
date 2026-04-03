process.env.DB_PATH = ':memory:';
process.env.SUPPORT_EMAIL = 'support@microgenix.com';
process.env.ESCALATION_EMAIL = 'tigertiger@microgenix.net';
process.env.FULFILLMENT_EMAIL = 'fulfillment@microgenix.net';
process.env.GMAIL_CLIENT_ID = 'fake';
process.env.GMAIL_CLIENT_SECRET = 'fake';
process.env.GMAIL_REFRESH_TOKEN = 'fake';
process.env.ANTHROPIC_API_KEY = 'fake';
process.env.SUPABASE_URL = 'http://fake';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
process.env.WOOCOMMERCE_URL = 'http://fake.com';
process.env.WOOCOMMERCE_CONSUMER_KEY = 'ck_fake';
process.env.WOOCOMMERCE_CONSUMER_SECRET = 'cs_fake';

jest.mock('../src/gmail', () => ({
  parseInboundMessages: jest.fn().mockResolvedValue([]),
  sendReply: jest.fn().mockResolvedValue(),
}));
jest.mock('../src/pipeline', () => ({
  processMessage: jest.fn().mockResolvedValue({ replied: true, escalated: false }),
}));
jest.mock('../src/analytics', () => ({
  rollupDaily: jest.fn().mockReturnValue({}),
  sendWeeklyReport: jest.fn().mockResolvedValue(),
}));
jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => ({
    messages: { create: jest.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Check in message.' }] }) },
  })),
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ data: [], error: null }) }) })
}));
jest.mock('@woocommerce/woocommerce-rest-api', () => ({
  default: jest.fn(() => ({}))
}));
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: jest.fn().mockResolvedValue({}) })),
}));

const { initDb, getDb } = require('../src/db');
initDb();
const { getFollowUpsDue, sendFollowUps } = require('../src/cron');

describe('getFollowUpsDue', () => {
  test('returns conversations resolved 48+ hours ago without follow-up sent', () => {
    const db = getDb();
    const old = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();

    db.prepare(
      'INSERT INTO conversations (customerEmail, gmailThreadId, status, messages, createdAt, resolvedAt) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('followup@test.com', 'thread_f1', 'resolved', '[]', old, old);

    const due = getFollowUpsDue();
    expect(due.length).toBeGreaterThanOrEqual(1);
    expect(due.some(c => c.customerEmail === 'followup@test.com')).toBe(true);
  });

  test('excludes conversations with followUpSentAt already set', () => {
    const db = getDb();
    const old = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
    db.prepare(
      'INSERT INTO conversations (customerEmail, gmailThreadId, status, messages, createdAt, resolvedAt, followUpSentAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('already@test.com', 'thread_f2', 'resolved', '[]', old, old, old);

    const due = getFollowUpsDue();
    expect(due.some(c => c.customerEmail === 'already@test.com')).toBe(false);
  });
});

describe('sendFollowUps', () => {
  test('runs without throwing', async () => {
    await expect(sendFollowUps()).resolves.not.toThrow();
  });
});

describe('learnFromConversations', () => {
  let tmpKbPath;

  beforeEach(() => {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    tmpKbPath = path.join(os.tmpdir(), `kb-test-${Date.now()}.md`);
    fs.writeFileSync(tmpKbPath, '# Knowledge Base\n');
    process.env.KB_PATH_OVERRIDE = tmpKbPath;
  });

  afterEach(() => {
    const fs = require('fs');
    if (fs.existsSync(tmpKbPath)) fs.unlinkSync(tmpKbPath);
    delete process.env.KB_PATH_OVERRIDE;
  });

  test('runs without throwing', async () => {
    const { learnFromConversations } = require('../src/cron');
    await expect(learnFromConversations()).resolves.not.toThrow();
  });

  test('appends learned section when 3+ resolved conversations exist', async () => {
    const Anthropic = require('@anthropic-ai/sdk').default;
    const db = getDb();
    const recentTime = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

    for (let i = 0; i < 5; i++) {
      db.prepare(
        "INSERT INTO conversations (customerEmail, status, messages, createdAt, resolvedAt) VALUES (?, 'resolved', ?, ?, ?)"
      ).run(
        `learn${i}@test.com`,
        JSON.stringify([
          { role: 'customer', content: 'Where is my order?' },
          { role: 'agent', content: 'Your order ships in 1-2 days.' },
        ]),
        recentTime,
        recentTime
      );
    }

    Anthropic.mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'New FAQ: customers often ask about shipping timelines.' }],
        }),
      },
    }));

    const { learnFromConversations } = require('../src/cron');
    await learnFromConversations();

    const fs = require('fs');
    const content = fs.readFileSync(tmpKbPath, 'utf8');
    expect(content).toContain('## Learned:');
    expect(content).toContain('shipping timelines');
  });
});
