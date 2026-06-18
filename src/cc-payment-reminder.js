'use strict';

const { getDb } = require('./db');
const { getApi } = require('./woocommerce');
const { sendBrevoEmail } = require('./brevo');

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const CC_GATEWAY_MATCH = /credit\s*\/?\s*debit|stripe|woocommerce_payments|authorize|square/i;
const SITE_URL = (process.env.WOOCOMMERCE_URL || 'https://microgenix.net').replace(/\/+$/, '');

function ensureSchema() {
  const db = getDb();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS cc_reminder_sent (
      order_id   INTEGER PRIMARY KEY,
      sent_at    TEXT NOT NULL,
      email      TEXT,
      total      TEXT
    )
  `).run();
}

function alreadySent(orderId) {
  const db = getDb();
  return !!db.prepare('SELECT 1 FROM cc_reminder_sent WHERE order_id = ?').get(orderId);
}

function markSent(orderId, email, total) {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO cc_reminder_sent (order_id, sent_at, email, total)
    VALUES (?, ?, ?, ?)
  `).run(orderId, new Date().toISOString(), email || null, total || null);
}

function buildPayUrl(order) {
  return `${SITE_URL}/checkout/order-pay/${order.id}/?pay_for_order=true&key=${order.order_key}`;
}

function buildEmail(order) {
  const firstName = (order.billing && order.billing.first_name && order.billing.first_name.trim()) || 'there';
  const payUrl = buildPayUrl(order);
  const subject = `Your Microgenix order #${order.id} payment`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `It looks like the credit card payment for order #${order.id} didn't go through. You can pick up right where you left off and try again here:`,
    ``,
    payUrl,
    ``,
    `If a different card works better, that's totally fine too. And if you run into any trouble, just reply to this email and we'll help you get it sorted.`,
    ``,
    `Warmly,`,
    `Willow`,
    `Microgenix Community Lead`,
  ].join('\n');

  // Tight, single-typeface palette to avoid a "spammy" look:
  //   one text colour, one muted grey, navy only for the button + links, bold only on the button.
  const FONT = "Arial, Helvetica, sans-serif";
  const NAVY = "#2a3b73";   // button + links only
  const TEXT = "#333333";   // all body copy + signature
  const MUTED = "#888888";  // helper line + footer only
  const LOGO_URL = "https://microgenix.net/wp-content/mgx-bright/img/logo-blue.png";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body,table,td,p,a,span,div{font-family:${FONT} !important;}</style></head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:${FONT};color:${TEXT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec;font-family:${FONT};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #ececec;border-radius:12px;overflow:hidden;">
<tr><td align="center" style="padding:30px 0 22px;border-bottom:1px solid #eeeeee;">
<img src="${LOGO_URL}" alt="Microgenix" width="150" style="display:block;width:150px;height:auto;border:0;outline:none;">
</td></tr>
<tr><td style="padding:30px 34px 0;font-family:${FONT};color:${TEXT};font-size:15px;line-height:1.6;">
<p style="font-family:${FONT};margin:0 0 16px;">Hi ${firstName},</p>
<p style="font-family:${FONT};margin:0 0 16px;">It looks like the credit card payment for order #${order.id} didn't go through. You can pick up right where you left off and try again here:</p>
</td></tr>
<tr><td align="center" style="padding:8px 34px 20px;">
<a href="${payUrl}" style="font-family:${FONT};display:inline-block;padding:14px 30px;background:${NAVY};color:#ffffff !important;text-decoration:none;border-radius:6px;font-weight:bold;font-size:15px;">Complete your payment</a>
</td></tr>
<tr><td style="padding:0 34px 8px;font-family:${FONT};color:${MUTED};font-size:13px;line-height:1.5;">
Or paste this link in your browser:<br><a href="${payUrl}" style="font-family:${FONT};color:${NAVY};word-break:break-all;">${payUrl}</a>
</td></tr>
<tr><td style="padding:16px 34px 30px;font-family:${FONT};color:${TEXT};font-size:15px;line-height:1.6;">
<p style="font-family:${FONT};margin:0 0 16px;">If a different card works better, that's totally fine too. And if you run into any trouble, just reply to this email and we'll help you get it sorted.</p>
<p style="font-family:${FONT};margin:18px 0 0;">Warmly,<br>Willow<br>Microgenix Community Lead</p>
</td></tr>
<tr><td style="padding:18px 34px 26px;border-top:1px solid #eeeeee;font-family:${FONT};color:${MUTED};font-size:13px;line-height:1.5;text-align:center;">
You're receiving this because you started an order at <a href="https://microgenix.net" style="font-family:${FONT};color:${MUTED};">microgenix.net</a>.<br>
Questions? Just reply, or email <a href="mailto:hello@microgenix.net" style="font-family:${FONT};color:${MUTED};">hello@microgenix.net</a>.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  return { subject, text, html };
}

