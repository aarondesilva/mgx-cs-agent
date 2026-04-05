'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const { processMessage } = require('./pipeline');
const { assembleContext } = require('./knowledge');
const { classifyMessage, draftReply } = require('./claude');
const { getDb } = require('./db');

const app = express();
app.use(express.json());

// CORS for chat widget — allow requests from Microgenix site and any localhost for dev
const chatCors = cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // server-to-server / curl
    const allowed = [/microgenix\.net$/, /localhost/, /127\.0\.0\.1/];
    if (allowed.some(p => p.test(origin))) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['POST', 'OPTIONS'],
});

// Serve widget file with permissive CORS so any site can load it
app.get('/widget/chat-widget.js', cors(), (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, '../widget/chat-widget.js'));
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.post('/webhook', (req, res) => {
  const { customerEmail, customerName, message, orderId } = req.body || {};

  if (!customerEmail || !message) {
    res.status(400).json({ error: 'customerEmail and message are required' });
    return;
  }

  res.json({ status: 'received' });

  // Process asynchronously — response already sent
  setImmediate(async () => {
    try {
      await processMessage({
        customerEmail,
        customerName: customerName || customerEmail,
        message,
        gmailThreadId: null,
        orderId: orderId || null,
      });
    } catch (err) {
      console.error('[webhook] Processing error:', err.message);
    }
  });
});

