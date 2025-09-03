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

function asISO(v){ const d=new Date(v); return isNaN(d.getTime())?null:d.toISOString(); }

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow","POST");
      return bad(res,"Method not allowed",405);
    }

    const { calendarId: calFromReq, start, end, timeZone="America/Vancouver", ttlMinutes=1, name="Test Hold (min)" } = req.body || {};
    const calendarId = (calFromReq || process.env.CALENDAR_ID || process.env.GOOGLE_CALENDAR_ID || "primary").trim();

    const startISO = asISO(start);
    const endISO   = asISO(end);
    if (!startISO || !endISO) return bad(res,"`start` and `end` are required.");

    const expiresAt = new Date(Date.now() + Number(ttlMinutes)*60_000);

    // IMPORTANT: no requestBody.id → let Google generate a valid event id
    const requestBody = {
      summary: `HOLD: ${name}`,
      description: `Auto-cancel at: ${expiresAt.toISOString()}`,
      start: { dateTime: startISO, timeZone },
      end:   { dateTime: endISO,   timeZone },
      status: "tentative",
      extendedProperties: { private: { hold: "true", autoCancelAt: expiresAt.toISOString(), createdAt: new Date().toISOString() } },
      reminders: { useDefault: false },
    };

    const auth = buildOAuth2();
    const cal  = google.calendar({ version: "v3", auth });
    const resp = await cal.events.insert({ calendarId, requestBody, sendUpdates: "none" });

    const ev = resp.data;
    return ok(res, { hold: { id: ev.id, calendarId, htmlLink: ev.htmlLink, start: ev.start, end: ev.end, status: ev.status, expiresAt: expiresAt.toISOString() }});
  } catch (err) {
    // Make errors visible so we stop guessing
    return bad(res, err?.message || String(err), 500, {
      diag: {
        hasClientId: !!process.env.GOOGLE_CLIENT_ID,
        hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
        hasRedirectUri: !!process.env.GOOGLE_REDIRECT_URI,
        hasRefreshToken: !!process.env.GOOGLE_REFRESH_TOKEN
      }
    });
  }
};
