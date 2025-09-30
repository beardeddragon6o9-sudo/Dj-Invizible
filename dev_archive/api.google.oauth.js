export const config = { runtime: "nodejs" };

// Scopes: Calendar full access (same as your app used)
const SCOPE = "https://www.googleapis.com/auth/calendar";

function origin(req) {
  const h = process.env.VERCEL_URL || req.headers.host;
  return h && h.startsWith("http") ? h : `https://${h}`;
}

export default async function handler(req, res) {
  const client_id     = process.env.GOOGLE_CLIENT_ID;
  const client_secret = process.env.GOOGLE_CLIENT_SECRET;
  // Use env override if you already set it; else default to this route
  const redirect_uri  = process.env.GOOGLE_OAUTH_REDIRECT_URI || `${origin(req)}/api/google/oauth`;

  if (!client_id || !client_secret) {
    return res.status(500).json({ ok: false, error: "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET envs." });
  }

  // If we're coming back from consent with ?code=..., exchange it for tokens
  const code = req.query?.code;
  if (code) {
    try {
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type":"application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id,
          client_secret,
          redirect_uri
        })
      });
      const data = await r.json();
      // data should include: access_token, expires_in, refresh_token, token_type
      return res.status(200).json({
        ok: true,
        note: "Copy the refresh_token below into your Vercel env GOOGLE_REFRESH_TOKEN, save, and redeploy.",
        redirect_uri,
        received: data
      });
    } catch (e) {
      return res.status(500).json({ ok:false, error: e?.message || "token_exchange_failed" });
    }
  }

  // Otherwise, show a tiny HTML page with the consent link
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", client_id);
  auth.searchParams.set("redirect_uri", redirect_uri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", SCOPE);
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent"); // forces a new refresh_token

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
  <meta charset="utf-8">
  <title>Google OAuth for DJ Invizible</title>
  <style>body{font:14px/1.4 system-ui,Segoe UI,Arial;margin:2rem;max-width:720px}</style>
  <h1>Connect Google Calendar</h1>
  <p>This will request Calendar access and return a <code>refresh_token</code>.</p>
  <ol>
    <li>Click the button below and sign in with the calendar account you want.</li>
    <li>Accept the permissions, you will return here with a JSON payload.</li>
    <li>Copy <b>received.refresh_token</b> into Vercel → Environment Variables → <code>GOOGLE_REFRESH_TOKEN</code> (Production).</li>
    <li>Set <code>GOOGLE_CALENDAR_ID</code> = <b>primary</b> (recommended).</li>
    <li>Redeploy, then test <code>/api/availability</code>.</li>
  </ol>
  <p><a href="${auth.toString()}" style="display:inline-block;padding:.6rem 1rem;background:#111;color:#fff;border-radius:.5rem;text-decoration:none">Authorize with Google</a></p>
  <p><small>redirect_uri: <code>${redirect_uri}</code></small></p>`);
}
