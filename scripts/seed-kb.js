'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const Anthropic = require('@anthropic-ai/sdk').default;

const KB_PATH = path.join(__dirname, '../data/knowledge-base.md');

const SKIP_DOMAINS = [
  'microgenix.net', 'linkedin.com', 'jukeboxprint.com', 'googlemail.com',
  'peerspace.com', 'ups.com', 'canadapost', 'omnisend.com', 'ecoenclose.com',
  'facebookmail.com', 'facebook.com', 'substack.com', 'findhealthclinics.com',
  'toggl.com', 'livechat.com', 'openai.com', 'rollo.com', 'google.com',
];

function isCustomerSender(fromHeader) {
  return !SKIP_DOMAINS.some(d => fromHeader.includes(d));
}

function decodeMimeWord(str) {
  return str.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, charset, encoding, text) => {
    if (encoding.toUpperCase() === 'Q') {
      return text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
    }
    if (encoding.toUpperCase() === 'B') {
      return Buffer.from(text, 'base64').toString('utf8');
    }
    return text;
  });
}

function decodeBody(payload, encoding) {
  if (!encoding) return payload;
  const enc = encoding.toLowerCase().trim();
  if (enc === 'quoted-printable') {
    const joined = payload.replace(/=\r?\n/g, '');
    // Collect consecutive =XX sequences as a byte array and decode as UTF-8
    return joined.replace(/((?:=[0-9A-F]{2})+)/gi, (match) => {
      const bytes = match.match(/=[0-9A-F]{2}/gi).map(m => parseInt(m.slice(1), 16));
      return Buffer.from(bytes).toString('utf8');
    });
  }
  if (enc === 'base64') {
    return Buffer.from(payload.replace(/\s/g, ''), 'base64').toString('utf8');
  }
  return payload;
}

function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parseMbox(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const messageBlocks = raw.split(/\nFrom /).filter(Boolean);
  const threads = {};

  for (const block of messageBlocks) {
    const lines = block.split('\n');
    const headers = {};
    let headerEnd = 0;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') { headerEnd = i; break; }
      const match = lines[i].match(/^([A-Za-z-]+):\s*(.*)/);
      if (match) {
        const key = match[1].toLowerCase();
        let value = match[2];
        while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
          value += ' ' + lines[++i].trim();
        }
        headers[key] = value;
      }
    }

    const from = headers['from'] || '';
    if (!isCustomerSender(from)) continue;

    const subject = decodeMimeWord(headers['subject'] || '(no subject)');
    const bodyLines = lines.slice(headerEnd + 1);
    const transferEncoding = headers['content-transfer-encoding'] || '';
    const rawBody = bodyLines.join('\n');
    const body = decodeBody(rawBody, transferEncoding)
      .split('\n')
      .filter(l => !l.startsWith('>') && !l.startsWith('On ') && l.trim() !== '--')
      .join('\n')
      .substring(0, 1000)
      .trim();

    if (!body) continue;

    const key = subject.replace(/^Re:\s*/i, '').trim();
    if (!threads[key]) threads[key] = { subject: key, messages: [] };
    threads[key].messages.push({ from, body });
  }

  return Object.values(threads).filter(t => t.messages.length > 0);
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

const MICRODOSING_RESEARCH = `
Microdosing: taking 5-10% of a standard psychoactive dose, typically 100-300mg dried psilocybin mushrooms.

Reported benefits (observational studies): reduced anxiety and depression, improved focus, increased creativity, heightened awareness, better sleep.

Fadiman Protocol: 1 day on, 2 days off for 4-8 weeks, then 2-4 week break. Prevents tolerance buildup.
Stamets Stack: 4 days on, 3 days off. Combines psilocybin + Lion's Mane + niacin. Repeat 4-6 weeks then 2-6 week break. Lion's Mane stimulates nerve growth factor (NGF) and may promote neurogenesis.

Onset for microdose: 30-60 min. Effects: uplifted mood, increased awareness, motivation, creativity.

Safety: research is primarily observational. Some users report increased anxiety or insomnia at higher microdoses. Always recommend consulting a healthcare provider, especially for those on medication.

Macrodosing tiers:
- 450mg-1g: mild-to-moderate visuals, sensory shifts
- 1-2g: potent visuals (fractals, patterns), strong mood shift
- 2-3g: profound sense of oneness, deep introspection
- 3g+: hero dose, requires trusted trip sitter
Effects onset: 30-90 min. Peak at 2-3 hours. Duration up to 6-8 hours.
`.trim();

