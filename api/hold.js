import { google } from "googleapis";

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_REFRESH_TOKEN,
  CALENDAR_ID,
  GOOGLE_CALENDAR_ID,
  HOLD_TTL_MINUTES,
} = process.env;

const DEFAULT_TTL_MINUTES = Number(HOLD_TTL_MINUTES || 20);
const DEFAULT_TIMEZONE = "America/Vancouver";
const DEFAULT_CALENDAR_ID = CALENDAR_ID || GOOGLE_CALENDAR_ID || "primary";

function ok(res, data={}) { return res.status(200).json({ ok: true, ...data }); }
function bad(res, msg, code=400, extra={}) { return res.status(code).json({ ok: false, error: msg, ...extra }); }

function buildOAuth2() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !GOOGLE_REFRESH_TOKEN) {
    throw new Error("Missing Google OAuth env vars.");
  }
  const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

function asISO(v) { const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); }

async function isFree(cal, calendarId, startISO, endISO, timeZone) {
  const resp = await cal.freebusy.query({
    requestBody: { timeMin: startISO, timeMax: endISO, timeZone, items: [{ id: calendarId }] }
  });
  const busy = resp?.data?.calendars?.[calendarId]?.busy || [];
  return busy.length === 0;
}

export default async (req, res) => {
  try {
    const method = req.method || "GET";
    const calendarId = (req.query.calendarId || req.body?.calendarId || DEFAULT_CALENDAR_ID).trim();

    const oauth2 = buildOAuth2();
    const cal = google.calendar({ version: "v3", auth: oauth2 });

    if (method === "POST") {
      const { start, end, email, name, topic, timeZone = DEFAULT_TIMEZONE, ttlMinutes = DEFAULT_TTL_MINUTES } = req.body || {};
      const startISO = asISO(start);
      const endISO = asISO(end);
      if (!startISO || !endISO) return bad(res, "`start` and `end` are required.");
      if (new Date(endISO) <= new Date(startISO)) return bad(res, "`end` must be after `start`.");

      const free = await isFree(cal, calendarId, startISO, endISO, timeZone);
      if (!free) return bad(res, "Time window is not available.", 409);

      const expiresAt = new Date(Date.now() + Number(ttlMinutes) * 60_000);

      const descriptionLines = [
        "Provisional hold requested via API.",
        topic ? `Topic: ${topic}` : null,
        email ? `Requester: ${name ? `${name} <${email}>` : email}` : null,
        `Auto-cancel at: ${expiresAt.toISOString()}`
      ].filter(Boolean);

      const attendees = email ? [{ email, displayName: name || undefined, responseStatus: "needsAction" }] : undefined;

      const requestBody = {
        // IMPORTANT: no custom event id here â€” let Google generate a valid one
        summary: `HOLD: ${name?.trim() || email || "Guest"}`,
        description: descriptionLines.join("\n"),
        start: { dateTime: startISO, timeZone },
        end:   { dateTime: endISO,   timeZone },
        attendees,
        transparency: "opaque",
        status: "tentative",
        extendedProperties: { private: {
          hold: "true",
          // optional: a simple tracking token (not used as event id)
          holdId: Buffer.from(`${startISO}|${endISO}|${email||""}`).toString("hex").slice(0,40),
          autoCancelAt: expiresAt.toISOString(),
          createdAt: new Date().toISOString(),
        }},
        reminders: { useDefault: false },
      };

      let resp;
      try {
        resp = await cal.events.insert({ calendarId, requestBody, sendUpdates: "none" });
      } catch (e) {
        // Surface the exact Google error
        return bad(res, e?.errors?.[0]?.message || e?.message || "Google insert failed", 500);
      }

      const ev = resp.data;
      return ok(res, {
        hold: {
          id: ev.id,                // Google's valid event id
          calendarId,
          htmlLink: ev.htmlLink,
          start: ev.start,
          end: ev.end,
          status: ev.status,
          expiresAt: expiresAt.toISOString(),
        }
      });
    }

    if (method === "GET") {
      const id = (req.query.id || "").toString().trim();
      if (!id) return bad(res, "`id` is required.");
      try {
        const { data } = await cal.events.get({ calendarId, eventId: id });
        return ok(res, { hold: {
          id: data.id, calendarId, htmlLink: data.htmlLink,
          start: data.start, end: data.end, status: data.status,
          private: data.extendedProperties?.private || {}
        }});
      } catch (e) {
        if (e?.code === 404) return bad(res, "Hold not found", 404);
        return bad(res, e?.message || "Fetch failed", 500);
      }
    }

    if (method === "DELETE") {
      const id = (req.body?.id || req.query?.id || "").toString().trim();
      if (!id) return bad(res, "`id` is required.");
      try {
        await cal.events.delete({ calendarId, eventId: id, sendUpdates: "none" });
        return ok(res, { released: true, id });
      } catch (e) {
        if (e?.code === 404) return bad(res, "Hold not found", 404);
        return bad(res, e?.message || "Delete failed", 500);
      }
    }

    res.setHeader("Allow", "POST, GET, DELETE");
    return bad(res, "Method not allowed", 405);
  } catch (err) {
    return bad(res, err?.message || "Unknown error", 500);
  }
};


