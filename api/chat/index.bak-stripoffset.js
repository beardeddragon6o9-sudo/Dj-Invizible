export const config = { runtime: "nodejs" };

// --- Config & envs
const DEFAULT_MODEL = process.env.CHAT_MODEL || "gpt-5-mini";
function _safeTemp(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.7;
  return Math.max(0, Math.min(2, n));
}
const TEMPERATURE   = _safeTemp(process.env.CHAT_TEMPERATURE);
const DEFAULT_TZ    = process.env.TIME_ZONE || "America/Vancouver";
const DEFAULT_CAL   = process.env.GOOGLE_CALENDAR_ID || "primary";
const HOLD_TTL_MIN  = Number(process.env.HOLD_TTL_MINUTES || "60");
const AUTH_SECRET   = process.env.SWEEP_SECRET || process.env.API_SECRET || "";

// --- OpenAI client
async function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// --- tiny utils
function origin(req){ const h = process.env.VERCEL_URL || req.headers.host || ""; return h.startsWith("http")?h:`https://${h}`; }
async function readRaw(req){ const chunks=[]; for await (const ch of req) chunks.push(ch); return Buffer.concat(chunks).toString("utf8"); }
function tryJSON(s){ try { return s?JSON.parse(s):null } catch { return null } }
async function readBody(req){
  if (req.body!==undefined){
    if (typeof req.body==="string") return tryJSON(req.body) ?? {};
    if (typeof req.body==="object" && req.body!==null) return req.body;
  }
  const raw = await readRaw(req);
  return tryJSON(raw) ?? {};
}
function extractMessages(body, q){
  let messages = Array.isArray(body?.messages) ? body.messages : null;
  const prompt = q || body?.prompt || body?.text || body?.message || body?.input || body?.content || null;
  if (!messages && prompt) messages = [{ role:"user", content:String(prompt) }];
  return messages || [];
}
async function postJSON(url, body, headers = {}) {
  const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json", ...headers }, body:JSON.stringify(body) });
  const text = await r.text(); let data; try{ data=JSON.parse(text) }catch{ data={ raw:text } }
  return { httpOk:r.ok, status:r.status, ...((typeof data==='object'&&data)?data:{}) };
}

// --- normalize timeZone to IANA (force to DEFAULT_TZ if unclear)
const TZ_ALIASES = {
  "vancouver":"America/Vancouver", "vancouver time":"America/Vancouver",
  "pacific":"America/Los_Angeles", "pacific time":"America/Los_Angeles",
  "pst":"America/Los_Angeles", "pdt":"America/Los_Angeles",
  "los angeles":"America/Los_Angeles", "la":"America/Los_Angeles", "pt":"America/Los_Angeles"
};
function normalizeTz(input) {
  const def = DEFAULT_TZ;
  if (!input || typeof input !== "string") return def;
  const s = input.trim().toLowerCase();
  if (TZ_ALIASES[s]) return TZ_ALIASES[s];
  if (/^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.test(input)) return input; // IANA
  if (/^[+-]\d{2}:?\d{2}$/.test(s)) return def; // offset given → use default IANA
  if (s.includes("vancouver")) return "America/Vancouver";
  if (s.includes("pacific")) return "America/Los_Angeles";
  return def;
}

