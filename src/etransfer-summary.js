'use strict';

const { getApi } = require('./woocommerce');
const { sendBrevoEmail } = require('./brevo');

const TO_EMAIL = process.env.WEEKLY_ETRANSFER_TO || 'jillian.pauline@gmail.com';
const CC_EMAIL = process.env.WEEKLY_ETRANSFER_CC || 'tigertiger@microgenix.net';

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Last full Mon 00:00 UTC to Sun 23:59:59.999 UTC.
function lastWeekWindow(now = new Date()) {
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const thisMondayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - daysSinceMonday * 86400000;
  return {
    start: new Date(thisMondayMs - 7 * 86400000),
    end: new Date(thisMondayMs - 1),
  };
}

async function fetchPaidETransferOrders(start, end) {
  const wc = getApi();
  const queryAfter = new Date(start.getTime() - 21 * 86400000).toISOString();
  const orders = [];
  let page = 1;
  while (page <= 30) {
    const { data } = await wc.get('orders', {
      payment_method: 'betpg',
      status: 'processing,completed',
      after: queryAfter.replace(/\.\d+Z$/, ''),
      per_page: 100,
      page,
      orderby: 'date',
      order: 'desc',
    });
    if (!Array.isArray(data) || data.length === 0) break;
    orders.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return orders.filter(o => {
    // The WC REST orders endpoint silently ignores `payment_method` query param,
    // so enforce the e-Transfer (betpg) filter client-side.
    if (o.payment_method !== 'betpg') return false;
    if (!o.date_paid_gmt) return false;
    const paid = new Date(o.date_paid_gmt + 'Z');
    return paid >= start && paid <= end;
  });
}

function fmtMoneyShort(n) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return `$${v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function fmtShortDate(d) {
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function fmtLongDate(d) {
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function buildEmail(orders, start, end) {
  // Most orders should be CAD (Interac). If anything sneaks in non-CAD, it still totals correctly.
  const total = orders.reduce((s, o) => s + parseFloat(o.total || 0), 0);
  const subjectRange = `${fmtShortDate(start)} - ${fmtShortDate(end)}, ${start.getUTCFullYear()}`;
  const subject = `Microgenix e-Transfer Sales Report - Week of ${subjectRange}`;

  const longRange = `Monday ${fmtLongDate(start)} to Sunday ${fmtLongDate(end)}, ${start.getUTCFullYear()}`;

  const rows = orders
    .map(o => {
      const billing = o.billing || {};
      const name = `${billing.first_name || ''} ${billing.last_name || ''}`.trim() || billing.email || '(no name)';
      return {
        paidDate: new Date((o.date_paid_gmt || o.date_created_gmt) + 'Z'),
        id: o.id,
        name,
        total: parseFloat(o.total || 0),
      };
    })
    .sort((a, b) => a.paidDate - b.paidDate);

  // Plain text version
  let text = `Hi Jillian,\n\n`;
  text += `E-Transfer sales report for the week of ${longRange}.\n\n`;
  text += `Total: ${fmtMoneyShort(total)} CAD across ${orders.length} completed e-Transfer order${orders.length === 1 ? '' : 's'}.\n\n`;
  if (orders.length > 0) {
    text += `Order #     Customer                              Total          Date\n`;
    text += `--------------------------------------------------------------------------\n`;
    for (const r of rows) {
      const idCol = `#${r.id}`.padEnd(11, ' ');
      const nameCol = (r.name.length > 36 ? r.name.slice(0, 34) + '..' : r.name).padEnd(38, ' ');
      const totalCol = fmtMoneyShort(r.total).padStart(11, ' ');
      text += `${idCol}${nameCol}${totalCol}    ${fmtShortDate(r.paidDate)}\n`;
    }
    text += `\nTotal: ${fmtMoneyShort(total)} CAD\n`;
  } else {
    text += `No completed e-Transfer payments in this window.\n`;
  }
  text += `\nThanks,\nFelix\n`;

  // HTML
  const tableRowsHtml = rows.map(r => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #e8e8e8;font-family:'Inter',Arial,sans-serif;">#${r.id}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e8e8e8;font-family:'Inter',Arial,sans-serif;">${escapeHtml(r.name)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e8e8e8;font-family:'Inter',Arial,sans-serif;text-align:right;">${fmtMoneyShort(r.total)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e8e8e8;font-family:'Inter',Arial,sans-serif;">${fmtShortDate(r.paidDate)}</td>
    </tr>`).join('');

  const tableHtml = orders.length === 0 ? '' : `
    <table style="width:100%;border-collapse:collapse;margin:12px 0 4px;font-family:'Inter',Arial,sans-serif;font-size:14px;">
      <thead>
        <tr style="background:#1a4971;color:#fff;text-align:left;">
          <th style="padding:12px 14px;font-weight:600;">Order #</th>
          <th style="padding:12px 14px;font-weight:600;">Customer</th>
          <th style="padding:12px 14px;font-weight:600;text-align:right;">Total</th>
          <th style="padding:12px 14px;font-weight:600;">Date</th>
        </tr>
      </thead>
      <tbody>${tableRowsHtml}</tbody>
      <tfoot>
        <tr style="background:#f4f4f4;">
          <td style="padding:12px 14px;font-weight:700;font-family:'Inter',Arial,sans-serif;">Total</td>
          <td></td>
          <td style="padding:12px 14px;font-weight:700;font-family:'Inter',Arial,sans-serif;text-align:right;">${fmtMoneyShort(total)} CAD</td>
          <td></td>
        </tr>
      </tfoot>
    </table>`;

  const html = `<div style="font-family:'Inter',Arial,sans-serif;color:#1a1a1a;max-width:760px;line-height:1.6;font-size:15px;">
    <p>Hi Jillian,</p>
    <p>E-Transfer sales report for the week of <strong>${longRange}</strong>.</p>
    <p><strong>Total: ${fmtMoneyShort(total)} CAD</strong> across ${orders.length} completed e-Transfer order${orders.length === 1 ? '' : 's'}.</p>
    ${tableHtml || '<p>No completed e-Transfer payments in this window.</p>'}
    <p style="margin-top:24px;">Thanks,<br>Felix</p>
  </div>`;

  return { subject, text, html };
}

async function sendWeeklySummary({ now = new Date(), to = TO_EMAIL, cc = CC_EMAIL, force = false } = {}) {
  // Day-of-week guard: only proceed on Monday UTC. Use force=true for manual sends.
  // Reason: cron is `0 9 * * 1` (Mon 9am UTC) but Railway redeploys / manual triggers
  // have caused duplicate sends on other days. This guard ensures send only happens Mondays.
  if (!force && now.getUTCDay() !== 1) {
    console.log(`[etransfer-summary] skipped: today is UTC day ${now.getUTCDay()}, not Monday (1)`);
    return { skipped: true, reason: 'not_monday', utcDay: now.getUTCDay() };
  }
  const { start, end } = lastWeekWindow(now);
  const orders = await fetchPaidETransferOrders(start, end);
  const { subject, text, html } = buildEmail(orders, start, end);
  await sendBrevoEmail({
    to,
    cc,
    subject,
    text,
    html,
    fromName: 'Microgenix',
    fromEmail: 'hello@microgenix.net',
    replyTo: 'hello@microgenix.net',
  });
  console.log(`[etransfer-summary] sent: count=${orders.length} window=${start.toISOString()}..${end.toISOString()} to=${to} cc=${cc}`);
  return { count: orders.length, start, end };
}

module.exports = { lastWeekWindow, fetchPaidETransferOrders, buildEmail, sendWeeklySummary };
