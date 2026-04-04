'use strict';

require('dotenv').config();
const { initDb } = require('../src/db');
const { assembleContext } = require('../src/knowledge');
const { classifyMessage, draftReply } = require('../src/claude');

initDb();

async function main() {
  const message = process.argv.slice(2).join(' ');
  if (!message) {
    console.error('Usage: node scripts/test-message.js "Your test message here"');
    process.exit(1);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('CUSTOMER MESSAGE:');
  console.log(message);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('Classifying...');
  const classification = await classifyMessage([], message);

  console.log(`Topic:       ${classification.topic}`);
  console.log(`Confidence:  ${(classification.confidence * 100).toFixed(0)}%`);
  if (classification.escalateCustomer) {
    console.log(`Escalate:    YES (customer) — ${classification.escalateReason}`);
  }
  if (classification.escalateFulfillment) {
    console.log(`Escalate:    YES (fulfillment) — ${classification.escalateReason}`);
  }

  console.log('\nDrafting reply...\n');
  const context = await assembleContext('test@test.com');
  const reply = await draftReply([], message, context, 'test@test.com');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('AGENT REPLY:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(reply);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