// --- Google fallback
async function getGoogleAccessToken(){
  const client_id = process.env.GOOGLE_CLIENT_ID;
  const client_secret = process.env.GOOGLE_CLIENT_SECRET;
  const refresh_token = process.env.GOOGLE_REFRESH_TOKEN;
  if (!client_id || !client_secret || !refresh_token) throw new Error("Missing Google OAuth envs");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type:"refresh_token", client_id, client_secret, refresh_token })
  });
  const js = await r.json();
  if (!r.ok || !js.access_token) throw new Error(js.error || "token_refresh_failed");
  return js.access_token;
}
async function resolveCalendarId(token, calendarId){
  let calId = calendarId || DEFAULT_CAL;
  if (calId !== "primary") return calId;
  const r = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { Authorization:`Bearer ${token}` }
  });
  const js = await r.json();
  if (r.ok && Array.isArray(js.items)) {
    const primary = js.items.find(i => i.primary) || js.items.find(i => i.accessRole==="owner") || js.items[0];
    if (primary?.id) return primary.id;
  }
  return "primary";
}
async function googleCheckAvailability({ start, end, timeZone, calendarId }){
  const token = await getGoogleAccessToken();
  const tz = normalizeTz(timeZone);
  const calId = await resolveCalendarId(token, calendarId);
  const r = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method:"POST",
    headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
    body: JSON.stringify({ timeMin:start, timeMax:end, timeZone: tz, items:[{id:calId}] })
  });
  const js = await r.json();
  if (!r.ok) return { httpOk:false, status:r.status, error: js.error?.message || "google_freebusy_failed", raw: js };
  const busy = (js.calendars?.[calId]?.busy) || [];
  return { ok:true, calendarId: calId, timeZone: tz, busy, available: busy.length===0 };
}
async function googleCreateHold({ start, end, timeZone, calendarId, summary, description, attendees, ttlMinutes }){
  const token = await getGoogleAccessToken();
  const tz = normalizeTz(timeZone);
  const calId = await resolveCalendarId(token, calendarId);
  const reqBody = {
    summary: summary || "DJ hold",
    description: description || "",
    start: { dateTime: start, timeZone: tz },
    end:   { dateTime: end,   timeZone: tz },
    attendees: Array.isArray(attendees) ? attendees.map(e=>({ email:String(e) })) : [],
    transparency: "opaque",
    status: "tentative",
    extendedProperties: {
      private: {
        hold: "true",
        autoCancelAt: new Date(Date.now() + (Number(ttlMinutes||HOLD_TTL_MIN)*60*1000)).toISOString(),
        createdAt: new Date().toISOString()
      }
    }
  };
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?sendUpdates=none`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
    body: JSON.stringify(reqBody)
  });
  const js = await r.json();
  if (!r.ok) return { httpOk:false, status:r.status, error: js.error?.message || "google_events_insert_failed", raw: js };
  return { ok:true, id: js.id, calendarId: calId, htmlLink: js.htmlLink, start: js.start, end: js.end, status: js.status };
}

// --- Tool exec: try local first; fallback on any non-2xx; FORCE tz
async function execTool(req, name, args){
  const base = origin(req);
  const tz = normalizeTz(args.timeZone || DEFAULT_TZ);

  const authHeaders = {};
  if (AUTH_SECRET) {
    authHeaders.Authorization    = `Bearer ${AUTH_SECRET}`;
    authHeaders["x-cron-secret"] = AUTH_SECRET;
    authHeaders["x-api-key"]     = AUTH_SECRET;
  }
  const qs = AUTH_SECRET ? `?secret=${encodeURIComponent(AUTH_SECRET)}` : "";

  if (name === "check_availability"){
    const local = await postJSON(`${base}/api/availability${qs}`, {
      start: args.start, end: args.end, timeZone: tz, calendarId: args.calendarId || DEFAULT_CAL
    }, authHeaders);
    if (!local.httpOk || (typeof local.status==="number" && local.status>=400) || local.ok===false) {
      return await googleCheckAvailability({ start: args.start, end: args.end, timeZone: tz, calendarId: args.calendarId || DEFAULT_CAL });
    }
    return local;
  }

  if (name === "create_hold"){
    const local = await postJSON(`${base}/api/hold${qs}`, {
      start: args.start, end: args.end, timeZone: tz, calendarId: args.calendarId || DEFAULT_CAL,
      summary: args.summary || "DJ hold", description: args.description || "",
      attendees: Array.isArray(args.attendees) ? args.attendees : [], ttlMinutes: Number(args.ttlMinutes || HOLD_TTL_MIN)
    }, authHeaders);
    if (!local.httpOk || (typeof local.status==="number" && local.status>=400) || local.ok===false) {
      return await googleCreateHold({ start: args.start, end: args.end, timeZone: tz, calendarId: args.calendarId || DEFAULT_CAL,
        summary: args.summary, description: args.description, attendees: args.attendees, ttlMinutes: args.ttlMinutes });
    }
    return local;
  }

  return { ok:false, error:`Unknown tool: ${name}` };
}

// --- Formatting
function prettifyRange(startISO, endISO, tz){ return `${startISO} → ${endISO} (${tz})`; }
function formatFromAvailability(result, args){
  if (!result || result.ok===false || result.httpOk===false) {
    const msg = result?.error || `HTTP ${result?.status||"??"}`; return `Sorry — availability check failed (${msg}).`;
  }
  const tz = result.timeZone || DEFAULT_TZ;
  const human = prettifyRange(args.start, args.end, tz);
  const isFree = (result.available === true) || (Array.isArray(result.busy) && result.busy.length===0);
  if (isFree) return `You're **FREE** for ${human}.`;
  const blocks = Array.isArray(result.busy) ? result.busy.map(b => `${b.start||"?"}–${b.end||"?"}`).join(", ") : "unknown";
  return `You're **BUSY** for ${human}. Busy blocks: ${blocks}.`;
}
function formatFromHold(result, args){
  if (!result || result.ok===false || result.httpOk===false) {
    const msg = result?.error || `HTTP ${result?.status||"??"}`; return `Sorry — creating a hold failed (${msg}).`;
  }
  const tz = DEFAULT_TZ;
  const human = prettifyRange(args.start, args.end, tz);
  const id = result.id || result.hold?.id; const link = result.htmlLink || result.hold?.htmlLink;
  return `✅ Hold created for ${human}${link?` — link: ${link}`:""}${id?` (id: ${id})`:""}.`;
}