async function sendReminderForOrder(order, { force = false } = {}) {
  ensureSchema();

  if (!force && alreadySent(order.id)) {
    return { skipped: 'already_sent', orderId: order.id };
  }

  const email = order.billing && order.billing.email;
  if (!email) {
    return { skipped: 'no_email', orderId: order.id };
  }

  const { subject, text, html } = buildEmail(order);

  await sendBrevoEmail({
    to: email,
    subject,
    text,
    html,
    fromName: 'Willow at Microgenix',
    fromEmail: 'hello@microgenix.net',
    replyTo: 'hello@microgenix.net',
  });

  markSent(order.id, email, order.total);

  try {
    await getApi().post(`orders/${order.id}/notes`, {
      note: `CC payment follow-up email auto-sent to ${email} (Willow template, +15min cadence).`,
      customer_note: false,
    });
  } catch (err) {
    console.warn(`[cc-reminder] note-add failed for #${order.id}:`, err.message);
  }

  console.log(`[cc-reminder] sent → order #${order.id} (${email})`);
  return { sent: true, orderId: order.id, email };
}

async function processSpecificOrder(orderId, opts = {}) {
  const api = getApi();
  const { data: order } = await api.get(`orders/${orderId}`);
  if (!order || order.status !== 'pending') {
    return { skipped: `status_${order ? order.status : 'missing'}`, orderId };
  }
  const gateway = `${order.payment_method || ''} ${order.payment_method_title || ''}`;
  if (!CC_GATEWAY_MATCH.test(gateway)) {
    return { skipped: 'not_cc_gateway', orderId, gateway: gateway.trim() };
  }
  return sendReminderForOrder(order, opts);
}

async function processPendingCcOrders() {
  ensureSchema();
  const api = getApi();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: orders } = await api.get('orders', {
    status: 'pending',
    after: since,
    per_page: 50,
  });

  const cutoff = Date.now() - FIFTEEN_MIN_MS;
  let sent = 0, skipped = 0;

  for (const order of orders) {
    try {
      if (alreadySent(order.id)) { skipped++; continue; }

      const gateway = `${order.payment_method || ''} ${order.payment_method_title || ''}`;
      if (!CC_GATEWAY_MATCH.test(gateway)) { skipped++; continue; }

      const createdMs = new Date(order.date_created_gmt + 'Z').getTime();
      if (!Number.isFinite(createdMs) || createdMs > cutoff) { skipped++; continue; }

      const result = await sendReminderForOrder(order);
      if (result.sent) sent++; else skipped++;
    } catch (err) {
      console.error(`[cc-reminder] order #${order.id} failed:`, err.message);
    }
  }

  console.log(`[cc-reminder] cycle done — sent ${sent}, skipped ${skipped}, scanned ${orders.length}`);
  return { sent, skipped, scanned: orders.length };
}

module.exports = {
  processPendingCcOrders,
  processSpecificOrder,
  sendReminderForOrder,
  buildEmail,
};
