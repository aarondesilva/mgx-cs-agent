'use strict';

const cron = require('node-cron');
const { getDb } = require('./db');
const { parseInboundMessages, sendReply } = require('./gmail');
const { processMessage } = require('./pipeline');
const { rollupDaily, sendWeeklyReport } = require('./analytics');
const { draftFollowUp } = require('./claude');
const { markFollowUpSent, logEvent } = require('./logger');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk').default;

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

async function learnFromConversations() {
  const db = getDb();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const resolved = db.prepare(`
    SELECT id, customerEmail, messages, resolvedAt
    FROM conversations
    WHERE status = 'resolved'
    AND resolvedAt >= ?
  `).all(sevenDaysAgo);

  if (resolved.length < 3) {
    console.log(`[cron:learn] ${resolved.length} resolved conversations this week — skipping`);
    return;
  }

  const threadSummary = resolved.map((conv, i) => {
    let messages;
    try { messages = JSON.parse(conv.messages); } catch { messages = []; }
    const formatted = messages.map(m => `${m.role.toUpperCase()}: ${m.content || ''}`).join('\n');
    return `--- CONVERSATION ${i + 1} (${conv.customerEmail}) ---\n${formatted}`;
  }).join('\n\n');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are analyzing resolved Microgenix customer support conversations to improve the agent's knowledge base.

Review these ${resolved.length} conversations and extract:
1. New question patterns not likely covered in existing FAQs
2. Product knowledge gaps (questions the agent seemed uncertain about)
3. Any policy or process confusion that came up more than once
4. 1-2 strong reply excerpts showing ideal tone and handling

Be concise. Only include genuinely new or useful information. If nothing new, respond with exactly: NOTHING_NEW

Conversations:
${threadSummary.substring(0, 50000)}`,
    }],
  });

  const learned = response.content.find(b => b.type === 'text')?.text || '';

  if (learned.trim() === 'NOTHING_NEW') {
    console.log('[cron:learn] No new learnings this week');
    return;
  }

  const kbPath = process.env.KB_PATH_OVERRIDE || path.join(__dirname, '../data/knowledge-base.md');
  const date = new Date().toISOString().split('T')[0];
  const section = `\n\n## Learned: ${date} (${resolved.length} conversations)\n\n${learned.trim()}\n`;

  fs.appendFileSync(kbPath, section, 'utf8');
  logEvent(0, 'kb_learning', { conversationCount: resolved.length, charsAdded: section.length });
  console.log(`[cron:learn] Appended ${section.length} chars to knowledge-base.md`);
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

  // Weekly KB learning every Sunday at midnight
  cron.schedule('0 0 * * 0', () => {
    learnFromConversations().catch(err => console.error('[cron:learn]', err.message));
  });

  console.log('[cron] All jobs started');
}

module.exports = { startCronJobs, getFollowUpsDue, sendFollowUps, pollGmail, resolveStaleConversations, learnFromConversations };
