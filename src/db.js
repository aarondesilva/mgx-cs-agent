'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/mgx-cs.db');

let db;

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customerEmail TEXT NOT NULL,
      gmailThreadId TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      messages TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL,
      resolvedAt TEXT,
      followUpSentAt TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversationId INTEGER NOT NULL,
      type TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '{}',
      ts TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analytics_daily (
      date TEXT PRIMARY KEY,
      totalTickets INTEGER DEFAULT 0,
      autoResolved INTEGER DEFAULT 0,
      escalatedTigertiger INTEGER DEFAULT 0,
      escalatedFulfillment INTEGER DEFAULT 0,
      avgResponseMs REAL DEFAULT 0,
      topTopics TEXT DEFAULT '[]'
    );
  `);

  return db;
}

module.exports = { getDb, initDb };