// --- Tools schema
const tools = [
  { type:"function", function:{
      name:"check_availability",
      description:"Check Google Calendar availability for a time range.",
      parameters:{ type:"object", properties:{
        start:{type:"string"}, end:{type:"string"},
        calendarId:{type:"string","default":DEFAULT_CAL},
        timeZone:{type:"string","default":DEFAULT_TZ}
      }, required:["start","end"] }
  }},
  { type:"function", function:{
      name:"create_hold",
      description:"Create a tentative hold with auto-expire (ttlMinutes).",
      parameters:{ type:"object", properties:{
        start:{type:"string"}, end:{type:"string"},
        summary:{type:"string","default":"DJ hold"},
        description:{type:"string"},
        attendees:{type:"array", items:{type:"string"}},
        calendarId:{type:"string","default":DEFAULT_CAL},
        timeZone:{type:"string","default":DEFAULT_TZ},
        ttlMinutes:{type:"number","default":HOLD_TTL_MIN}
      }, required:["start","end"] }
  }},
];

const systemPrompt =
`You are DJ Invizible's assistant. You have access to TOOLS:
- check_availability(start, end, calendarId?, timeZone?)
- create_hold(start, end, summary?, description?, attendees?, calendarId?, timeZone?, ttlMinutes?)

Rules:
- When the user asks about schedules, availability, booking, or holds, you MUST call a tool with precise ISO datetimes in ${DEFAULT_TZ}.
- If the user gives a date without a year, interpret it as the NEXT FUTURE occurrence in ${DEFAULT_TZ}.
- Prefer FUTURE ranges; use past only if explicitly requested.
- Always include YEAR and full ISO timestamps (e.g., 2025-09-30T18:00:00-07:00).
- Default calendar: ${DEFAULT_CAL}. Default time zone: ${DEFAULT_TZ}.
- Keep answers concise and include a human-friendly time summary.`;

// --- Orchestrator
async function runWithTools(req, messages){
  const client = await getOpenAIClient();
  const first = await client.chat.completions.create({
    model: DEFAULT_MODEL, temperature: TEMPERATURE,
    messages: [{role:"system", content: systemPrompt}, ...messages],
    tools, tool_choice: "auto"
  });
  const tcs = first.choices?.[0]?.message?.tool_calls || [];
  if (!tcs.length) {
    const content = first.choices?.[0]?.message?.content ?? "";
    return { content, toolResults: [] };
  }
  const results=[];
  for (const tc of tcs){
    const args = JSON.parse(tc.function.arguments||"{}");
    const tr   = await execTool(req, tc.function.name, args);
    results.push({ name: tc.function.name, args, result: tr });
  }
  let content = "";
  for (const r of results){
    if (r.name==="check_availability") content += (content?"\n":"") + formatFromAvailability(r.result, r.args);
    if (r.name==="create_hold")        content += (content?"\n":"") + formatFromHold(r.result, r.args);
  }
  if (!content) content = "Done.";
  return { content, toolResults: results };
}

// --- Handler
export default async function handler(req, res){
  const method = req.method || "GET";

  if (method==="GET" && req.query?.q){
    try{
      const out = await runWithTools(req, [{ role:"user", content:String(req.query.q) }]);
      return res.status(200).json({ ok:true, text: out.content, content: out.content, reply:{role:"assistant",content:out.content}, toolResults: out.toolResults });
    }catch(err){
      return res.status(500).json({ ok:false, error: err?.message || "server_error" });
    }
  }

  if (method!=="POST"){
    res.setHeader("Allow","POST, GET");
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  try{
    const body = await readBody(req);
    const messages = extractMessages(body, req.query?.q);
    if (!Array.isArray(messages) || messages.length===0){
      return res.status(400).json({ ok:false, error:"Missing 'messages' array or a prompt." });
    }
    const out = await runWithTools(req, messages);
    return res.status(200).json({ ok:true, text: out.content, content: out.content, reply:{role:"assistant",content:out.content}, toolResults: out.toolResults });
  }catch(err){
    return res.status(500).json({ ok:false, error: err?.message || "server_error" });
  }
}
