process.env.DB_PATH = ':memory:';
process.env.LOG_PATH = '/tmp/test-conversations.jsonl';

const { initDb } = require('../src/db');
initDb();

const {
  getOrCreateConversation,
  appendMessage,
  markResolved,
  markEscalated,
  logEvent,
  logToFile,
} = require('../src/logger');

describe('conversation lifecycle', () => {
  test('creates a new conversation for unknown email', () => {
    const conv = getOrCreateConversation('new@test.com', 'thread_001');
    expect(conv).toHaveProperty('id');
    expect(conv.customerEmail).toBe('new@test.com');
    expect(conv.status).toBe('active');
    expect(JSON.parse(conv.messages)).toEqual([]);
  });

  test('returns existing conversation for known email', () => {
    const first = getOrCreateConversation('returning@test.com', 'thread_002');
    const second = getOrCreateConversation('returning@test.com', 'thread_002');
    expect(first.id).toBe(second.id);
  });

  test('appendMessage adds message to conversation', () => {
    const conv = getOrCreateConversation('append@test.com', 'thread_003');
    appendMessage(conv.id, { role: 'customer', content: 'Hello' });
    const updated = getOrCreateConversation('append@test.com', 'thread_003');
    const messages = JSON.parse(updated.messages);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('customer');
  });

  test('markResolved sets status and resolvedAt', () => {
    const conv = getOrCreateConversation('resolve@test.com', 'thread_004');
    markResolved(conv.id);
    const updated = getOrCreateConversation('resolve@test.com', 'thread_004');
    expect(updated.status).toBe('resolved');
    expect(updated.resolvedAt).toBeDefined();
  });

  test('markEscalated sets status to escalated', () => {
    const conv = getOrCreateConversation('escalate@test.com', 'thread_005');
    markEscalated(conv.id);
    const updated = getOrCreateConversation('escalate@test.com', 'thread_005');
    expect(updated.status).toBe('escalated');
  });

  test('logEvent writes to events table', () => {
    const conv = getOrCreateConversation('events@test.com', 'thread_006');
    logEvent(conv.id, 'reply', { confidence: 0.9 });
    const { getDb } = require('../src/db');
    const event = getDb().prepare('SELECT * FROM events WHERE conversationId = ?').get(conv.id);
    expect(event).toBeDefined();
    expect(event.type).toBe('reply');
  });
});
