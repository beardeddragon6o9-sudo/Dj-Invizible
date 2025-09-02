module.exports = async (req, res) => {
  try {
    const { google } = require("googleapis");
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

    const cal = google.calendar({ version: "v3", auth: oauth2 });

    const now = new Date();
    const end = new Date(now.getTime() + 60_000); // 1 minute window
    const calendarId = (req.query.calendarId || process.env.CALENDAR_ID || process.env.GOOGLE_CALENDAR_ID || "primary").trim();

    const fb = await cal.freebusy.query({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: end.toISOString(),
        items: [{ id: calendarId }]
      }
    });

    const busy = fb?.data?.calendars?.[calendarId]?.busy || [];
    return res.status(200).json({ ok: true, busyCount: busy.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
};
