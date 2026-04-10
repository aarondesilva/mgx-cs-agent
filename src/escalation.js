'use strict';

const { sendEmail } = require('./gmail');

function shouldEscalate(classification) {
  return {
    customer: Boolean(classification.escalateCustomer),
    fulfillment: Boolean(classification.escalateFulfillment),
    customerReason: classification.escalateReason || null,
    fulfillmentReason: classification.escalateReason || null,
  };
}

async function sendEscalationEmail({ to, customerEmail, thread, reason, orderId, ccCustomer, ccFulfillment }) {
  const threadText = thread
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n---\n\n');

  const subject = `[CS Escalation] Customer: ${customerEmail}${orderId ? ` | Order #${orderId}` : ''}`;

  const text = [
    `ESCALATION REASON: ${reason}`,
    '',
    `CUSTOMER: ${customerEmail}`,
    orderId ? `ORDER: #${orderId}` : '',
    '',
    '--- CONVERSATION THREAD ---',
    '',
    threadText,
  ].filter(Boolean).join('\n');

  const ccAddresses = [];
  if (ccCustomer && customerEmail && !customerEmail.includes('@widget.mgx')) {
    ccAddresses.push(customerEmail);
  }
  if (ccFulfillment && process.env.FULFILLMENT_EMAIL) {
    ccAddresses.push(process.env.FULFILLMENT_EMAIL);
  }

  await sendEmail({
    to,
    cc: ccAddresses.length ? ccAddresses.join(', ') : undefined,
    subject,
    text,
  });
}

module.exports = { shouldEscalate, sendEscalationEmail };
