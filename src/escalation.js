'use strict';

const nodemailer = require('nodemailer');

function getTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: process.env.SUPPORT_EMAIL,
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
    },
  });
}

function shouldEscalate(classification) {
  return {
    customer: Boolean(classification.escalateCustomer),
    fulfillment: Boolean(classification.escalateFulfillment),
    customerReason: classification.escalateReason || null,
    fulfillmentReason: classification.escalateReason || null,
  };
}

async function sendEscalationEmail({ to, customerEmail, thread, reason, orderId }) {
  const transport = getTransport();

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

  await transport.sendMail({
    from: process.env.SUPPORT_EMAIL,
    to,
    subject,
    text,
  });
}

module.exports = { shouldEscalate, sendEscalationEmail };
