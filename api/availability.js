import { google } from "googleapis";

function bad(res, msg, code=400, extra={}) { return res.status(code).json({ ok:false, error: msg, ...extra }); }
function ok(res, data={}) { return res.status(200).json({ ok:true, ...data }); }

function buildOAuth2() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !GOOGLE_REFRESH_TOKEN) {
    throw new Error("Missing Google OAuth env vars.");
  }
  const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

export default async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow","POST");
      return bad(res, "method_not_allowed", 405);
    }

    const { start, end, timeZone="America/Vancouver", calendarId } = req.body || {};
    if (!start || !end) return bad(res, "Missing start or end date.");

    const calId = (calendarId || process.env.CALENDAR_ID || process.env.GOOGLE_CALENDAR_ID || "primary").trim();

    const auth = buildOAuth2();
    const cal = google.calendar({ version: "v3", auth });
    const fb = await cal.freebusy.query({
      requestBody: {
        timeMin: new Date(start).toISOString(),
        timeMax: new Date(end).toISOString(),
        timeZone,
        items: [{ id: calId }]
      }
    });

    const busy = fb?.data?.calendars?.[calId]?.busy || [];
    return ok(res, { calendarId: calId, timeZone, busy, available: busy.length === 0 });
  } catch (err) {
    return bad(res, err?.message || "Unknown error", 500);
  }
};


