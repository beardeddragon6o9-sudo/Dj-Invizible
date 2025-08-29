import 'dotenv/config';
import express from 'express';
import open from 'open';

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI = 'http://localhost:5178/oauth2callback',
  SCOPES = 'https://www.googleapis.com/auth/calendar',
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
  process.exit(1);
}

const app = express();
const port = new URL(REDIRECT_URI).port || 5178;

function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',         // <— ensures refresh_token is issued
    prompt: 'consent',              // <— force consent so we get refresh_token
    scope: SCOPES,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const params = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Token exchange failed: ${r.status} ${err}`);
  }
  return r.json();
}

app.get('/oauth2callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    console.error('OAuth error:', error);
    return res.status(400).send(`OAuth error: ${error}`);
  }
  if (!code) return res.status(400).send('Missing ?code');

  try {
    const tokens = await exchangeCodeForTokens(code);
    const { access_token, refresh_token, expires_in, token_type } = tokens;

    console.log('\n✅ Success! Save this REFRESH TOKEN for your server:\n');
    console.log('REFRESH TOKEN:\n', refresh_token, '\n');
    console.log('Other details (for reference):', { access_token, expires_in, token_type });

    res.send(`<pre>✅ Success!
Copy this REFRESH TOKEN and add it to Vercel as GOOGLE_REFRESH_TOKEN:

${refresh_token}

You can close this window.</pre>`);

    // Close server after a short delay
    setTimeout(() => process.exit(0), 1000);
  } catch (e) {
    console.error(e);
    res.status(500).send(String(e));
  }
});

app.listen(port, () => {
  const url = buildAuthUrl();
  console.log(`\nStarting local OAuth helper on ${REDIRECT_URI}`);
  console.log('Opening browser for Google consent…\n');
  open(url);
});