async function synthesizeKB(threads, websiteText) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const threadSummary = threads.map((t, i) =>
    `--- THREAD ${i + 1}: ${t.subject} ---\n${t.messages.map(m => `FROM: ${m.from}\n${m.body}`).join('\n\n')}`
  ).join('\n\n').substring(0, 60000);

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `You are building a knowledge base for the Microgenix customer support AI agent.

Analyze the real customer email threads, website content, and research below. Write a comprehensive, well-structured knowledge base in markdown. Include:

- About Microgenix (mission, values, brand voice)
- Products (every product mentioned with doses, sizes, prices, use cases)
- Dosing Protocols (Fadiman, Stamets, macrodosing tiers in plain language)
- Shipping Policy (carriers, timelines, tracking behavior)
- Payment (methods, e-transfer process, currency)
- Returns and Satisfaction Guarantee
- Common Customer Questions (every real question pattern from the emails, with ideal answers in Willow's voice)
- Voice and Tone Examples (8-10 actual Willow reply excerpts verbatim showing the brand voice)
- Edge Cases (medical questions, upset customers, duplicate orders, out of stock, currency confusion)
- Business Context (Willow, carriers, affiliate program, first-time customer journey)

Voice requirements for answers: warm and genuine like a knowledgeable friend, short paragraphs, no bullet points in replies, active voice, American English, no em dashes, no semicolons, address customer by first name, end with one clear next step.

---
WEBSITE CONTENT:
${websiteText.substring(0, 4000)}

---
MICRODOSING AND MACRODOSING RESEARCH:
${MICRODOSING_RESEARCH}

---
CUSTOMER EMAIL THREADS:
${threadSummary}`,
    }],
  });

  return response.content.find(b => b.type === 'text')?.text || '';
}

async function main() {
  const mboxPath = process.argv[2];
  if (!mboxPath) {
    console.error('Usage: node scripts/seed-kb.js <path-to-mbox>');
    process.exit(1);
  }
  if (!fs.existsSync(mboxPath)) {
    console.error(`File not found: ${mboxPath}`);
    process.exit(1);
  }

  console.log('[seed-kb] Parsing mbox...');
  const threads = parseMbox(mboxPath);
  console.log(`[seed-kb] Found ${threads.length} customer threads`);

  console.log('[seed-kb] Fetching website...');
  let websiteText = '';
  try {
    const html = await fetchUrl('https://microgenix.net/our-story/');
    websiteText = stripHtml(html).substring(0, 6000);
  } catch (err) {
    console.warn('[seed-kb] Website fetch failed:', err.message, '— continuing without it');
  }

  console.log('[seed-kb] Synthesizing with Claude...');
  const kb = await synthesizeKB(threads, websiteText);

  if (!kb) {
    console.error('[seed-kb] Claude returned empty response');
    process.exit(1);
  }

  const oldSize = fs.existsSync(KB_PATH) ? fs.readFileSync(KB_PATH, 'utf8').length : 0;
  fs.writeFileSync(KB_PATH, kb, 'utf8');
  console.log(`[seed-kb] Done. KB updated: ${oldSize} → ${kb.length} chars`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[seed-kb] Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { isCustomerSender, decodeMimeWord, decodeBody, stripHtml, parseMbox };
