process.env.DB_PATH = ':memory:';
process.env.SUPPORT_EMAIL = 'support@microgenix.com';
process.env.ESCALATION_EMAIL = 'tigertiger@microgenix.net';
process.env.GMAIL_CLIENT_ID = 'fake';
process.env.GMAIL_CLIENT_SECRET = 'fake';
process.env.GMAIL_REFRESH_TOKEN = 'fake';

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'fake' });
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const { initDb, getDb } = require('../src/db');
initDb();

const { rollupDaily, buildWeeklyReport } = require('../src/analytics');

function seedEvents() {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];

  // Insert 3 conversations
  for (let i = 0; i < 3; i++) {
    const r = db.prepare(
      'INSERT INTO conversations (customerEmail, gmailThreadId, status, messages, createdAt) VALUES (?, ?, ?, ?, ?)'
    ).run(`user${i}@test.com`, `thread_${i}`, i === 2 ? 'escalated' : 'resolved', '[]', `${today}T10:00:00.000Z`);

    // 2 resolved, 1 escalated to tigertiger
    db.prepare('INSERT INTO events (conversationId, type, detail, ts) VALUES (?, ?, ?, ?)').run(
      r.lastInsertRowid,
      'reply',
      JSON.stringify({ confidence: 0.9, topic: i === 0 ? 'tracking' : 'general', escalated: i === 2, responseMs: 1200 }),
      `${today}T10:01:00.000Z`
    );
  }
}

describe('rollupDaily', () => {
  beforeAll(() => seedEvents());

  test('returns a summary object', () => {
    const summary = rollupDaily();
    expect(summary).toHaveProperty('totalTickets');
    expect(summary).toHaveProperty('autoResolved');
    expect(summary).toHaveProperty('escalatedTigertiger');
    expect(summary).toHaveProperty('topTopics');
    expect(Array.isArray(summary.topTopics)).toBe(true);
  });
});

describe('buildWeeklyReport', () => {
  test('returns a non-empty string', () => {
    const report = buildWeeklyReport([
      { date: '2026-04-01', totalTickets: 10, autoResolved: 8, escalatedTigertiger: 1, escalatedFulfillment: 1, avgResponseMs: 1500, topTopics: JSON.stringify(['tracking', 'general']) },
    ]);
    expect(typeof report).toBe('string');
    expect(report).toContain('10');
    expect(report).toContain('tracking');
  });
});
