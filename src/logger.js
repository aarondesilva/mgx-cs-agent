'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');

const LOG_PATH = process.env.LOG_PATH || path.join(__dirname, '../logs/conversations.jsonl');

function getOrCreateConversation(customerEmail, gmailThreadId) {
  const db = getDb();

  const existing = db.prepare(
    'SELECT * FROM conversations WHERE customerEmail = ? ORDER BY createdAt DESC LIMIT 1'
  ).get(customerEmail);

  if (existing) return existing;

  const result = db.prepare(
    'INSERT INTO conversations (customerEmail, gmailThreadId, status, messages, createdAt) VALUES (?, ?, ?, ?, ?)'
  ).run(customerEmail, gmailThreadId, 'active', '[]', new Date().toISOString());

  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(result.lastInsertRowid);
}

function appendMessage(conversationId, message) {
  const db = getDb();
  const conv = db.prepare('SELECT messages FROM conversations WHERE id = ?').get(conversationId);
  const messages = JSON.parse(conv.messages);
  messages.push({ ...message, ts: new Date().toISOString() });
  db.prepare('UPDATE conversations SET messages = ? WHERE id = ?')
    .run(JSON.stringify(messages), conversationId);
}

function markResolved(conversationId) {
  const db = getDb();
  db.prepare("UPDATE conversations SET status = 'resolved', resolvedAt = ? WHERE id = ?")
    .run(new Date().toISOString(), conversationId);
}

function markEscalated(conversationId) {
  const db = getDb();
  db.prepare("UPDATE conversations SET status = 'escalated' WHERE id = ?")
    .run(conversationId);
}

function markFollowUpSent(conversationId) {
  const db = getDb();
  db.prepare('UPDATE conversations SET followUpSentAt = ? WHERE id = ?')
    .run(new Date().toISOString(), conversationId);
}

function logEvent(conversationId, type, detail) {
  const db = getDb();
  db.prepare('INSERT INTO events (conversationId, type, detail, ts) VALUES (?, ?, ?, ?)')
    .run(conversationId, type, JSON.stringify(detail), new Date().toISOString());
}

function logToFile(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  try {
    fs.appendFileSync(LOG_PATH, line, 'utf8');
  } catch {
    // Non-fatal — DB is the source of truth
  }
}

module.exports = {
  getOrCreateConversation,
  appendMessage,
  markResolved,
  markEscalated,
  markFollowUpSent,
  logEvent,
  logToFile,
};
