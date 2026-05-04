'use strict';

// Brevo transactional email sender. Used for outbound automations from hello@microgenix.net.
// No OAuth, no token expiry. Sender domain microgenix.net is already verified in Brevo.

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const DEFAULT_FROM_EMAIL = 'hello@microgenix.net';
const DEFAULT_FROM_NAME = 'Microgenix';
const DEFAULT_REPLY_TO = 'hello@microgenix.net';

async function sendBrevoEmail({ to, cc, subject, html, text, fromName, fromEmail, replyTo }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY not set');
  if (!to) throw new Error('to is required');
  if (!subject) throw new Error('subject is required');
  if (!html && !text) throw new Error('html or text is required');

  const toList = Array.isArray(to)
    ? to.map(e => (typeof e === 'string' ? { email: e } : e))
    : [{ email: to }];

  const payload = {
    sender: {
      email: fromEmail || DEFAULT_FROM_EMAIL,
      name: fromName || DEFAULT_FROM_NAME,
    },
    to: toList,
    replyTo: { email: replyTo || DEFAULT_REPLY_TO },
    subject,
  };
  if (cc) {
    const ccList = Array.isArray(cc)
      ? cc.map(e => (typeof e === 'string' ? { email: e } : e))
      : [{ email: cc }];
    payload.cc = ccList;
  }
  if (html) payload.htmlContent = html;
  if (text) payload.textContent = text;

  const res = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo send failed (${res.status}): ${body}`);
  }
  return res.json();
}

module.exports = { sendBrevoEmail };
