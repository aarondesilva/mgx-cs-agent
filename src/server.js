'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const { processMessage } = require('./pipeline');
const { assembleContext } = require('./knowledge');
const { classifyMessage, draftReply } = require('./claude');

const app = express();
app.use(express.json());

// CORS for chat widget — allow requests from Microgenix site and any localhost for dev
const chatCors = cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // server-to-server / curl
    const allowed = [/microgenix\.net$/, /localhost/, /127\.0\.0\.1/];
    if (allowed.some(p => p.test(origin))) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['POST', 'OPTIONS'],
});

// Serve widget file with permissive CORS so any site can load it
app.get('/widget/chat-widget.js', cors(), (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, '../widget/chat-widget.js'));
});

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

// Synchronous endpoint for chat widget — waits for reply and returns it
app.options('/chat', chatCors);
app.post('/chat', chatCors, async (req, res) => {
  const { customerEmail, customerName, message, sessionId } = req.body || {};

  if (!customerEmail || !message) {
    res.status(400).json({ error: 'customerEmail and message are required' });
    return;
  }

  try {
    console.log('[chat] assembleContext...');
    const context = await assembleContext(customerEmail);
    console.log('[chat] classifyMessage...');
    const classification = await classifyMessage([], message);
    console.log('[chat] draftReply...');
    const reply = await draftReply([], message, context, customerEmail);
    console.log('[chat] done');

    // Strip email sign-off from chat replies — not needed in widget UI
    const chatReply = reply.replace(/\n+Willow,?\s*Microgenix Customer Support\s*$/i, '').trim();

    res.json({
      reply: chatReply,
      escalated: !!(classification.escalateCustomer || classification.escalateFulfillment),
      topic: classification.topic,
    });
  } catch (err) {
    console.error('[chat] Error:', err.message, err.stack);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = app;
