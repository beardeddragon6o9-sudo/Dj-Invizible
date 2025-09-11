export const config = { runtime: "nodejs" };

function origin(req) {
  const h = process.env.VERCEL_URL || req.headers.host;
  return h.startsWith("http") ? h : `https://${h}`;
}
async function postJSON(url, body) {
  const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(body) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text } }
  return { ok: r.ok, status: r.status, data };
}

export default async function handler(req, res) {
  try {
    const tz  = process.env.TIME_ZONE || "America/Vancouver";
    const cal = process.env.GOOGLE_CALENDAR_ID || "primary";
    const now = new Date();
    const start = new Date(now.getTime() + 5*60*1000);
    const end   = new Date(now.getTime() + 15*60*1000);
    const toISO = (d) => d.toISOString(); // server will handle tz

    const probe = await postJSON(`${origin(req)}/api/availability`, {
      start: toISO(start),
      end: toISO(end),
      timeZone: tz,
      calendarId: cal
    });

    res.status(200).json({
      ok: true,
      tz, cal,
      availability: probe
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || "diag_failed" });
  }
}
