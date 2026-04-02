'use strict';

const { getDb } = require('./db');
const { assembleContext } = require('./knowledge');
const { classifyMessage, draftReply } = require('./claude');
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

  // Always draft a reply — even escalated tickets get a warm acknowledgment
  reply = await draftReply(thread, message, context, customerEmail);

  if (reply && gmailThreadId) {
    try {
      await sendReply(gmailThreadId, customerEmail, reply);
      replied = true;
      appendMessage(conversation.id, { role: 'agent', content: reply });
    } catch (err) {
      logEvent(conversation.id, 'send_error', { error: err.message });
    }
  }

  // Fire escalations independently — both can fire on same ticket
  if (escalation.customer) {
    try {
      await sendEscalationEmail({
        to: process.env.ESCALATION_EMAIL,
        customerEmail,
        thread: [...thread, { role: 'customer', content: message }, { role: 'agent', content: reply }],
        reason: escalation.customerReason || 'Customer escalation triggered',
        orderId,
      });
      escalated = true;
    } catch (err) {
      logEvent(conversation.id, 'escalation_error', { target: 'tigertiger', error: err.message });
    }
  }

  if (escalation.fulfillment) {
    try {
      await sendEscalationEmail({
        to: process.env.FULFILLMENT_EMAIL,
        customerEmail,
        thread: [...thread, { role: 'customer', content: message }, { role: 'agent', content: reply }],
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
    escalatedTo: escalation.customer ? 'tigertiger' : escalation.fulfillment ? 'fulfillment' : null,
  });

  return { replied, escalated, classification, responseMs };
}

module.exports = { processMessage };
