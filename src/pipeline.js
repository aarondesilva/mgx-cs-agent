'use strict';

const { getDb } = require('./db');
const { assembleContext } = require('./knowledge');
const { classifyMessage, draftReply, draftEscalationAck } = require('./claude');

const CHEAP_ACK_TOPICS = new Set(['medical', 'legal', 'complaint']);
const ANGRY_PATTERN = /angry|upset|pissed|furious|livid|frustrat|mad|raging|human|real person/i;

function shouldUseCheapAck(classification) {
  if (CHEAP_ACK_TOPICS.has(classification.topic)) return true;
  if (classification.escalateReason && ANGRY_PATTERN.test(classification.escalateReason)) return true;
  return false;
}

function firstNameFromEmail(customerName, customerEmail) {
  if (customerName) return customerName.split(/\s+/)[0];
  if (customerEmail) return customerEmail.split('@')[0].split(/[._-]/)[0];
  return null;
}
const { shouldEscalate, sendEscalationEmail } = require('./escalation');
const { sendReply } = require('./gmail');
const {
  getOrCreateConversation,
  appendMessage,
  markEscalated,
  logEvent,
  logToFile,
} = require('./logger');

function createFreshConversation(customerEmail, gmailThreadId) {
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO conversations (customerEmail, gmailThreadId, status, messages, createdAt) VALUES (?, ?, ?, ?, ?)'
  ).run(customerEmail, gmailThreadId, 'active', '[]', new Date().toISOString());
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(result.lastInsertRowid);
}

async function processMessage({ customerEmail, customerName, message, gmailThreadId, orderId }) {
  const startMs = Date.now();

  // Get or create conversation — if resolved, start fresh
  let conversation = getOrCreateConversation(customerEmail, gmailThreadId);
  if (conversation.status === 'resolved') {
    conversation = createFreshConversation(customerEmail, gmailThreadId);
  }

  const thread = JSON.parse(conversation.messages);

  appendMessage(conversation.id, { role: 'customer', content: message });

  const context = await assembleContext(customerEmail);
  const classification = await classifyMessage(thread, message);

  const escalation = shouldEscalate(classification);
  let reply = '';
  let replied = false;
  let escalated = false;

  // Draft a reply. For escalations on sensitive topics (medical/legal/anger),
  // use a cheap Haiku acknowledgment and skip the full Sonnet+tools loop.
  const useCheapAck = escalation.customer && shouldUseCheapAck(classification);
  try {
    if (useCheapAck) {
      const firstName = firstNameFromEmail(customerName, customerEmail);
      reply = await draftEscalationAck(firstName, escalation.customerReason || classification.topic);
    } else {
      reply = await draftReply(thread, message, context, customerEmail);
    }
  } catch (err) {
    logEvent(conversation.id, 'draft_error', { error: err.message });
  }

  if (reply && gmailThreadId) {
    try {
      await sendReply(gmailThreadId, customerEmail, reply);
      replied = true;
      appendMessage(conversation.id, { role: 'agent', content: reply });
    } catch (err) {
      logEvent(conversation.id, 'send_error', { error: err.message });
    }
  }

  // Build thread snapshot for escalation emails — only include agent reply if it was sent
  const escalationThread = [
    ...thread,
    { role: 'customer', content: message },
    ...(replied ? [{ role: 'agent', content: reply }] : []),
  ];

  // Fire escalations independently — both can fire on same ticket
  if (escalation.customer) {
    try {
      const requestedHuman = escalation.customerReason && /human|person|agent|real|someone/i.test(escalation.customerReason);
      const isShippingTopic = /shipping|tracking|carrier|delivery|lost|package/i.test(classification.topic + ' ' + (escalation.customerReason || ''));
      await sendEscalationEmail({
        to: process.env.ESCALATION_EMAIL,
        customerEmail,
        thread: escalationThread,
        reason: escalation.customerReason || 'Customer escalation triggered',
        orderId,
        ccCustomer: requestedHuman,
        ccFulfillment: isShippingTopic,
      });
      escalated = true;
    } catch (err) {
      logEvent(conversation.id, 'escalation_error', { target: 'customer', error: err.message });
    }
  }

  if (escalation.fulfillment) {
    try {
      await sendEscalationEmail({
        to: process.env.FULFILLMENT_EMAIL,
        customerEmail,
        thread: escalationThread,
        reason: escalation.fulfillmentReason || 'Fulfillment escalation triggered',
        orderId,
      });
      escalated = true;
    } catch (err) {
      logEvent(conversation.id, 'escalation_error', { target: 'fulfillment', error: err.message });
    }
  }

  if (escalated) {
    markEscalated(conversation.id);
  }

  const responseMs = Date.now() - startMs;

  logEvent(conversation.id, 'reply', {
    confidence: classification.confidence,
    topic: classification.topic,
    escalated,
    responseMs,
  });

  logToFile({
    customerEmail,
    topic: classification.topic,
    action: escalated ? 'escalated' : 'replied',
    confidence: classification.confidence,
    responseMs,
    orderId: orderId || null,
    escalatedTo: [
      ...(escalation.customer ? ['tigertiger'] : []),
      ...(escalation.fulfillment ? ['fulfillment'] : []),
    ].join(',') || null,
  });

  return { replied, escalated, classification, responseMs };
}

module.exports = { processMessage };