// Synchronous endpoint for chat widget — waits for reply and returns it
app.options('/chat', chatCors);
app.post('/chat', chatCors, async (req, res) => {
  const { customerEmail, customerName, message, sessionId } = req.body || {};

  if (!customerEmail || !message) {
    res.status(400).json({ error: 'customerEmail and message are required' });
    return;
  }

  try {
    console.log('[chat] assembleContext...');
    const context = await assembleContext(customerEmail);
    console.log('[chat] classifyMessage...');
    const classification = await classifyMessage([], message);
    console.log('[chat] draftReply...');
    const reply = await draftReply([], message, context, customerEmail);
    console.log('[chat] done');

    // Strip email sign-off from chat replies — not needed in widget UI
    const chatReply = reply.replace(/\n+(Avery|Willow)[,\n].*$/is, '').trim();

    res.json({
      reply: chatReply,
      escalated: !!(classification.escalateCustomer || classification.escalateFulfillment),
      topic: classification.topic,
    });
  } catch (err) {
    console.error('[chat] Error:', err.message, err.stack);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/stats', (req, res) => {
  const password = process.env.STATS_PASSWORD;
  if (password && req.query.key !== password) {
    res.status(401).send('Unauthorized');
    return;
  }

  const db = getDb();

  const total = db.prepare('SELECT COUNT(*) as n FROM conversations').get().n;
  const escalated = db.prepare("SELECT COUNT(*) as n FROM conversations WHERE status = 'escalated'").get().n;
  const today = new Date().toISOString().split('T')[0];
  const todayCount = db.prepare("SELECT COUNT(*) as n FROM conversations WHERE createdAt LIKE ?").get(`${today}%`).n;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const weekCount = db.prepare("SELECT COUNT(*) as n FROM conversations WHERE createdAt >= ?").get(sevenDaysAgo.toISOString()).n;

  const recentEvents = db.prepare(
    "SELECT detail FROM events WHERE type = 'reply' ORDER BY ts DESC LIMIT 200"
  ).all();
  const responseTimes = recentEvents.map(e => {
    try { return JSON.parse(e.detail).responseMs; } catch { return null; }
  }).filter(ms => typeof ms === 'number');
  const avgMs = responseTimes.length
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : 0;

  const topicRows = db.prepare(
    "SELECT detail FROM events WHERE type = 'reply' ORDER BY ts DESC LIMIT 500"
  ).all();
  const topicCounts = {};
  for (const row of topicRows) {
    try {
      const d = JSON.parse(row.detail);
      if (d.topic) topicCounts[d.topic] = (topicCounts[d.topic] || 0) + 1;
    } catch {}
  }
  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const recentConvs = db.prepare(
    'SELECT customerEmail, status, createdAt FROM conversations ORDER BY createdAt DESC LIMIT 10'
  ).all();

  const autoResolved = total - escalated;
  const resolutionRate = total > 0 ? Math.round((autoResolved / total) * 100) : 0;

  const topicsHtml = topTopics.map(([topic, count]) =>
    `<div class="topic-row"><span class="topic-name">${topic}</span><span class="topic-count">${count}</span></div>`
  ).join('');

  const recentHtml = recentConvs.map(c =>
    `<tr><td>${c.customerEmail}</td><td><span class="badge badge-${c.status}">${c.status}</span></td><td>${c.createdAt.split('T')[0]}</td></tr>`
  ).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Willow Stats</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f6fb; color: #1a1a2e; }
  header { background: #2b3a72; color: white; padding: 24px 32px; }
  header h1 { font-size: 22px; font-weight: 600; }
  header p { font-size: 13px; opacity: 0.7; margin-top: 4px; }
  .container { max-width: 900px; margin: 32px auto; padding: 0 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .card { background: white; border-radius: 12px; padding: 20px 24px; box-shadow: 0 1px 4px rgba(0,0,0,0.07); }
  .card .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 8px; }
  .card .value { font-size: 32px; font-weight: 700; color: #2b3a72; }
  .card .sub { font-size: 12px; color: #aaa; margin-top: 4px; }
  .section { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,0.07); margin-bottom: 24px; }
  .section h2 { font-size: 15px; font-weight: 600; margin-bottom: 16px; color: #2b3a72; }
  .topic-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
  .topic-row:last-child { border-bottom: none; }
  .topic-count { background: #eef0f8; color: #2b3a72; border-radius: 20px; padding: 2px 10px; font-size: 12px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 12px; color: #888; font-weight: 500; border-bottom: 1px solid #f0f0f0; }
  td { padding: 10px 12px; border-bottom: 1px solid #f8f8f8; }
  .badge { border-radius: 20px; padding: 2px 10px; font-size: 11px; font-weight: 600; }
  .badge-active { background: #e8f4fd; color: #1a73e8; }
  .badge-escalated { background: #fdecea; color: #d32f2f; }
  .badge-resolved { background: #e8f5e9; color: #2e7d32; }
</style>
</head>
<body>
<header>
  <h1>Willow — Support Stats</h1>
  <p>Updated live from the database</p>
</header>
<div class="container">
  <div class="grid">
    <div class="card"><div class="label">Today</div><div class="value">${todayCount}</div><div class="sub">conversations</div></div>
    <div class="card"><div class="label">This Week</div><div class="value">${weekCount}</div><div class="sub">conversations</div></div>
    <div class="card"><div class="label">All Time</div><div class="value">${total}</div><div class="sub">conversations</div></div>
    <div class="card"><div class="label">Auto-Resolved</div><div class="value">${resolutionRate}%</div><div class="sub">${autoResolved} of ${total}</div></div>
    <div class="card"><div class="label">Escalated</div><div class="value">${escalated}</div><div class="sub">all time</div></div>
    <div class="card"><div class="label">Avg Response</div><div class="value">${(avgMs / 1000).toFixed(1)}s</div><div class="sub">last 200 replies</div></div>
  </div>
  <div class="section">
    <h2>Top Topics</h2>
    ${topicsHtml || '<p style="color:#aaa;font-size:13px">No data yet</p>'}
  </div>
  <div class="section">
    <h2>Recent Conversations</h2>
    <table>
      <thead><tr><th>Customer</th><th>Status</th><th>Date</th></tr></thead>
      <tbody>${recentHtml || '<tr><td colspan="3" style="color:#aaa">No conversations yet</td></tr>'}</tbody>
    </table>
  </div>
</div>
</body>
</html>`);
});

module.exports = app;
