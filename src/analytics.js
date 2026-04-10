'use strict';

const { sendEmail } = require('./gmail');
const { getDb } = require('./db');

function rollupDaily(date) {
  const db = getDb();
  const today = date || new Date().toISOString().split('T')[0];

  const conversations = db.prepare(
    "SELECT * FROM conversations WHERE createdAt LIKE ?"
  ).all(`${today}%`);

  const events = db.prepare(
    "SELECT * FROM events WHERE ts LIKE ? AND type = 'reply'"
  ).all(`${today}%`);

  const totalTickets = conversations.length;
  const autoResolved = conversations.filter(c => c.status === 'resolved').length;
  const escalatedTigertiger = conversations.filter(c => c.status === 'escalated').length;

  const fulfillmentEvents = db.prepare(
    "SELECT * FROM events WHERE ts LIKE ? AND type = 'escalation_error' AND detail LIKE '%fulfillment%'"
  ).all(`${today}%`);
  const escalatedFulfillment = fulfillmentEvents.length;

  const responseTimes = events.map(e => {
    try { return JSON.parse(e.detail).responseMs; } catch { return null; }
  }).filter(ms => typeof ms === 'number');

  const avgResponseMs = responseTimes.length
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : 0;

  const topicCounts = {};
  for (const e of events) {
    try {
      const detail = JSON.parse(e.detail);
      if (detail.topic) topicCounts[detail.topic] = (topicCounts[detail.topic] || 0) + 1;
    } catch {}
  }
  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);

  const summary = { date: today, totalTickets, autoResolved, escalatedTigertiger, escalatedFulfillment, avgResponseMs, topTopics };

  // Upsert into analytics_daily
  db.prepare(`
    INSERT INTO analytics_daily (date, totalTickets, autoResolved, escalatedTigertiger, escalatedFulfillment, avgResponseMs, topTopics)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      totalTickets = excluded.totalTickets,
      autoResolved = excluded.autoResolved,
      escalatedTigertiger = excluded.escalatedTigertiger,
      escalatedFulfillment = excluded.escalatedFulfillment,
      avgResponseMs = excluded.avgResponseMs,
      topTopics = excluded.topTopics
  `).run(today, totalTickets, autoResolved, escalatedTigertiger, escalatedFulfillment, avgResponseMs, JSON.stringify(topTopics));

  return summary;
}

function buildWeeklyReport(rows) {
  const totalTickets = rows.reduce((s, r) => s + r.totalTickets, 0);
  const autoResolved = rows.reduce((s, r) => s + r.autoResolved, 0);
  const escalatedTigertiger = rows.reduce((s, r) => s + r.escalatedTigertiger, 0);
  const escalatedFulfillment = rows.reduce((s, r) => s + r.escalatedFulfillment, 0);
  const avgMs = rows.length
    ? Math.round(rows.reduce((s, r) => s + r.avgResponseMs, 0) / rows.length)
    : 0;
  const resolutionRate = totalTickets > 0 ? Math.round((autoResolved / totalTickets) * 100) : 0;

  const allTopics = rows.flatMap(r => {
    if (Array.isArray(r.topTopics)) return r.topTopics;
    try { return JSON.parse(r.topTopics); } catch { return []; }
  });
  const topicCounts = {};
  for (const t of allTopics) topicCounts[t] = (topicCounts[t] || 0) + 1;
  const topTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);

  return [
    'MGX CS Agent — Weekly Report',
    '==============================',
    '',
    `Total tickets: ${totalTickets}`,
    `Auto-resolved: ${autoResolved} (${resolutionRate}%)`,
    `Escalated to tigertiger: ${escalatedTigertiger}`,
    `Escalated to fulfillment: ${escalatedFulfillment}`,
    `Average response time: ${(avgMs / 1000).toFixed(1)}s`,
    '',
    `Top topics: ${topTopics.join(', ') || 'none'}`,
    '',
    `Period: last 7 days`,
  ].join('\n');
}

function buildTranscripts(conversations) {
  if (!conversations.length) return 'No conversations this week.\n';

  return conversations.map(conv => {
    let messages;
    try { messages = JSON.parse(conv.messages); } catch { messages = []; }

    const header = [
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Conversation #${conv.id}`,
      `Customer: ${conv.customerEmail}`,
      `Started:  ${conv.createdAt}`,
      `Status:   ${conv.status}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ].join('\n');

    const body = messages.length
      ? messages.map(m => {
          const role = m.role === 'customer' ? 'CUSTOMER' : 'AGENT   ';
          const ts = m.ts ? ` [${m.ts}]` : '';
          return `${role}${ts}:\n${m.content}\n`;
        }).join('\n')
      : '(no messages recorded)\n';

    return `${header}\n${body}`;
  }).join('\n\n');
}

async function sendWeeklyReport() {
  const db = getDb();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const since = sevenDaysAgo.toISOString().split('T')[0];

  const rows = db.prepare(
    'SELECT * FROM analytics_daily WHERE date >= ? ORDER BY date ASC'
  ).all(since);

  const conversations = db.prepare(
    'SELECT * FROM conversations WHERE createdAt >= ? ORDER BY createdAt ASC'
  ).all(since + 'T00:00:00.000Z');

  const report = buildWeeklyReport(rows);
  const transcripts = buildTranscripts(conversations);

  try {
    await sendEmail({
      to: process.env.ESCALATION_EMAIL,
      subject: `MGX CS Weekly Report - ${new Date().toISOString().split('T')[0]}`,
      text: report,
      attachments: [
        {
          filename: `mgx-transcripts-${since}.txt`,
          content: transcripts,
          contentType: 'text/plain',
        },
      ],
    });
  } catch (err) {
    console.error('[analytics] Failed to send weekly report:', err.message);
  }
}

module.exports = { rollupDaily, buildWeeklyReport, buildTranscripts, sendWeeklyReport };
