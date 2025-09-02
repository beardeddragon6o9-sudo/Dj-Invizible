// /api/holds/sweep.js
// Deletes expired "hold" events where extendedProperties.private.autoCancelAt < now
// Invoke with a shared secret: /api/holds/sweep?secret=YOUR_SECRET
// Options: dryRun=1, calendarId=..., limit=500

const { google } = require('googleapis');

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_REFRESH_TOKEN,
  CALENDAR_ID: DEFAULT_CALENDAR_ID,
  SWEEP_SECRET, // set this in your env (e.g., Vercel Project Settings)
} = process.env;

function bad(res, msg, code = 400, extra = {}) {
  res.status(code).json({ ok: false, error: msg, ...extra });
}
function ok(res, data = {}) {
  res.status(200).json({ ok: true, ...data });
}

function buildOAuth2() {
  if (
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_CLIENT_SECRET ||
    !GOOGLE_REDIRECT_URI ||
    !GOOGLE_REFRESH_TOKEN
  ) {
    throw new Error('Missing Google OAuth env vars.');
  }
  const oauth2 = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

async function listHoldEvents(cal, { calendarId, pageToken, timeMin }) {
  // Filter by private extended property "hold=true" right in the query.
  // We'll further filter by autoCancelAt client-side.
  return cal.events.list({
    calendarId,
    privateExtendedProperty: 'hold=true',
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 2500,
    timeMin, // only need future (or near-past) events
    pageToken,
  });
}

module.exports = async (req, res) => {
  // Method guard
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return bad(res, 'Method not allowed', 405);
  }

  // Secret check (query or header)
 // If called by Vercel cron, allow without secret.
// Otherwise, require the secret for manual calls.
const vercelCronHeader = req.headers['x-vercel-cron'];
const secret =
  (req.query.secret && String(req.query.secret)) ||
  req.headers['x-sweep-secret'];

if (!vercelCronHeader) {
  if (!SWEEP_SECRET || secret !== SWEEP_SECRET) {
    return bad(res, 'Unauthorized', 401);
  }
}


  // Options
  const calendarId = (req.query.calendarId || DEFAULT_CALENDAR_ID || 'primary').trim();
  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
  const limit = Math.max(1, Math.min(10000, Number(req.query.limit || '1000')));

  const now = new Date();
  const nowISO = now.toISOString();

  // Look from a short recent past to catch any stragglers
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  let oauth2;
  try {
    oauth2 = buildOAuth2();
  } catch (e) {
    return bad(res, e.message, 500);
  }

  const cal = google.calendar({ version: 'v3', auth: oauth2 });

  let pageToken = undefined;
  let examined = 0;
  let deleted = 0;
  let wouldDelete = 0;
  const deletedIds = [];
  const wouldDeleteIds = [];

  try {
    while (true) {
      const resp = await listHoldEvents(cal, { calendarId, pageToken, timeMin: since });
      const events = resp?.data?.items || [];

      for (const ev of events) {
        if (examined >= limit) break;

        examined += 1;
        const priv = ev.extendedProperties?.private || {};
        const autoCancelAt = priv.autoCancelAt;

        if (!autoCancelAt) continue;

        const expiresAt = new Date(autoCancelAt);
        if (isNaN(expiresAt.getTime())) continue;

        if (expiresAt <= now) {
          if (dryRun) {
            wouldDelete += 1;
            wouldDeleteIds.push(ev.id);
          } else {
            try {
              await cal.events.delete({
                calendarId,
                eventId: ev.id,
                sendUpdates: 'none',
              });
              deleted += 1;
              deletedIds.push(ev.id);
            } catch (e) {
              // If already gone, ignore; otherwise bubble up
              if (e?.code !== 404) throw e;
            }
          }
        }
      }

      if (examined >= limit) break;
      pageToken = resp?.data?.nextPageToken;
      if (!pageToken) break;
    }

    return ok(res, {
      calendarId,
      now: nowISO,
      dryRun,
      limit,
      examined,
      deleted,
      wouldDelete,
      deletedIds,
      wouldDeleteIds,
    });
  } catch (err) {
    const msg = err?.message || 'Unknown error';
    return bad(res, msg, 500, { details: process.env.NODE_ENV !== 'production' ? err : undefined });
  }
};
