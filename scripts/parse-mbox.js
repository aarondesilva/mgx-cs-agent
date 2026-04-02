'use strict';

/**
 * parse-mbox.js
 *
 * Parses a Mac Mail .mbox export into clean conversation threads.
 * Outputs a single text file you can review and paste into data/knowledge-base.md.
 *
 * Usage:
 *   node scripts/parse-mbox.js /path/to/export.mbox/mbox
 *   node scripts/parse-mbox.js /path/to/export.mbox/mbox --output scripts/threads.txt
 */

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const outputFlag = process.argv.indexOf('--output');
const outputPath = outputFlag !== -1
  ? process.argv[outputFlag + 1]
  : path.join(__dirname, 'threads.txt');

if (!inputPath) {
  console.error('Usage: node scripts/parse-mbox.js /path/to/mbox [--output output.txt]');
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

// ─── MIME helpers ────────────────────────────────────────────────────────────

function decodeQuotedPrintable(str) {
  return str
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeBase64(str) {
  try {
    return Buffer.from(str.replace(/\s/g, ''), 'base64').toString('utf8');
  } catch {
    return str;
  }
}

function decodeEncodedWord(str) {
  // Decode =?UTF-8?Q?...?= and =?UTF-8?B?...?= in headers
  return str.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_, charset, encoding, encoded) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        return Buffer.from(encoded, 'base64').toString('utf8');
      } else {
        return decodeQuotedPrintable(encoded.replace(/_/g, ' '));
      }
    } catch {
      return encoded;
    }
  });
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function cleanBody(text) {
  const lines = text.split('\n');
  const cleaned = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip quoted reply lines ("> text")
    if (trimmed.startsWith('>')) continue;

    // Stop at signature markers
    if (trimmed === '--' || trimmed === '-- ' || trimmed === '___' ||
        trimmed.match(/^-{3,}$/) || trimmed.match(/^_{3,}$/)) break;

    // Skip common email footer noise
    if (trimmed.match(/^(Get Outlook|Sent from my|Sent via|This email|Confidential|CONFIDENTIAL)/i)) break;

    cleaned.push(line);
  }

  return cleaned
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Header parser ────────────────────────────────────────────────────────────

function parseHeaders(headerBlock) {
  const headers = {};
  const lines = headerBlock.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Unfold multi-line headers
  const unfolded = lines.replace(/\n[ \t]+/g, ' ');

  for (const line of unfolded.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const val = decodeEncodedWord(line.slice(colon + 1).trim());
    if (!headers[key]) headers[key] = val;
  }

  return headers;
}

function extractAddress(str) {
  if (!str) return '';
  const match = str.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : str.toLowerCase().trim();
}

function extractName(str) {
  if (!str) return '';
  const match = str.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  const angle = str.match(/<([^>]+)>/);
  if (angle) return '';
  return str.trim();
}

// ─── MIME body extractor ──────────────────────────────────────────────────────

function extractTextBody(rawBody, contentType, contentTransferEncoding) {
  const ct = (contentType || '').toLowerCase();
  const cte = (contentTransferEncoding || '').toLowerCase().trim();

  let decoded = rawBody;
  if (cte === 'quoted-printable') {
    decoded = decodeQuotedPrintable(rawBody);
  } else if (cte === 'base64') {
    decoded = decodeBase64(rawBody);
  }

  if (ct.includes('text/html')) {
    return stripHtml(decoded);
  }

  return decoded;
}

function parseMimePart(raw) {
  const separator = raw.match(/\r?\n\r?\n/);
  if (!separator) return { headers: {}, body: raw };

  const splitAt = raw.indexOf(separator[0]);
  const headerBlock = raw.slice(0, splitAt);
  const body = raw.slice(splitAt + separator[0].length);
  const headers = parseHeaders(headerBlock);

  return { headers, body };
}

function extractBody(raw, headers) {
  const ct = headers['content-type'] || 'text/plain';
  const cte = headers['content-transfer-encoding'] || '';

  // Multipart — find the best text part
  const boundaryMatch = ct.match(/boundary="?([^";]+)"?/i);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = raw.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?`));

    let plainText = null;
    let htmlText = null;

    for (const part of parts) {
      if (!part.trim() || part.trim() === '--') continue;
      const parsed = parseMimePart(part);
      const partCt = (parsed.headers['content-type'] || '').toLowerCase();

      if (partCt.includes('multipart/')) {
        const nested = extractBody(parsed.body, parsed.headers);
        if (nested) { plainText = plainText || nested; }
      } else if (partCt.includes('text/plain') && !plainText) {
        plainText = extractTextBody(parsed.body, partCt, parsed.headers['content-transfer-encoding']);
      } else if (partCt.includes('text/html') && !htmlText) {
        htmlText = extractTextBody(parsed.body, partCt, parsed.headers['content-transfer-encoding']);
      }
    }

    return plainText || htmlText || '';
  }

  // Single part
  return extractTextBody(raw, ct, cte);
}

// ─── mbox splitter ────────────────────────────────────────────────────────────

