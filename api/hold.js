// /api/hold.js (Vercel serverless function, CommonJS)
const { google } = require('googleapis');

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_REFRESH_TOKEN,
  CALENDAR_ID,
  GOOGLE_CALENDAR_ID,
  HOLD_TTL_MINUTES,
} = process.env;

const DEFAULT_CALENDAR_ID = CALENDAR_ID || GOOGLE_CALENDAR_ID;
const DEFAULT_TTL_MINUTES = Number(HOLD_TTL_MINUTES || 20);
const DEFAULT_TIMEZONE = 'America/Vancouver';

function bad(res, msg, code = 400, extra = {}) {
  res.status(code).json({ ok: false, error: msg, ...extra });
}
function ok(res, data = {}) {
  res.status(200).json({ ok: true, ...data });
}

function buildOAuth2() {
  if (
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_CLIENT_SECRET ||
    !GOOGLE_REDIRECT_URI ||
    !GOOGLE_REFRESH_TOKEN
  ) {
    throw new Error('Missing Google OAuth env vars.');
  }
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return oauth2Client;
}

function asISO(d) {
  const t = new Date(d);
  return isNaN(t.getTime()) ? null : t.toISOString();
}

// base64url, safe for Google Calendar event IDs (letters/digits/-/_)
function holdIdFrom({ start, end, email }) {
  const raw = `${start}|${end}|${email || ''}`;
  const b64 = Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `hold_${b64.slice(0, 200)}`;
}

async function isFree(cal, calendarId, startISO, endISO, timeZone) {
  const resp = await cal.freebusy.query({
    requestBody: {
      timeMin: startISO,
      timeMax: endISO,
      timeZone,
      items: [{ id: calendarId }],
    },
  });
  const periods = resp?.data?.calendars?.[calendarId]?.busy || [];
  return periods.length === 0;
}

async function createHold(cal, calendarId, payload) {
  const {
    start,
    end,
    email,
    name,
    topic,
    timeZone = DEFAULT_TIMEZONE,
    ttlMinutes = DEFAULT_TTL_MINUTES,
  } = payload;

  const startISO = asISO(start);
  const endISO = asISO(end);
  if (!startISO || !endISO) throw new Error('Invalid start/end datetime.');
  if (new Date(endISO) <= new Date(startISO)) throw new Error('end must be after start.');

  const free = await isFree(cal, calendarId, startISO, endISO, timeZone);
  if (!free) {
    const e = new Error('Time window is not available.');
    e.code = 'BUSY';
    throw e;
  }

  const expiresAt = new Date(Date.now() + Number(ttlMinutes) * 60_000);
  const holdId = holdIdFrom({ start: startISO, end: endISO, email });

  const summary = `HOLD: ${name?.trim() || email || 'Guest'}`;
  const descriptionLines = [
    'Provisional hold requested via API.',
    topic ? `Topic: ${topic}` : null,
    email ? `Requester: ${name ? `${name} <${email}>` : email}` : null,
    `Auto-cancel at: ${expiresAt.toISOString()}`,
  ].filter(Boolean);

  const attendees = email
    ? [{ email, displayName: name || undefined, responseStatus: 'needsAction' }]
    : undefined;

  const requestBody = {
  
    summary,
    description: descriptionLines.join('\n'),
    start: { dateTime: startISO, timeZone },
    end: { dateTime: endISO, timeZone },
    attendees,
    transparency: 'opaque',
    status: 'tentative',
    extendedProperties: {
      private: {
        hold: 'true',
        holdId: id,
        autoCancelAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString(),
      },// inside /api/hold.js -> requestBody.extendedProperties.private
extendedProperties: {
  private: {
    hold: 'true',
    holdId: id,
    autoCancelAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
    autoConfirmOnAccept: 'true' // <-- hint; sweeper doesn't strictly require it
  },
},

    },
    reminders: { useDefault: false },
  };

  const resp = await cal.events.insert({
    calendarId,
    requestBody,
    sendUpdates: 'none',
  });

  const event = resp.data;
  return {
    id: event.id,
    calendarId,
    htmlLink: event.htmlLink,
    start: event.start,
    end: event.end,
    status: event.status,
    expiresAt: expiresAt.toISOString(),
  };
}

async function getHold(cal, calendarId, id) {
  try {
    const { data } = await cal.events.get({ calendarId, eventId: id });
    const priv = data.extendedProperties?.private || {};
    return {
      id: data.id,
      calendarId,
      htmlLink: data.htmlLink,
      start: data.start,
      end: data.end,
      status: data.status,
      private: priv,
    };
  } catch (e) {
    if (e?.code === 404) return null;
    throw e;
  }
}

async function deleteHold(cal, calendarId, id) {
  try {
    await cal.events.delete({ calendarId, eventId: id, sendUpdates: 'none' });
    return true;
  } catch (e) {
    if (e?.code === 404) return false;
    throw e;
  }
}

module.exports = async (req, res) => {
  if (!['POST', 'GET', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'POST, GET, DELETE');
    return bad(res, 'Method not allowed', 405);
  }

  let oauth2;
  try {
    oauth2 = buildOAuth2();
  } catch (e) {
    return bad(res, e.message, 500);
  }
  const cal = google.calendar({ version: 'v3', auth: oauth2 });

  const calendarId = (req.query.calendarId || req.body?.calendarId || DEFAULT_CALENDAR_ID || 'primary').trim();

  try {
    if (req.method === 'POST') {
      const { start, end } = req.body || {};
      if (!start || !end) return bad(res, '`start` and `end` are required.');
      const data = await createHold(cal, calendarId, req.body);
      return ok(res, { hold: data });
    }

    if (req.method === 'GET') {
      const id = (req.query.id || '').toString().trim();
      if (!id) return bad(res, '`id` is required.');
      const hold = await getHold(cal, calendarId, id);
      if (!hold) return bad(res, 'Hold not found', 404);
      return ok(res, { hold });
    }

    if (req.method === 'DELETE') {
      const id = (req.body?.id || req.query?.id || '').toString().trim();
      if (!id) return bad(res, '`id` is required.');
      const existed = await deleteHold(cal, calendarId, id);
      if (!existed) return bad(res, 'Hold not found', 404);
      return ok(res, { released: true, id });
    }
  } catch (err) {
    const msg = err?.message || 'Unknown error';
    if (err?.code === 'BUSY') return bad(res, msg, 409);
    if (err?.code === 404) return bad(res, 'Not found', 404);
    if (msg.includes('Invalid Time')) return bad(res, 'Invalid datetime(s).', 400);
    return bad(res, msg, 500, { details: process.env.NODE_ENV !== 'production' ? err : undefined });
  }
};
