'use strict';

const { google } = require('googleapis');

let gmailClient;

function getGmail() {
  if (!gmailClient) {
    const auth = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    gmailClient = google.gmail({ version: 'v1', auth });
  }
  return gmailClient;
}

function decodeBase64(encoded) {
  return Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function getHeader(headers, name) {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function extractTextBody(payload) {
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractTextBody(part);
      if (text) return text;
    }
  }
  return '';
}

async function parseInboundMessages() {
  const gmail = getGmail();
  const { data } = await gmail.users.messages.list({
    userId: 'me',
    q: `to:${process.env.SUPPORT_EMAIL} is:unread`,
    maxResults: 20,
  });

  if (!data.messages || data.messages.length === 0) return [];

  const parsed = [];
  for (const { id } of data.messages) {
    try {
      const { data: msg } = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'full',
      });

      const headers = msg.payload.headers;
      const fromHeader = getHeader(headers, 'From');
      const emailMatch = fromHeader.match(/<(.+?)>/) || [null, fromHeader];
      const customerEmail = emailMatch[1].trim();
      const customerName = fromHeader.replace(/<.+?>/, '').replace(/"/g, '').trim();
      const subject = getHeader(headers, 'Subject');
      const body = extractTextBody(msg.payload);

      parsed.push({
        messageId: id,
        gmailThreadId: msg.threadId,
        customerEmail,
        customerName: customerName || customerEmail,
        subject,
        body: body.trim(),
      });

      // Mark as read
      await gmail.users.messages.modify({
        userId: 'me',
        id,
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    } catch {
      // Skip malformed messages
    }
  }

  return parsed;
}

async function sendReply(gmailThreadId, to, body) {
  const gmail = getGmail();

  const raw = [
    `From: Microgenix Support <${process.env.SUPPORT_EMAIL}>`,
    `To: ${to}`,
    `Subject: Re: Your Microgenix Support Request`,
    `In-Reply-To: ${gmailThreadId}`,
    `References: ${gmailThreadId}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');

  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded, threadId: gmailThreadId },
  });
}

module.exports = { parseInboundMessages, sendReply };
