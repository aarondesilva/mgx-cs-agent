'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const Anthropic = require('@anthropic-ai/sdk').default;

const KB_PATH = path.join(__dirname, '../data/knowledge-base.md');

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

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function extractKBContent(url, pageText) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are updating the knowledge base for the Microgenix customer support AI agent.

Extract anything relevant to Microgenix customer support from the page below. This includes product details (name, dose, size, price, ingredients, use case), protocols or usage guidance, policies (shipping, returns, payment), FAQs, or brand information.

Write only what is relevant. If nothing on this page is relevant to Microgenix customer support, respond with exactly: NOT_RELEVANT

Page URL: ${url}

Page content:
${pageText.substring(0, 8000)}`,
    }],
  });

  return response.content.find(b => b.type === 'text')?.text || '';
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node scripts/ingest-url.js <url>');
    process.exit(1);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    console.error('Invalid URL:', url);
    process.exit(1);
  }

  console.log(`[ingest-url] Fetching ${url}...`);
  let html;
  try {
    html = await fetchUrl(url);
  } catch (err) {
    console.error('[ingest-url] Fetch failed:', err.message);
    process.exit(1);
  }

  const pageText = stripHtml(html);
  console.log(`[ingest-url] Fetched ${pageText.length} chars. Extracting with Claude...`);

  const extracted = await extractKBContent(url, pageText);

  if (extracted.trim() === 'NOT_RELEVANT') {
    console.log('[ingest-url] Nothing relevant found. KB unchanged.');
    return;
  }

  const date = new Date().toISOString().split('T')[0];
  const section = `\n\n## Ingested: ${parsedUrl.hostname} — ${date}\n\n${extracted.trim()}\n`;

  fs.appendFileSync(KB_PATH, section, 'utf8');
  console.log(`[ingest-url] Appended ${section.length} chars to knowledge-base.md`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[ingest-url] Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { stripHtml, extractKBContent };
