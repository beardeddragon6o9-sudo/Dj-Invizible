/**
 * /api/sweep.js
 * - Auto-confirms holds if any attendee has responseStatus: "accepted"
 * - Deletes holds after private.autoCancelAt <= now
 * - SAFE bounds to avoid long scans: [now - 24h, now + 60d], max 500 events
 * - Allows Vercel cron via x-vercel-cron header; manual calls need ?secret=...
 * - Options: dryRun=1|true, sendUpdates=all|none (default all),
 *            calendarId=..., limit=1000, sinceDays=1, horizonDays=60
 */

import { google } from "googleapis";

function bad(res, msg, code = 400, extra = {}) {
  return res.status(code).json({ ok: false, error: msg, ...extra });
}
function ok(res, data = {}) {
  return res.status(200).json({ ok: true, ...data });
}

function buildOAuth2() {
  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    GOOGLE_REFRESH_TOKEN,
  } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !GOOGLE_REFRESH_TOKEN) {
    throw new Error("Missing Google OAuth env vars.");
  }
  const oauth2 = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

function anyAttendeeAccepted(attendees = []) {
  return attendees.some(a => a && a.email && a.responseStatus === "accepted");
}

function stripHoldProps(priv = {}) {
  const copy = { ...priv };
  delete copy.hold;
  delete copy.holdId;
  delete copy.autoCancelAt;
  return copy;
}

export default async (req, res) => {
  try {
    // Allow Vercel cron without secret; require secret for manual calls
    const isVercelCron = !!req.headers["x-vercel-cron"];
    const secret =
      (req.query.secret && String(req.query.secret)) ||
      req.headers["x-sweep-secret"];
    const { SWEEP_SECRET, CALENDAR_ID, GOOGLE_CALENDAR_ID } = process.env;

    if (!isVercelCron) {
      if (!SWEEP_SECRET || secret !== SWEEP_SECRET) {
        return bad(res, "Unauthorized", 401);
      }
    }

    const calendarId = (req.query.calendarId || CALENDAR_ID || GOOGLE_CALENDAR_ID || "primary").trim();
    const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
    const sendUpdates = (req.query.sendUpdates || "all"); // 'all' | 'none'
    const limit = Math.max(1, Math.min(10000, Number(req.query.limit || "1000")));

    const sinceDays = Math.max(0, Number(req.query.sinceDays || "1"));   // look back 24h by default
    const horizonDays = Math.max(1, Number(req.query.horizonDays || "60")); // look ahead 60d

    const now = new Date();
    const nowISO = now.toISOString();
    const timeMin = new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000);
    const timeMax = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);

    // Google client
    const auth = buildOAuth2();
    const cal = google.calendar({ version: "v3", auth });

    // List only "hold" events within bounds, chunked to avoid long scans
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

    while (true) {
      const resp = await cal.events.list({
        calendarId,
        privateExtendedProperty: "hold=true",
        singleEvents: true,
        orderBy: "startTime",
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: 500, // keep pages reasonably small
        pageToken,
      });

      const events = resp?.data?.items || [];
      for (const ev of events) {
        if (examined >= limit) break;
        examined += 1;

        const priv = ev.extendedProperties?.private || {};
        const autoCancelAt = priv.autoCancelAt;
        const attendees = ev.attendees || [];
        const accepted = anyAttendeeAccepted(attendees);

        // 1) Auto-confirm if accepted
        if (accepted) {
          if (dryRun) {
            wouldConfirm += 1;
            wouldConfirmIds.push(ev.id);
          } else {
            const newPriv = {
              ...stripHoldProps(priv),
              confirmedFromHold: "true",
              confirmedAt: nowISO,
            };
            await cal.events.patch({
              calendarId,
              eventId: ev.id,
              sendUpdates,
              requestBody: {
                status: "confirmed",
                extendedProperties: { private: newPriv },
                reminders: { useDefault: true },
                summary: ev.summary?.replace(/^HOLD:\s*/i, "").trim() || ev.summary,
              },
            });
            confirmed += 1;
            confirmedIds.push(ev.id);
          }
          continue;
        }

        // 2) Delete if expired
        if (autoCancelAt) {
          const expiresAt = new Date(autoCancelAt);
          if (!isNaN(expiresAt.getTime()) && expiresAt <= now) {
            if (dryRun) {
              wouldDelete += 1;
              wouldDeleteIds.push(ev.id);
            } else {
              try {
                await cal.events.delete({ calendarId, eventId: ev.id, sendUpdates: "none" });
                deleted += 1;
                deletedIds.push(ev.id);
              } catch (e) {
                if (e?.code !== 404) throw e;
              }
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
      sinceDays,
      horizonDays,
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
    console.error("[sweep] crash:", err);
    return bad(res, err?.message || String(err), 500);
  }
};




