// /api/sweep.js  (or /api/holds/sweep.js)
// Auto-confirms holds when attendee accepted; deletes expired holds.
// Accepts Vercel cron (x-vercel-cron header) OR manual calls with ?secret=.../x-sweep-secret.
// Options: dryRun=1, sendUpdates=all|none (default all), calendarId=..., limit=1000

const { google } = require('googleapis');

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_REFRESH_TOKEN,
  CALENDAR_ID,
  GOOGLE_CALENDAR_ID,
  HOLD_TTL_MINUTES,
} = process.env;

const DEFAULT_CALENDAR_ID = CALENDAR_ID || GOOGLE_CALENDAR_ID;


function bad(res, msg, code = 400, extra = {}) {
  res.status(code).json({ ok: false, error: msg, ...extra });
}
function ok(res, data = {}) {
  res.status(200).json({ ok: true, ...data });
}

function buildOAuth2() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing Google OAuth env vars.');
  }
  const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

async function listHoldEvents(cal, { calendarId, pageToken, timeMin }) {
  return cal.events.list({
    calendarId,
    privateExtendedProperty: 'hold=true',
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 2500,
    timeMin, // scan from recent past
    pageToken,
  });
}

function anyAttendeeAccepted(attendees = []) {
  return attendees.some(a => a && a.email && a.responseStatus === 'accepted');
}

function stripHoldProps(extPriv = {}) {
  const copy = { ...extPriv };
  delete copy.hold;
  delete copy.holdId;
  delete copy.autoCancelAt;
  return copy;
}

module.exports = async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return bad(res, 'Method not allowed', 405);
  }

  // Allow Vercel cron without secret; require secret for manual calls
  const isVercelCron = !!req.headers['x-vercel-cron'];
  const secret =
    (req.query.secret && String(req.query.secret)) ||
    req.headers['x-sweep-secret'];

  if (!isVercelCron) {
    if (!SWEEP_SECRET || secret !== SWEEP_SECRET) {
      return bad(res, 'Unauthorized', 401);
    }
  }

  const calendarId = (req.query.calendarId || DEFAULT_CALENDAR_ID || 'primary').trim();
  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
  const sendUpdates = (req.query.sendUpdates || 'all'); // 'all' or 'none'
  const limit = Math.max(1, Math.min(10000, Number(req.query.limit || '1000')));

  const now = new Date();
  const nowISO = now.toISOString();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(); // 24h back

  let oauth2;
  try {
    oauth2 = buildOAuth2();
  } catch (e) {
    return bad(res, e.message, 500);
  }
  const cal = google.calendar({ version: 'v3', auth: oauth2 });

  let pageToken;
  let examined = 0;
  let deleted = 0;
  let confirmed = 0;
  let wouldDelete = 0;
  let wouldConfirm = 0;
  const deletedIds = [];
  const confirmedIds = [];
  const wouldDeleteIds = [];
  const wouldConfirmIds = [];

  try {
    while (true) {
      const resp = await listHoldEvents(cal, { calendarId, pageToken, timeMin: since });
      const events = resp?.data?.items || [];

      for (const ev of events) {
        if (examined >= limit) break;
        examined += 1;

        const priv = ev.extendedProperties?.private || {};
        const autoCancelAt = priv.autoCancelAt;
        const attendees = ev.attendees || [];
        const expiresAt = autoCancelAt ? new Date(autoCancelAt) : null;
        const accepted = anyAttendeeAccepted(attendees);

        // 1) Auto-confirm if accepted
        if (accepted) {
          if (dryRun) {
            wouldConfirm += 1;
            wouldConfirmIds.push(ev.id);
          } else {
            const newPriv = {
              ...stripHoldProps(priv),
              confirmedFromHold: 'true',
              confirmedAt: nowISO,
            };
            await cal.events.patch({
              calendarId,
              eventId: ev.id,
              sendUpdates, // 'all' to notify, 'none' to stay silent
              requestBody: {
                status: 'confirmed',
                extendedProperties: { private: newPriv },
                // (Optional) turn on default reminders once confirmed:
                reminders: { useDefault: true },
                // (Optional) clean up summary:
                summary: ev.summary?.replace(/^HOLD:\s*/i, '').trim() || ev.summary,
              },
            });
            confirmed += 1;
            confirmedIds.push(ev.id);
          }
          continue; // no further processing
        }

        // 2) Delete if expired
        if (expiresAt && !isNaN(expiresAt.getTime()) && expiresAt <= now) {
          if (dryRun) {
            wouldDelete += 1;
            wouldDeleteIds.push(ev.id);
          } else {
            try {
              await cal.events.delete({ calendarId, eventId: ev.id, sendUpdates: 'none' });
              deleted += 1;
              deletedIds.push(ev.id);
            } catch (e) {
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
      sendUpdates,
      limit,
      examined,
      confirmed,
      deleted,
      wouldConfirm,
      wouldDelete,
      confirmedIds,
      deletedIds,
      wouldConfirmIds,
      wouldDeleteIds,
    });
  } catch (err) {
    const msg = err?.message || 'Unknown error';
    return bad(res, msg, 500, { details: process.env.NODE_ENV !== 'production' ? err : undefined });
  }
};
// /api/sweep.js  (wrap your existing code)
module.exports = async (req, res) => {
  try {
    // ... your existing sweeper logic ...
  } catch (err) {
    console.error('[sweep] crash:', err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
};
