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
    const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const calendarId = (req.query.calendarId || process.env.CALENDAR_ID || process.env.GOOGLE_CALENDAR_ID || "primary").trim();

    const resp = await cal.events.list({
      calendarId,
      privateExtendedProperty: "hold=true",
      singleEvents: true,
      orderBy: "startTime",
      timeMin: now.toISOString(),
      timeMax: in30d.toISOString(),
      maxResults: 250
    });

    const items = resp?.data?.items || [];
    return res.status(200).json({ ok: true, found: items.length, sample: items.slice(0, 3).map(e => ({ id: e.id, summary: e.summary })) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
};
