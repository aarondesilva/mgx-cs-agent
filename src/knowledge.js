'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { HUMANIZER_INSTRUCTION } = require('./humanizer');

const KB_PATH = path.join(__dirname, '../data/knowledge-base.md');

const SYSTEM_PROMPT_BASE = `You are the Microgenix customer support agent. Microgenix sells health and wellness supplements.

Your role:
- Answer customer questions about products, orders, shipping, and returns
- Look up and manage orders using the tools available to you
- Escalate when you are not confident, when the customer is upset or confused, or when a situation requires human judgment
- Always be warm, genuine, and helpful

Safety rules you must always follow:
- Never cancel or refund an order autonomously. Escalate those requests.
- Always confirm with the customer before making any change to their order.
- Confirm a new shipping address in your reply BEFORE calling update_shipping_address.
- If you find multiple orders for a customer, ask which one they are referring to.
- Never share one customer's order information with another.
- If a customer mentions a medical concern or adverse reaction, respond with care and escalate immediately.

${HUMANIZER_INSTRUCTION}`;

let supabase;

function getSupabase() {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return supabase;
}

async function assembleContext(customerEmail) {
  const knowledgeBase = fs.existsSync(KB_PATH)
    ? fs.readFileSync(KB_PATH, 'utf8')
    : '';

  let products = [];
  try {
    const { data, error } = await getSupabase()
      .from('products')
      .select('name, description, ingredients, price');
    if (!error && data) products = data;
  } catch {
    // Supabase unavailable -- continue with KB only
  }

  return {
    systemPrompt: SYSTEM_PROMPT_BASE,
    knowledgeBase,
    products,
  };
}

module.exports = { assembleContext };
