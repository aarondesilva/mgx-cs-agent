'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;
const { HUMANIZER_INSTRUCTION } = require('./humanizer');
const { toolDefinitions, handleToolCall } = require('./woocommerce');

let client;

function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const CLASSIFY_SYSTEM = `You are a customer support classifier for Microgenix, a supplement company.

Analyze the customer's message and conversation history. Return ONLY valid JSON in this exact format — no markdown, no explanation:

{
  "confidence": <0.0 to 1.0 — how confident you are you can handle this without escalation>,
  "topic": <one of: "tracking", "shipping", "order_status", "product_info", "returns", "address_change", "coupon", "complaint", "medical", "legal", "general">,
  "escalateCustomer": <true if customer is upset/confused on a second reply, explicitly asks for human, confidence < 0.65, or mentions medical concern or legal threat>,
  "escalateFulfillment": <true if this is a lost package, wrong item, carrier issue, or tracking problem beyond 5 days with no updates>,
  "escalateReason": <short string explaining why, or null if no escalation>
}

Escalation rules:
- escalateCustomer = true if confidence < 0.65
- escalateCustomer = true if customer explicitly asks for a human
- escalateCustomer = true if thread shows customer getting more upset or more confused
- escalateCustomer = true if any mention of medical concern, adverse reaction, or legal threat
- escalateFulfillment = true for lost packages, wrong items, carrier failures, or tracking not updating after 5+ days`;

function formatThreadForClassifier(thread) {
  if (!thread || thread.length === 0) return 'No prior conversation.';
  return thread.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
}

async function classifyMessage(thread, newMessage) {
  const threadText = formatThreadForClassifier(thread);
  const userContent = `CONVERSATION HISTORY:\n${threadText}\n\nNEW MESSAGE FROM CUSTOMER:\n${newMessage}`;

  try {
    const response = await getClient().messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 256,
      system: CLASSIFY_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    });

    const text = response.content.find(b => b.type === 'text')?.text || '';
    const classification = JSON.parse(text);

    // Enforce confidence-based escalation
    if (classification.confidence < 0.65) {
      classification.escalateCustomer = true;
      classification.escalateReason = classification.escalateReason || 'Low confidence';
    }

    return classification;
  } catch {
    // On any error, default to escalation
    return {
      confidence: 0.5,
      topic: 'general',
      escalateCustomer: true,
      escalateFulfillment: false,
      escalateReason: 'Classification error — defaulting to escalation',
    };
  }
}

function buildSystemPrompt(context) {
  const productInfo = context.products.length > 0
    ? `\n\nCURRENT PRODUCTS:\n${context.products.map(p => `- ${p.name}: ${p.description}`).join('\n')}`
    : '';

  return `${context.systemPrompt}

${HUMANIZER_INSTRUCTION}

KNOWLEDGE BASE:
${context.knowledgeBase}${productInfo}`;
}

async function draftReply(thread, newMessage, context, customerEmail) {
  const systemPrompt = buildSystemPrompt(context);
  const threadText = formatThreadForClassifier(thread);

  const userContent = thread.length > 0
    ? `CONVERSATION HISTORY:\n${threadText}\n\nNEW MESSAGE FROM CUSTOMER:\n${newMessage}`
    : newMessage;

  const messages = [{ role: 'user', content: userContent }];
  const MAX_TOOL_TURNS = 5;

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const response = await getClient().messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      tools: toolDefinitions,
      messages,
    });

    if (response.stop_reason === 'end_turn') {
      const text = response.content.find(b => b.type === 'text');
      return text ? text.text : '';
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const result = await handleToolCall(block.name, block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Unexpected stop reason
    break;
  }

  return 'I am looking into this for you and will follow up shortly.';
}

async function draftFollowUp(customerFirstName, topic) {
  const name = customerFirstName || 'there';
  const response = await getClient().messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 256,
    system: `You are the Microgenix customer support agent. ${HUMANIZER_INSTRUCTION}`,
    messages: [
      {
        role: 'user',
        content: `Write a short, warm follow-up email to ${name}. Their previous support topic was: "${topic}". Check in to make sure everything was resolved and they are happy. One short paragraph only.`,
      },
    ],
  });

  const text = response.content.find(b => b.type === 'text');
  return text ? text.text : `Hi ${name}, just checking in to make sure everything is going well. Let us know if you need anything.`;
}

module.exports = { classifyMessage, draftReply, draftFollowUp };
