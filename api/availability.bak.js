// /api/availability.js
export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  // Parse JSON safely (some runtimes give body as string)
  let body = req.body;
  try {
    if (typeof body === "string") body = JSON.parse(body || "{}");
  } catch (e) {
    return res.status(400).json({ ok: false, message: "Invalid JSON body." });
  }

  const { start, end, calendarId: overrideCalId, debug } = body || {};
  if (!start || !end) {
    return res.status(400).json({ ok: false, message: "Missing start or end date." });
  }

  const calendarId = overrideCalId || process.env.GOOGLE_CALENDAR_ID || "primary";

  try {
    const accessToken = await getGoogleAccessToken();

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

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      console.error("[availability] Google API error:", data);
      return res.status(200).json({
        ok: false,
        message: "Failed to fetch calendar availability.",
        details: debug ? data : undefined,
        status: r.status,
      });
    }

    // Some responses key by the exact ID you sent:
    const calKey = data?.calendars?.[calendarId]
      ? calendarId
      : Object.keys(data?.calendars || {})[0];

    const busySlots = (data?.calendars?.[calKey]?.busy) || [];
    const isAvailable = busySlots.length === 0;

    return res.status(200).json({
      ok: true,
      calendarId: calKey || calendarId,
      available: isAvailable,
      busySlots,
    });
  } catch (err) {
    console.error("[availability] Server error:", err);
    return res.status(200).json({
      ok: false,
      message: "Internal server error.",
      details: debug ? String(err) : undefined,
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

  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.access_token) {
    console.error("[google-access] Failed to get token:", data);
    throw new Error(data?.error || "Failed to fetch Google access token");
  }

  return data.access_token;
}