function splitMbox(content) {
  // mbox messages start with "From " at the beginning of a line
  const messages = [];
  const lines = content.split('\n');
  let current = [];

  for (const line of lines) {
    if (line.match(/^From \S+ /) && current.length > 0) {
      messages.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) messages.push(current.join('\n'));
  return messages.filter(m => m.trim().length > 0);
}

// ─── Thread grouping ──────────────────────────────────────────────────────────

function normalizeSubject(subject) {
  return (subject || '')
    .replace(/^(re|fwd|fw|aw|sv):\s*/gi, '')
    .trim()
    .toLowerCase();
}

function groupIntoThreads(emails) {
  const threads = new Map();
  const idToThread = new Map();

  for (const email of emails) {
    const msgId = email.messageId;
    const inReplyTo = email.inReplyTo;
    const refs = email.references ? email.references.split(/\s+/).filter(Boolean) : [];

    // Find existing thread via In-Reply-To or References
    let threadId = null;

    if (inReplyTo && idToThread.has(inReplyTo)) {
      threadId = idToThread.get(inReplyTo);
    }
    if (!threadId) {
      for (const ref of refs) {
        if (idToThread.has(ref)) {
          threadId = idToThread.get(ref);
          break;
        }
      }
    }

    // Fall back to normalized subject matching
    if (!threadId) {
      const normSubject = normalizeSubject(email.subject);
      if (normSubject) {
        for (const [tid, thread] of threads) {
          if (normalizeSubject(thread[0].subject) === normSubject) {
            threadId = tid;
            break;
          }
        }
      }
    }

    if (!threadId) {
      threadId = msgId || `thread_${threads.size}`;
      threads.set(threadId, []);
    }

    threads.get(threadId).push(email);
    if (msgId) idToThread.set(msgId, threadId);
  }

  return Array.from(threads.values());
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const SUPPORT_EMAILS = ['support@microgenix.com'];

function isSupportSide(address) {
  return SUPPORT_EMAILS.some(e => address.includes(e)) ||
    address.includes('microgenix');
}

function parseEmail(raw) {
  const firstNewline = raw.indexOf('\n');
  const fromLine = raw.slice(0, firstNewline);
  const rest = raw.slice(firstNewline + 1);

  const { headers, body } = parseMimePart(rest);

  const from = headers['from'] || '';
  const to = headers['to'] || '';
  const subject = decodeEncodedWord(headers['subject'] || '(no subject)');
  const date = headers['date'] || '';
  const messageId = (headers['message-id'] || '').replace(/[<>]/g, '').trim();
  const inReplyTo = (headers['in-reply-to'] || '').replace(/[<>]/g, '').trim();
  const references = headers['references'] || '';

  const text = cleanBody(extractBody(body, headers));

  return {
    from,
    fromAddress: extractAddress(from),
    fromName: extractName(from),
    to,
    subject,
    date: date ? new Date(date) : new Date(0),
    messageId,
    inReplyTo,
    references,
    body: text,
  };
}

console.log(`Reading: ${inputPath}`);
const raw = fs.readFileSync(inputPath, 'utf8');

console.log('Splitting into messages...');
const rawMessages = splitMbox(raw);
console.log(`Found ${rawMessages.length} messages`);

console.log('Parsing messages...');
const emails = rawMessages
  .map(m => { try { return parseEmail(m); } catch { return null; } })
  .filter(Boolean)
  .filter(e => e.body.length > 10)
  .sort((a, b) => a.date - b.date);

console.log(`Parsed ${emails.length} valid messages`);

console.log('Grouping into threads...');
const threads = groupIntoThreads(emails);
console.log(`Found ${threads.length} threads`);

// Sort threads by date of first message
threads.sort((a, b) => a[0].date - b[0].date);

// Sort emails within each thread chronologically
for (const thread of threads) {
  thread.sort((a, b) => a.date - b.date);
}

// ─── Output ───────────────────────────────────────────────────────────────────

const output = [];

output.push('# MGX Email Threads Export');
output.push(`# Generated: ${new Date().toISOString()}`);
output.push(`# Total threads: ${threads.length}`);
output.push('');
output.push('# HOW TO USE:');
output.push('# 1. Review each thread below');
output.push('# 2. Find threads where the support replies were excellent');
output.push('# 3. Copy those threads into data/knowledge-base.md under "## Example Replies"');
output.push('# 4. Delete or ignore the rest');
output.push('');
output.push('='.repeat(80));
output.push('');

for (let i = 0; i < threads.length; i++) {
  const thread = threads[i];
  const subject = thread[0].subject;
  const dateStr = thread[0].date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  output.push(`THREAD ${i + 1} of ${threads.length}`);
  output.push(`Subject: ${subject}`);
  output.push(`Date: ${dateStr}`);
  output.push(`Messages: ${thread.length}`);
  output.push('-'.repeat(60));
  output.push('');

  for (const email of thread) {
    const side = isSupportSide(email.fromAddress) ? 'MICROGENIX' : 'CUSTOMER';
    const name = email.fromName || email.fromAddress;

    output.push(`[${side}] ${name}`);

    if (email.body) {
      const bodyLines = email.body.split('\n').slice(0, 30); // cap at 30 lines per message
      output.push(bodyLines.join('\n'));
      if (email.body.split('\n').length > 30) {
        output.push('  [... message truncated ...]');
      }
    } else {
      output.push('  [no text content]');
    }

    output.push('');
  }

  output.push('='.repeat(80));
  output.push('');
}

fs.writeFileSync(outputPath, output.join('\n'), 'utf8');

console.log(`\nDone. Output written to: ${outputPath}`);
console.log(`\nNext steps:`);
console.log(`  1. Open ${outputPath} in any text editor`);
console.log(`  2. Find threads with great support replies`);
console.log(`  3. Copy those into data/knowledge-base.md under "## Example Replies"`);
