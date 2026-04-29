'use strict';

const { google } = require('googleapis');
const { getDb } = require('./db');
const { sendEmail } = require('./gmail');

const REMINDER_30_MIN = 30 * 60 * 1000;
const REMINDER_24_HR = 24 * 60 * 60 * 1000;
const REMINDER_96_HR = 96 * 60 * 60 * 1000;
const CANCEL_120_HR = 120 * 60 * 60 * 1000;

const SUBJECT_REGEX = /Interac e-Transfer.*?\$([\d,]+\.\d{2})\s+from\s+([A-Z][A-Z\s\-']+?)\s+(?:and\s+it\s+has\s+been|has\s+been)/i;

const ALERT_EMAIL = process.env.ALERT_EMAIL || 'hello@microgenix.net';

let etransferGmailClient;

function getETransferGmail() {
  if (etransferGmailClient) return etransferGmailClient;

  const auth = new google.auth.OAuth2(
    process.env.ETRANSFER_GMAIL_CLIENT_ID,
    process.env.ETRANSFER_GMAIL_CLIENT_SECRET,
    process.env.ETRANSFER_GMAIL_REDIRECT_URI
  );

  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) {
    throw new Error('ETRANSFER_NO_REFRESH_TOKEN: OAuth not yet completed. Visit /oauth/etransfer/connect.');
  }

  auth.setCredentials({ refresh_token: refreshToken });
  etransferGmailClient = google.gmail({ version: 'v1', auth });
  return etransferGmailClient;
}

function resetETransferGmail() {
  etransferGmailClient = null;
}

function getStoredRefreshToken() {
  const db = getDb();
  const row = db.prepare('SELECT refresh_token FROM etransfer_tokens WHERE id = 1').get();
  return row?.refresh_token || null;
}

function storeRefreshToken(token) {
  const db = getDb();
  db.prepare(`
    INSERT INTO etransfer_tokens (id, refresh_token, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET refresh_token = excluded.refresh_token, updated_at = excluded.updated_at
  `).run(token, new Date().toISOString());
  resetETransferGmail();
}

function isEmailProcessed(messageId) {
  const db = getDb();
  return !!db.prepare('SELECT 1 FROM etransfer_processed_emails WHERE message_id = ?').get(messageId);
}

function markEmailProcessed(messageId, parsed, matchedOrderId, action) {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO etransfer_processed_emails
      (message_id, amount, sender_name, matched_order_id, action, processed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(messageId, parsed?.amount || null, parsed?.senderName || null, matchedOrderId || null, action, new Date().toISOString());
}

function decodeBase64(encoded) {
  return Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function getHeader(headers, name) {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function parseSubject(subject) {
  const match = subject.match(SUBJECT_REGEX);
  if (!match) return null;
  const amount = parseFloat(match[1].replace(/,/g, ''));
  const senderName = match[2].trim().toUpperCase();
  return { amount, senderName };
}

async function findMatchingOrders(amount) {
  const { default: WooCommerceRestApi } = require('@woocommerce/woocommerce-rest-api');
  const api = new WooCommerceRestApi({
    url: process.env.WOOCOMMERCE_URL,
    consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
    consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
    version: 'wc/v3',
  });

  const { data } = await api.get('orders', {
    status: 'on-hold',
    per_page: 50,
    payment_method: 'betpg',
  });

  const target = parseFloat(amount).toFixed(2);
  return data.filter(o => parseFloat(o.total).toFixed(2) === target);
}

async function flipToProcessing(orderId, etransferData) {
  const { default: WooCommerceRestApi } = require('@woocommerce/woocommerce-rest-api');
  const api = new WooCommerceRestApi({
    url: process.env.WOOCOMMERCE_URL,
    consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
    consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
    version: 'wc/v3',
  });

  const noteText = `e-Transfer auto-matched: $${etransferData.amount.toFixed(2)} from ${etransferData.senderName}`;

  await api.put(`orders/${orderId}`, { status: 'processing' });
  await api.post(`orders/${orderId}/notes`, { note: noteText, customer_note: false });

  console.log(`[etransfer] Order #${orderId} flipped to processing. ${noteText}`);
}

async function pollETransferInbox() {
  let gmail;
  try {
    gmail = getETransferGmail();
  } catch (err) {
    if (err.message.startsWith('ETRANSFER_NO_REFRESH_TOKEN')) {
      console.log('[etransfer] OAuth not connected yet. Skipping poll.');
      return;
    }
    throw err;
  }

  const { data } = await gmail.users.messages.list({
    userId: 'me',
    q: 'subject:"Interac e-Transfer" newer_than:7d',
    maxResults: 25,
  });

  if (!data.messages || data.messages.length === 0) {
    return;
  }

  for (const { id } of data.messages) {
    if (isEmailProcessed(id)) continue;

    try {
      const { data: msg } = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      });

      const subject = getHeader(msg.payload.headers, 'Subject');
      const parsed = parseSubject(subject);

      if (!parsed) {
        markEmailProcessed(id, null, null, 'unparseable');
        continue;
      }

      if (!/automatically deposited/i.test(subject)) {
        markEmailProcessed(id, parsed, null, 'not_auto_deposited');
        continue;
      }

      const matches = await findMatchingOrders(parsed.amount);

      if (matches.length === 0) {
        markEmailProcessed(id, parsed, null, 'no_match');
        console.log(`[etransfer] No on-hold order matching $${parsed.amount} from ${parsed.senderName}`);
        continue;
      }

      if (matches.length > 1) {
        markEmailProcessed(id, parsed, null, 'ambiguous');
        await sendAmbiguousAlert(matches, parsed);
        continue;
      }

      const order = matches[0];
      await flipToProcessing(order.id, parsed);
      markEmailProcessed(id, parsed, order.id, 'matched');
    } catch (err) {
      console.error(`[etransfer] Error processing message ${id}:`, err.message);
    }
  }
}

async function sendAmbiguousAlert(matches, etransfer) {
  const orderList = matches.map(o =>
    `Order #${o.id} | ${o.billing.first_name} ${o.billing.last_name} | $${o.total} | ${o.billing.email}`
  ).join('\n');

  const text = `An incoming e-Transfer matched multiple on-hold orders. Manual review needed.

Incoming e-Transfer:
  Amount: $${etransfer.amount.toFixed(2)}
  Sender (per Interac): ${etransfer.senderName}

Matching on-hold orders:
${orderList}

Please review at https://microgenix.net/wp-admin/edit.php?post_type=shop_order and manually flip the correct one to Processing.

Microgenix Payment Matcher`;

  await sendEmail({
    to: ALERT_EMAIL,
    subject: `[ACTION NEEDED] Ambiguous e-Transfer match: $${etransfer.amount.toFixed(2)} from ${etransfer.senderName}`,
    text,
  });

  console.log(`[etransfer] Ambiguous alert sent for $${etransfer.amount} (${matches.length} matches)`);
}

function getReminderTemplate(type, order) {
  const firstName = order.billing.first_name || 'there';
  const orderId = order.id;
  const instructions = `1. Send full amount via Interac E-Transfer to abcpayments1@gmail.com
2. Use the name "Willow Pea" as the payee name in your E-Transfer setup.
3. In the memo or note of the e-transfer, include your order number (#${orderId}).
4. Secret Question: Our Country?
5. Secret Answer: canada (lower case)`;

  if (type === 'r1') {
    return {
      subject: `Your Microgenix order #${orderId}`,
      text: `Hi ${firstName},

We haven't seen your e-Transfer come through for order #${orderId}. Are you not planning to send the payment? Let us know if you need any assistance, and we'll be happy to help!

Just in case, here are the payment instructions again:

${instructions}

Warmly,
Willow
microgenix.net`,
    };
  }

  if (type === 'r2') {
    return {
      subject: `Just checking in on order #${orderId}`,
      text: `Hi ${firstName},

Following up on order #${orderId}. Still no e-Transfer received on our end.

Need a hand sending it? Reply to this email and I can walk you through.

Payment instructions:

${instructions}

Warmly,
Willow
microgenix.net`,
    };
  }

  if (type === 'r3') {
    return {
      subject: `Last reminder: order #${orderId}`,
      text: `Hi ${firstName},

This is the last reminder before we cancel order #${orderId}.

If you'd still like the order, please send the e-Transfer in the next 24 hours. Otherwise we'll cancel and free up the inventory.

Payment instructions:

${instructions}

Warmly,
Willow
microgenix.net`,
    };
  }

  if (type === 'cancel') {
    return {
      subject: `Order #${orderId} has been cancelled`,
      text: `Hi ${firstName},

We've cancelled order #${orderId} since payment didn't come through.

If you'd still like to grab those products, you can place a new order at https://microgenix.net any time.

Any questions? Just reply to this email.

Warmly,
Willow
microgenix.net`,
    };
  }

  return null;
}

async function processOnHoldReminders() {
  const { default: WooCommerceRestApi } = require('@woocommerce/woocommerce-rest-api');
  const api = new WooCommerceRestApi({
    url: process.env.WOOCOMMERCE_URL,
    consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
    consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
    version: 'wc/v3',
  });

  const { data: orders } = await api.get('orders', {
    status: 'on-hold',
    payment_method: 'betpg',
    per_page: 100,
  });

  if (!orders.length) return;

  const now = Date.now();

  for (const order of orders) {
    try {
      const orderDate = new Date(order.date_created_gmt + 'Z').getTime();
      const age = now - orderDate;
      const meta = Object.fromEntries((order.meta_data || []).map(m => [m.key, m.value]));

      const ts = new Date().toISOString();

      if (age >= CANCEL_120_HR && !meta._etransfer_cancelled) {
        const tmpl = getReminderTemplate('cancel', order);
        await sendEmail({ to: order.billing.email, subject: tmpl.subject, text: tmpl.text });
        await api.put(`orders/${order.id}`, {
          status: 'cancelled',
          meta_data: [
            { key: '_etransfer_cancelled', value: ts },
            { key: '_etransfer_reminder_3_sent', value: meta._etransfer_reminder_3_sent || 'skipped' },
            { key: '_etransfer_reminder_2_sent', value: meta._etransfer_reminder_2_sent || 'skipped' },
            { key: '_etransfer_reminder_1_sent', value: meta._etransfer_reminder_1_sent || 'skipped' },
          ],
        });
        await api.post(`orders/${order.id}/notes`, {
          note: 'Auto-cancelled after 5 days, no e-Transfer received. Cancellation email sent.',
          customer_note: false,
        });
        console.log(`[etransfer] Order #${order.id} auto-cancelled at 5 days`);
        continue;
      }

      if (age >= REMINDER_96_HR && !meta._etransfer_reminder_3_sent) {
        const tmpl = getReminderTemplate('r3', order);
        await sendEmail({ to: order.billing.email, subject: tmpl.subject, text: tmpl.text });
        await api.put(`orders/${order.id}`, {
          meta_data: [
            { key: '_etransfer_reminder_3_sent', value: ts },
            { key: '_etransfer_reminder_2_sent', value: meta._etransfer_reminder_2_sent || 'skipped' },
            { key: '_etransfer_reminder_1_sent', value: meta._etransfer_reminder_1_sent || 'skipped' },
          ],
        });
        console.log(`[etransfer] Reminder #3 sent for order #${order.id}`);
        continue;
      }

      if (age >= REMINDER_24_HR && !meta._etransfer_reminder_2_sent) {
        const tmpl = getReminderTemplate('r2', order);
        await sendEmail({ to: order.billing.email, subject: tmpl.subject, text: tmpl.text });
        await api.put(`orders/${order.id}`, {
          meta_data: [
            { key: '_etransfer_reminder_2_sent', value: ts },
            { key: '_etransfer_reminder_1_sent', value: meta._etransfer_reminder_1_sent || 'skipped' },
          ],
        });
        console.log(`[etransfer] Reminder #2 sent for order #${order.id}`);
        continue;
      }

      if (age >= REMINDER_30_MIN && !meta._etransfer_reminder_1_sent) {
        const tmpl = getReminderTemplate('r1', order);
        await sendEmail({ to: order.billing.email, subject: tmpl.subject, text: tmpl.text });
        await api.put(`orders/${order.id}`, {
          meta_data: [{ key: '_etransfer_reminder_1_sent', value: ts }],
        });
        console.log(`[etransfer] Reminder #1 sent for order #${order.id}`);
        continue;
      }
    } catch (err) {
      console.error(`[etransfer] Reminder loop error on order #${order.id}:`, err.message);
    }
  }
}

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.ETRANSFER_GMAIL_CLIENT_ID,
    process.env.ETRANSFER_GMAIL_CLIENT_SECRET,
    process.env.ETRANSFER_GMAIL_REDIRECT_URI
  );
}

function getAuthUrl() {
  const oauth2 = getOAuthClient();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  });
}

async function exchangeCodeForToken(code) {
  const oauth2 = getOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('No refresh_token returned. Revoke previous grant at myaccount.google.com/permissions and retry.');
  }
  storeRefreshToken(tokens.refresh_token);
  return tokens;
}

module.exports = {
  pollETransferInbox,
  processOnHoldReminders,
  getAuthUrl,
  exchangeCodeForToken,
  parseSubject,
  findMatchingOrders,
  getStoredRefreshToken,
  getETransferGmail,
};
