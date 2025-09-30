export const config = { runtime: "nodejs" };

const DEFAULT_MODEL = process.env.CHAT_MODEL || "gpt-4o-mini";
const TEMPERATURE   = Number(process.env.CHAT_TEMPERATURE || "0.7");
const DEFAULT_TZ    = process.env.TIME_ZONE || "America/Vancouver";
const DEFAULT_CAL   = process.env.GOOGLE_CALENDAR_ID || "primary";
const HOLD_TTL_MIN  = Number(process.env.HOLD_TTL_MINUTES || "60");
const AUTH_SECRET   = process.env.SWEEP_SECRET || process.env.API_SECRET || "";

async function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function readRaw(req){ const chunks=[]; for await (const ch of req) chunks.push(ch); return Buffer.concat(chunks).toString("utf8"); }
function tryJSON(s){ try{ return s?JSON.parse(s):null } catch { return null } }
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

const tools = [
  { type:"function", function:{
      name:"check_availability",
      description:"Check Google Calendar availability for a time range.",
      parameters:{ type:"object", properties:{
        start:{type:"string",description:"ISO start"}, end:{type:"string",description:"ISO end"},
        calendarId:{type:"string","default":DEFAULT_CAL},
        timeZone:{type:"string","default":DEFAULT_TZ},
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

function origin(req){ const h = process.env.VERCEL_URL || req.headers.host; return h.startsWith("http")?h:`https://${h}`; }
async function postJSON(url, body, headers={}){
  const r = await fetch(url,{ method:"POST", headers:{ "Content-Type":"application/json", ...headers }, body:JSON.stringify(body) });
  const text = await r.text(); let data; try{ data=JSON.parse(text) }catch{ data={ raw:text } }
  return { httpOk:r.ok, status:r.status, ...((typeof data==='object'&&data)?data:{}) };
}

function prettifyRange(startISO, endISO, tz){
  // Keep it simple & robust (string as given)
  return `${startISO} → ${endISO} (${tz})`;
}

function formatFromAvailability(result, args){
  if (!result || result.ok === false || result.httpOk === false) {
    const msg = result?.error || `HTTP ${result?.status||"??"}`;
    return `Sorry — availability check failed (${msg}).`;
  }
  const tz = result.timeZone || args.timeZone || DEFAULT_TZ;
  const human = prettifyRange(args.start, args.end, tz);
  const isFree = (result.available === true) || (Array.isArray(result.busy) && result.busy.length === 0);
  if (isFree) return `You're **FREE** for ${human}.`;
  const blocks = Array.isArray(result.busy) ? result.busy.map(b => `${b.start || "?"}–${b.end || "?"}`).join(", ") : "unknown";
  return `You're **BUSY** for ${human}. Busy blocks: ${blocks}.`;
}

function formatFromHold(result, args){
  if (!result || result.ok === false || result.httpOk === false) {
    const msg = result?.error || `HTTP ${result?.status||"??"}`;
    return `Sorry — creating a hold failed (${msg}).`;
  }
  const tz = args.timeZone || DEFAULT_TZ;
  const human = prettifyRange(args.start, args.end, tz);
  const id   = result.id || result.hold?.id;
  const link = result.htmlLink || result.hold?.htmlLink;
  return `✅ Hold created for ${human}${link ? ` — link: ${link}` : ""}${id ? ` (id: ${id})` : ""}.`;
}

async function execTool(req, name, args){
  const base = origin(req);

  // Common auth headers
  const authHeaders = {};
  if (AUTH_SECRET) {
    authHeaders.Authorization    = `Bearer ${AUTH_SECRET}`;
    authHeaders["x-cron-secret"] = AUTH_SECRET;
    authHeaders["x-api-key"]     = AUTH_SECRET;
  }

  // ALSO pass ?secret=... for routes that only read query
  const qs = AUTH_SECRET ? `?secret=${encodeURIComponent(AUTH_SECRET)}` : "";

  if (name === "check_availability") {
    return await postJSON(`${base}/api/availability${qs}`, {
      start: args.start,
      end: args.end,
      timeZone: args.timeZone || DEFAULT_TZ,
      calendarId: args.calendarId || DEFAULT_CAL
    }, authHeaders);
  }

  if (name === "create_hold") {
    return await postJSON(`${base}/api/hold${qs}`, {
      start: args.start,
      end: args.end,
      timeZone: args.timeZone || DEFAULT_TZ,
      calendarId: args.calendarId || DEFAULT_CAL,
      summary: args.summary || "DJ hold",
      description: args.description || "",
      attendees: Array.isArray(args.attendees) ? args.attendees : [],
      ttlMinutes: Number(args.ttlMinutes || HOLD_TTL_MIN)
    }, authHeaders);
  }

  return { ok:false, error:`Unknown tool: ${name}` };
}

const systemPrompt =
`You are DJ Invizible's assistant. You have access to TOOLS:
- check_availability(start, end, calendarId?, timeZone?)
- create_hold(start, end, summary?, description?, attendees?, calendarId?, timeZone?, ttlMinutes?)

Rules:
- When the user asks about schedules, availability, booking, or holds, you MUST call a tool with precise ISO datetimes in ${DEFAULT_TZ}.
- If either start or end is missing, ask ONCE to clarify both in a single question, then call the tool.
- Default calendar: ${DEFAULT_CAL}. Default time zone: ${DEFAULT_TZ}.
- Keep answers concise and include a human-friendly time summary.`;

export default async function handler(req, res){
  const method = req.method || "GET";

  const runWithTools = async (messages) => {
    const client = await getOpenAIClient();
    const first = await client.chat.completions.create({
      model: DEFAULT_MODEL, temperature: TEMPERATURE,
      messages: [{role:"system", content: systemPrompt}, ...messages],
      tools, tool_choice: "auto"
    });

    const tcAll = first.choices?.[0]?.message?.tool_calls || [];
    if (!tcAll.length) {
      const content = first.choices?.[0]?.message?.content ?? "";
      return { content, toolResults: [] };
    }

    // Execute tool(s)
    const toolMsgs=[]; const results=[];
    for (const tc of tcAll){
      const args = JSON.parse(tc.function.arguments||"{}");
      const tr   = await execTool(req, tc.function.name, args);
      results.push({ name: tc.function.name, args, result: tr });
      toolMsgs.push({ role:"assistant", tool_calls:[tc] });
      toolMsgs.push({ role:"tool", tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(tr) });
    }

    // Deterministic, server-crafted final message (skip model if tools ran)
    // We generate a concise answer directly from toolResults:
    let content = "";
    for (const r of results){
      if (r.name === "check_availability") content += (content ? "\n" : "") + formatFromAvailability(r.result, r.args);
      if (r.name === "create_hold")        content += (content ? "\n" : "") + formatFromHold(r.result, r.args);
    }
    if (!content) content = "Done.";

    return { content, toolResults: results };
  };

  if (method === "GET" && req.query?.q) {
    try {
      const out = await runWithTools([{ role:"user", content: String(req.query.q) }]);
      return res.status(200).json({ ok:true, text: out.content, content: out.content, reply:{role:"assistant",content:out.content}, toolResults: out.toolResults });
    } catch (err) {
      return res.status(500).json({ ok:false, error: err?.message || "server_error" });
    }
  }

  if (method !== "POST") {
    res.setHeader("Allow", "POST, GET");
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  try {
    const body = await readBody(req);
    const messages = extractMessages(body, req.query?.q);
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ ok:false, error:"Missing 'messages' array or a prompt." });
    }

    const out = await runWithTools(messages);
    return res.status(200).json({ ok:true, text: out.content, content: out.content, reply:{role:"assistant",content:out.content}, toolResults: out.toolResults });
  } catch (err) {
    return res.status(500).json({ ok:false, error: err?.message || "server_error" });
  }
}


