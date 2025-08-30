// /api/availability.js
export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const { start, end } = req.body || {};
    if (!start || !end) {
      return res.status(400).json({ ok: false, message: "Missing start or end date." });
    }

    // Get short-lived Google access token
    const accessToken = await getGoogleAccessToken();

    const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";

    // Call Google Calendar FreeBusy API
    const r = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: new Date(start).toISOString(),
        timeMax: new Date(end).toISOString(),
        items: [{ id: calendarId }],
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      console.error("[availability] Google API error:", data);
      return res.status(500).json({
        ok: false,
        message: "Failed to fetch calendar availability.",
        details: data,
      });
    }

    const busySlots = data.calendars[calendarId]?.busy || [];
    const isAvailable = busySlots.length === 0;

    return res.status(200).json({
      ok: true,
      calendarId,
      available: isAvailable,
      busySlots,
    });
  } catch (err) {
    console.error("[availability] Server error:", err);
    return res.status(500).json({
      ok: false,
      message: "Internal server error.",
    });
  }
}

async function getGoogleAccessToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  const data = await r.json();
  if (!r.ok) {
    console.error("[google-access] Failed to get token:", data);
    throw new Error(data.error || "Failed to fetch Google access token");
  }

  return data.access_token;
}
