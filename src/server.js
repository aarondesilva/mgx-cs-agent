'use strict';

const express = require('express');
const { processMessage } = require('./pipeline');

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.post('/webhook', (req, res) => {
  const { customerEmail, customerName, message, orderId } = req.body || {};

  if (!customerEmail || !message) {
    res.status(400).json({ error: 'customerEmail and message are required' });
    return;
  }

  res.json({ status: 'received' });

  // Process asynchronously — response already sent
  setImmediate(async () => {
    try {
      await processMessage({
        customerEmail,
        customerName: customerName || customerEmail,
        message,
        gmailThreadId: null,
        orderId: orderId || null,
      });
    } catch (err) {
      console.error('[webhook] Processing error:', err.message);
    }
  });
});

module.exports = app;
