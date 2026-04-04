'use strict';

const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

const credsFile = process.argv[2];
if (!credsFile) {
  console.error('Usage: node scripts/get-gmail-token.js /path/to/client_secret.json');
  process.exit(1);
}

const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
const { client_id, client_secret } = creds.installed || creds.web;

const oauth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  'http://localhost:3333/callback'
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Opening browser for Google authorization...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('If the browser does not open, paste this URL manually:\n');
console.log(authUrl);
console.log('');

// Try to open browser
const { exec } = require('child_process');
exec('open "' + authUrl + '"');

// Local server to catch the OAuth callback
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname !== '/callback') {
    res.end('Not found');
    return;
  }

  const code = parsed.query.code;
  if (!code) {
    res.end('No code received. Please try again.');
    server.close();
    return;
  }

  res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Success!</h2><p>You can close this tab and return to the terminal.</p></body></html>');

  try {
    const { tokens } = await oauth2Client.getToken(code);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SUCCESS! Add these to Railway environment variables:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('GMAIL_CLIENT_ID=' + client_id);
    console.log('GMAIL_CLIENT_SECRET=' + client_secret);
    console.log('GMAIL_REFRESH_TOKEN=' + tokens.refresh_token);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } catch (err) {
    console.error('Failed to get token:', err.message);
  }

  server.close();
});

server.listen(3333, () => {
  console.log('Waiting for Google to redirect back... (listening on port 3333)');
});
