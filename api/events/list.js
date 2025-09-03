import { google } from "googleapis";

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

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow","GET");
      return bad(res,"Method not allowed",405);
    }
    const {
      calendarId: calQ, sinceDays: sQ, horizonDays: hQ,
      includeCancelled: incQ
    } = req.query || {};
    const calendarId = (calQ || process.env.CALENDAR_ID || process.env.GOOGLE_CALENDAR_ID || "primary").trim();
    const sinceDays = Math.max(0, Number(sQ || "1"));
    const horizonDays = Math.max(1, Number(hQ || "7"));
    const includeCancelled = incQ === "1" || incQ === "true";

    const now = new Date();
    const timeMin = new Date(now.getTime() - sinceDays*24*60*60*1000);
    const timeMax = new Date(now.getTime() + horizonDays*24*60*60*1000);

    const auth = buildOAuth2();
    const cal = google.calendar({ version: "v3", auth });

    let pageToken, items = [];
    do {
      const resp = await cal.events.list({
        calendarId,
        singleEvents: true,
        orderBy: "startTime",
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: 250,
        pageToken
      });
      const chunk = (resp.data.items || []).filter(ev => includeCancelled || ev.status !== "cancelled");
      items = items.concat(chunk);
      pageToken = resp.data.nextPageToken;
    } while (pageToken);

    const events = items.map(ev => ({
      id: ev.id,
      summary: ev.summary,
      status: ev.status,
      start: ev.start,
      end: ev.end,
      private: ev.extendedProperties?.private || null
    }));

    return ok(res, {
      calendarId,
      sinceDays, horizonDays,
      count: events.length,
      events
    });
  } catch (err) {
    return bad(res, err?.message || "Unknown error", 500);
  }
}
