const path = require('path');
// Use an in-memory DB for tests
process.env.DB_PATH = ':memory:';
const { getDb, initDb } = require('../src/db');

describe('db', () => {
  beforeAll(() => initDb());

  test('creates conversations table', () => {
    const db = getDb();
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'"
    ).get();
    expect(row).toBeDefined();
    expect(row.name).toBe('conversations');
  });

  test('creates events table', () => {
    const db = getDb();
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='events'"
    ).get();
    expect(row).toBeDefined();
  });

  test('creates analytics_daily table', () => {
    const db = getDb();
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='analytics_daily'"
    ).get();
    expect(row).toBeDefined();
  });

  test('inserts and retrieves a conversation', () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO conversations (customerEmail, gmailThreadId, status, messages, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).run('test@example.com', 'thread_abc', 'active', '[]', new Date().toISOString());

    const conv = db.prepare('SELECT * FROM conversations WHERE customerEmail = ?')
      .get('test@example.com');
    expect(conv.gmailThreadId).toBe('thread_abc');
    expect(conv.status).toBe('active');
  });
});
