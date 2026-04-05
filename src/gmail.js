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

function buildHtmlEmail(body) {
  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : 'https://microgenix.net';
  const logoUrl = `${baseUrl}/widget/logo.png`;

  // Convert plain text body to HTML paragraphs
  const htmlBody = body
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .split(/\n\n+/)
    .map(p => `<p style="margin:0 0 14px 0;line-height:1.6">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  // Strip the plain-text signature block if present — we replace with HTML version
  const bodyWithoutSig = htmlBody.replace(/<p[^>]*>Avery<br>[\s\S]*?<\/p>/i, '');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;color:#1a1a1a;max-width:600px;margin:0;padding:20px">
${bodyWithoutSig}
<table style="margin-top:24px;border-top:1px solid #e5e5e5;padding-top:16px" cellpadding="0" cellspacing="0">
  <tr>
    <td style="vertical-align:middle;padding-right:12px">
      <img src="${logoUrl}" width="36" height="36" alt="Microgenix" style="display:block;border-radius:50%">
    </td>
    <td style="vertical-align:middle">
      <div style="font-weight:600;font-size:14px;color:#2b3a72">Avery</div>
      <div style="font-size:13px;color:#666">Microgenix Support</div>
      <div style="font-size:12px;margin-top:2px"><a href="https://microgenix.net" style="color:#2b3a72;text-decoration:none">microgenix.net</a></div>
    </td>
  </tr>
</table>
</body>
</html>`;
}

async function sendReply(gmailThreadId, to, body) {
  const gmail = getGmail();
  const htmlBody = buildHtmlEmail(body);

  const boundary = 'mgx_boundary_' + Date.now();
  const raw = [
    `From: Microgenix Support <${process.env.SUPPORT_EMAIL}>`,
    `To: ${to}`,
    `Subject: Re: Your Microgenix Support Request`,
    `In-Reply-To: ${gmailThreadId}`,
    `References: ${gmailThreadId}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded, threadId: gmailThreadId },
  });
}

module.exports = { parseInboundMessages, sendReply };
