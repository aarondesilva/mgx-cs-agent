'use strict';

const cron = require('node-cron');
const { getDb } = require('./db');
const { parseInboundMessages, sendReply } = require('./gmail');
const { processMessage } = require('./pipeline');
const { rollupDaily, sendWeeklyReport } = require('./analytics');
const { draftFollowUp } = require('./claude');
const { markFollowUpSent, logEvent } = require('./logger');

function getFollowUpsDue() {
  const db = getDb();
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  return db.prepare(`
    SELECT * FROM conversations
    WHERE status = 'resolved'
    AND resolvedAt <= ?
    AND followUpSentAt IS NULL
  `).all(fortyEightHoursAgo);
}

async function sendFollowUps() {
  const due = getFollowUpsDue();
  if (due.length === 0) return;

  for (const conv of due) {
    try {
      const messages = JSON.parse(conv.messages);
      const lastAgentMsg = [...messages].reverse().find(m => m.role === 'agent');
      const topic = lastAgentMsg?.topic || 'your recent inquiry';

      const firstName = conv.customerEmail.split('@')[0].split('.')[0];
      const followUpText = await draftFollowUp(firstName, topic);

      if (conv.gmailThreadId) {
        await sendReply(conv.gmailThreadId, conv.customerEmail, followUpText);
        markFollowUpSent(conv.id);
        logEvent(conv.id, 'follow_up', { sent: true });
      } else {
        // No Gmail thread — cannot send follow-up, skip without marking sent
        logEvent(conv.id, 'follow_up', { sent: false, reason: 'no_thread_id' });
      }
    } catch (err) {
      logEvent(conv.id, 'follow_up_error', { error: err.message });
    }
  }
}

async function pollGmail() {
  try {
    const messages = await parseInboundMessages();
    for (const msg of messages) {
      await processMessage({
        customerEmail: msg.customerEmail,
        customerName: msg.customerName,
        message: msg.body,
        gmailThreadId: msg.gmailThreadId,
        orderId: null,
      });
    }
  } catch (err) {
    console.error('[cron:poll] Gmail polling error:', err.message);
  }
}

function resolveStaleConversations() {
  const db = getDb();
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  // Fetch all active conversations older than 5 days; check agent reply in JS to avoid fragile LIKE
  const candidates = db.prepare(`
    SELECT id, messages FROM conversations
    WHERE status = 'active'
    AND createdAt <= ?
  `).all(fiveDaysAgo);

  for (const conv of candidates) {
    let messages;
    try { messages = JSON.parse(conv.messages); } catch { messages = []; }

    // Only resolve if the conversation has at least one agent reply
    const hasAgentReply = messages.some(m => m.role === 'agent');
    if (!hasAgentReply) continue;

    // Only resolve if the last customer reply was also more than 5 days ago
    const lastCustomerMsg = [...messages].reverse().find(m => m.role === 'customer');
    const lastCustomerTs = lastCustomerMsg ? lastCustomerMsg.ts : null;

    if (!lastCustomerTs || lastCustomerTs <= fiveDaysAgo) {
      db.prepare("UPDATE conversations SET status = 'resolved', resolvedAt = ? WHERE id = ?")
        .run(now, conv.id);
    }
  }
}

function startCronJobs() {
  // Poll Gmail every 2 minutes
  cron.schedule('*/2 * * * *', () => {
    pollGmail().catch(err => console.error('[cron:poll]', err.message));
  });

  // Check for follow-ups due every 30 minutes
  cron.schedule('*/30 * * * *', () => {
    sendFollowUps().catch(err => console.error('[cron:followup]', err.message));
  });

  // Mark stale conversations as resolved daily at 1am
  cron.schedule('0 1 * * *', () => {
    try { resolveStaleConversations(); } catch (err) { console.error('[cron:stale]', err.message); }
  });

  // Daily analytics rollup at midnight
  cron.schedule('0 0 * * *', () => {
    try { rollupDaily(); } catch (err) { console.error('[cron:analytics]', err.message); }
  });

  // Weekly report every Monday at 8am
  cron.schedule('0 8 * * 1', () => {
    sendWeeklyReport().catch(err => console.error('[cron:weekly]', err.message));
  });

  console.log('[cron] All jobs started');
}

module.exports = { startCronJobs, getFollowUpsDue, sendFollowUps, pollGmail, resolveStaleConversations };
