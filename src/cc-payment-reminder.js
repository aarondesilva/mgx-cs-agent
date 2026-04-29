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
    `Willow - Microgenix Community Lead 🍄`,
  ].join('\n');

  const html = `<!doctype html>
<html><body style="font-family:Inter,Arial,sans-serif;color:#222;font-size:15px;line-height:1.5;">
<p>Hi ${firstName},</p>
<p>It looks like the credit card payment for order <strong>#${order.id}</strong> didn't go through. You can pick up right where you left off and try again here:</p>
<p style="margin:24px 0;">
  <a href="${payUrl}" style="display:inline-block;padding:12px 22px;background:linear-gradient(90deg,#1a4971,#2980b9);color:#ffffff;text-decoration:none;border-radius:5px;font-weight:600;">Complete your payment</a>
</p>
<p style="font-size:13px;color:#666;">Or paste this link in your browser:<br><a href="${payUrl}" style="color:#1a4971;">${payUrl}</a></p>
<p>If a different card works better, that's totally fine too. And if you run into any trouble, just reply to this email and we'll help you get it sorted.</p>
<p>Warmly,<br>Willow - Microgenix Community Lead 🍄</p>
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
};
