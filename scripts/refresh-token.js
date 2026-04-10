'use strict';

const { google } = require('googleapis');
const http = require('http');
const url = require('url');

require('dotenv').config();

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env first');
  process.exit(1);
}

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  'http://localhost:3333/callback'
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
});

console.log('\nOpening browser for Google authorization...\n');
console.log('If the browser does not open, paste this URL manually:\n');
console.log(authUrl);
console.log('');

const { exec } = require('child_process');
exec('open "' + authUrl + '"');

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname !== '/callback') { res.end('Not found'); return; }

  const code = parsed.query.code;
  if (!code) { res.end('No code received.'); server.close(); return; }

  res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Success!</h2><p>You can close this tab.</p></body></html>');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\n=== NEW REFRESH TOKEN ===\n');
    console.log(tokens.refresh_token);
    console.log('\n=========================\n');
  } catch (err) {
    console.error('Failed:', err.message);
  }
  server.close();
});

server.listen(3333, () => {
  console.log('Waiting for Google redirect on port 3333...');
});
