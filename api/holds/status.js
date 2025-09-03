const { google } = require("googleapis");

function ok(res, data={}) { return res.status(200).json({ ok:true, ...data }); }
function bad(res, msg, code=400, extra={}) { return res.status(code).json({ ok:false, error:msg, ...extra }); }

function buildOAuth2() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !GOOGLE_REFRESH_TOKEN) {
    throw new Error("Missing Google OAuth env vars.");
  }
  const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow","GET");
      return bad(res,"Method not allowed",405);
    }

    const {
      calendarId: calFromReq,
      limit: limitQ, sinceDays: sinceQ, horizonDays: horizonQ,
      includeCancelled: incCancelQ, includeExpired: incExpiredQ
    } = req.query || {};

    const calendarId = (calFromReq || process.env.CALENDAR_ID || process.env.GOOGLE_CALENDAR_ID || "primary").trim();
    const limit = Math.max(1, Math.min(5000, Number(limitQ || "200")));
    const sinceDays = Math.max(0, Number(sinceQ || "1"));      // look back 24h by default
    const horizonDays = Math.max(1, Number(horizonQ || "60")); // look ahead 60d
    const includeCancelled = incCancelQ === "1" || incCancelQ === "true";
    const includeExpired = incExpiredQ === "1" || incExpiredQ === "true";

    const now = new Date();
    const timeMin = new Date(now.getTime() - sinceDays * 24*60*60*1000);
    const timeMax = new Date(now.getTime() + horizonDays * 24*60*60*1000);

    const auth = buildOAuth2();
    const cal = google.calendar({ version: "v3", auth });

    let pageToken, examined = 0;
    const results = [];

    do {
      const resp = await cal.events.list({
        calendarId,
        privateExtendedProperty: "hold=true",
        singleEvents: true,
        orderBy: "startTime",
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: 500,
        pageToken
      });

      const items = resp?.data?.items || [];
      for (const ev of items) {
        if (results.length >= limit) break;

        const priv = ev.extendedProperties?.private || {};
        const autoCancelAtISO = priv.autoCancelAt;
        const autoCancelAt = autoCancelAtISO ? new Date(autoCancelAtISO) : null;
        const expired = autoCancelAt && autoCancelAt <= now;
        const cancelled = ev.status === "cancelled";
        const accepted = (ev.attendees || []).some(a => a?.responseStatus === "accepted");

        if (!includeCancelled && cancelled) continue;
        if (!includeExpired && expired) continue;

        results.push({
          id: ev.id,
          summary: ev.summary,
          status: ev.status,
          start: ev.start,
          end: ev.end,
          private: {
            hold: priv.hold,
            holdId: priv.holdId,
            autoCancelAt: autoCancelAtISO,
            confirmedFromHold: priv.confirmedFromHold
          },
          attendeesAccepted: accepted,
          expiresInMinutes: autoCancelAt ? Math.round((autoCancelAt - now)/60000) : null
        });
      }

      if (results.length >= limit) break;
      pageToken = resp?.data?.nextPageToken;
    } while (pageToken);

    return ok(res, {
      calendarId,
      now: now.toISOString(),
      sinceDays,
      horizonDays,
      limit,
      count: results.length,
      holds: results
    });
  } catch (err) {
    return bad(res, err?.message || "Unknown error", 500);
  }
};
