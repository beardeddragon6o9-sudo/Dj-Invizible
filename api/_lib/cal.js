const CAL_API_BASE = "https://api.cal.com/v2";
const CAL_API_KEY = process.env.CAL_API_KEY || process.env.Cal_Api_key;

function requireApiKey() {
  if (!CAL_API_KEY) {
    throw new Error("Cal.com API key is not set. Use CAL_API_KEY (or Cal_Api_key).");
  }
}

function clean(obj) {
  return Object.fromEntries(
    Object.entries(obj || {}).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function getEnvEventRef() {
  return {
    eventTypeId: toInt(process.env.CAL_EVENT_TYPE_ID),
    eventTypeSlug: process.env.CAL_EVENT_TYPE_SLUG,
    eventTypeName: process.env.CAL_EVENT_TYPE_NAME,
    username: process.env.CAL_USERNAME,
    teamSlug: process.env.CAL_TEAM_SLUG,
    organizationSlug: process.env.CAL_ORG_SLUG,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function calFetch(
  path,
  { method = "GET", query, body, apiVersion, timeoutMs, retry, retryDelayMs = 500, retryOn = [] } = {}
) {
  requireApiKey();
  if (!apiVersion) throw new Error("cal-api-version is required for this endpoint.");

  const url = new URL(`${CAL_API_BASE}${path}`);
  const q = clean(query);
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, String(v));

  const headers = {
    Authorization: `Bearer ${CAL_API_KEY}`,
    "cal-api-version": apiVersion,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const attempts = Math.max(1, Number(retry || 0) + 1);
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    let controller;
    let timer;
    try {
      if (timeoutMs) {
        controller = new AbortController();
        timer = setTimeout(() => controller.abort(), timeoutMs);
      }
      const res = await fetch(url.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller?.signal,
      });

      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      if (!res.ok) {
        const msg = data?.error?.message || data?.error || data?.message || res.statusText || "cal_api_error";
        const err = new Error(`Cal.com API error (${res.status}): ${msg}`);
        err.status = res.status;
        err.data = data;
        throw err;
      }

      return data;
    } catch (err) {
      lastErr = err;
      const status =
        err?.status || (err?.name === "AbortError" ? 408 : err?.statusCode || null);
      const shouldRetry = retryOn.includes(status);
      if (!shouldRetry || i === attempts - 1) {
        throw err;
      }
      await sleep(retryDelayMs);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr;
}

function coalesce(a, b) {
  return a !== undefined && a !== null && a !== "" ? a : b;
}

export async function resolveEventTypeRef(input = {}) {
  const env = getEnvEventRef();
  const ref = {
    eventTypeId: coalesce(input.eventTypeId, env.eventTypeId),
    eventTypeSlug: coalesce(input.eventTypeSlug, env.eventTypeSlug),
    eventTypeName: coalesce(input.eventTypeName, env.eventTypeName),
    username: coalesce(input.username, env.username),
    teamSlug: coalesce(input.teamSlug, env.teamSlug),
    organizationSlug: coalesce(input.organizationSlug, env.organizationSlug),
  };

  if (ref.eventTypeId) return { eventTypeId: Number(ref.eventTypeId) };

  if (ref.eventTypeSlug) {
    return clean({
      eventTypeSlug: ref.eventTypeSlug,
      username: ref.username,
      teamSlug: ref.teamSlug,
      organizationSlug: ref.organizationSlug,
    });
  }

  if (!ref.eventTypeName) {
    throw new Error("Missing event type. Provide eventTypeId, eventTypeSlug, or eventTypeName.");
  }
  if (!ref.username) {
    throw new Error("Missing CAL_USERNAME for event type lookup by name.");
  }

  const list = await calFetch("/event-types", {
    method: "GET",
    query: clean({ username: ref.username, orgSlug: ref.organizationSlug }),
    apiVersion: "2024-06-14",
  });

  const items = Array.isArray(list?.data) ? list.data : [];
  const needle = String(ref.eventTypeName).toLowerCase();
  const match =
    items.find((e) => String(e?.title || "").toLowerCase() === needle) ||
    items.find((e) => String(e?.name || "").toLowerCase() === needle) ||
    items.find((e) => String(e?.slug || "").toLowerCase() === needle);

  if (!match) {
    throw new Error(`Event type not found: "${ref.eventTypeName}"`);
  }

  if (match?.id) return { eventTypeId: Number(match.id) };

  return clean({
    eventTypeSlug: match?.slug,
    username: ref.username,
    organizationSlug: ref.organizationSlug,
  });
}

export async function calCheckAvailability(input = {}) {
  const { start, end, timeZone, duration, format, bookingUidToReschedule } = input || {};
  if (!start || !end) throw new Error("start and end are required.");

  const eventRef = await resolveEventTypeRef(input);
  return calFetch("/slots", {
    method: "GET",
    apiVersion: "2024-09-04",
    timeoutMs: 12000,
    query: clean({
      start,
      end,
      timeZone,
      duration,
      format,
      bookingUidToReschedule,
      ...eventRef,
    }),
  });
}

export async function calCreateBooking(input = {}) {
  const { start, attendee, guests, bookingFieldsResponses, metadata } = input || {};
  if (!start) throw new Error("start is required.");
  if (!attendee?.name || !attendee?.email || !attendee?.timeZone) {
    throw new Error("attendee.name, attendee.email, and attendee.timeZone are required.");
  }

  const eventRef = await resolveEventTypeRef(input);
  const payload = {
    start,
    attendee,
    guests,
    bookingFieldsResponses,
    metadata,
  };

  if (eventRef.eventTypeId) {
    payload.eventTypeId = eventRef.eventTypeId;
  } else {
    payload.eventTypeSlug = eventRef.eventTypeSlug;
    if (eventRef.username) payload.username = eventRef.username;
    if (eventRef.teamSlug) payload.teamSlug = eventRef.teamSlug;
    if (eventRef.organizationSlug) payload.organizationSlug = eventRef.organizationSlug;
  }

  return calFetch("/bookings", {
    method: "POST",
    apiVersion: "2024-08-13",
    timeoutMs: 15000,
    retry: 1,
    retryDelayMs: 800,
    retryOn: [504, 524, 408],
    body: clean(payload),
  });
}

export async function calCancelBooking(input = {}) {
  const { bookingUid, cancellationReason, cancelSubsequentBookings, seatUid } = input || {};
  if (!bookingUid) throw new Error("bookingUid is required.");

  return calFetch(`/bookings/${encodeURIComponent(bookingUid)}/cancel`, {
    method: "POST",
    apiVersion: "2024-08-13",
    timeoutMs: 12000,
    retry: 1,
    retryDelayMs: 800,
    retryOn: [504, 524, 408],
    body: clean({ cancellationReason, cancelSubsequentBookings, seatUid }),
  });
}
