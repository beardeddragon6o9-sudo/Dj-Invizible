export const config = { runtime: "nodejs" };

// Defaults (you can override via Vercel env)
const DEFAULT_MODEL = process.env.CHAT_MODEL || "gpt-4o-mini";
const TEMPERATURE   = Number(process.env.CHAT_TEMPERATURE || "0.7"); // a bit calmer for ops
const DEFAULT_TZ    = process.env.TIME_ZONE || "America/Vancouver";
const DEFAULT_CAL   = process.env.GOOGLE_CALENDAR_ID || "primary";
const HOLD_TTL_MIN  = Number(process.env.HOLD_TTL_MINUTES || "60");   // default 60 min holds
const AUTH_SECRET   = process.env.SWEEP_SECRET || process.env.API_SECRET || ""; // used if your hold route requires it

async function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const { default: OpenAI } = await import("openai"); // dynamic import avoids cold-start crash
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function readRaw(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  return Buffer.concat(chunks).toString("utf8");
}

function tryJSON(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
function tryForm(s) {
  try {
    if (!s || s.indexOf("=") === -1) return null;
    const params = new URLSearchParams(s);
    const obj = {};
    for (const [k,v] of params.entries()) obj[k] = v;
    return obj;
  } catch { return null; }
}

async function readBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === "string") return { raw: req.body, json: tryJSON(req.body), form: tryForm(req.body) };
    if (typeof req.body === "object" && req.body !== null) return { raw: "", json: req.body, form: null };
  }
  const raw = await readRaw(req);
  return { raw, json: tryJSON(raw), form: tryForm(raw) };
}

function extractMessages({ json, form, raw, q }) {
  // Accept many shapes so legacy clients keep working
  const pick = (o, keys) => o ? keys.map(k => o[k]).find(v => v != null && v !== "") : null;

  let messages = Array.isArray(json?.messages) ? json.messages : null;
  const prompt =
    q ||
    pick(json, ["prompt","text","message","msg","input","content","q","query"]) ||
    pick(form, ["prompt","text","message","msg","input","content","q","query"]) ||
    (typeof json === "string" ? json : null) ||
    (raw && raw.trim().startsWith("{") ? null : raw);

  if (!messages && prompt) messages = [{ role: "user", content: String(prompt) }];
  return messages || [];
}

// ---- Tools (function-calling) ----
const tools = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Check Google Calendar availability for a time range.",
      parameters: {
        type: "object",
        properties: {
          start: { type: "string", description: "ISO8601 start, e.g. 2025-09-12T14:00:00-07:00" },
          end:   { type: "string", description: "ISO8601 end" },
          calendarId: { type: "string", description: "Google calendar id", default: DEFAULT_CAL },
          timeZone:   { type: "string", description: "IANA time zone",     default: DEFAULT_TZ },
        },
        required: ["start","end"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_hold",
      description: "Create a tentative calendar hold (status tentative) with an auto-expire (ttlMinutes).",
      parameters: {
        type: "object",
        properties: {
          start: { type: "string", description: "ISO8601 start" },
          end:   { type: "string", description: "ISO8601 end" },
          summary: { type: "string", description: "Title for the hold", default: "DJ hold" },
          description: { type: "string", description: "Details for the hold" },
          attendees: { type: "array", items: { type: "string" }, description: "Emails of attendees" },
          calendarId: { type: "string", default: DEFAULT_CAL },
          timeZone:   { type: "string", default: DEFAULT_TZ },
          ttlMinutes: { type: "number", default: HOLD_TTL_MIN }
        },
        required: ["start","end"]
      }
    }
  }
];

function sseLikeJson(res, obj, status = 200) {
  res.status(status).json(obj);
}

function buildOrigin(req) {
  // Use the deployment URL if available, else Host header
  const host = process.env.VERCEL_URL || req.headers.host;
  return host.startsWith("http") ? host : `https://${host}`;
}

async function postJSON(url, body, extraHeaders = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { ok:false, error:"invalid_json", raw: text }; }
  if (!r.ok) return { ok:false, status: r.status, error: data?.error || text, data };
  return data;
}

// Tool executors call your existing endpoints server-side (secret stays on server)
async function execTool(req, name, args) {
  const origin = buildOrigin(req);
  if (name === "check_availability") {
    const payload = {
      start: args.start,
      end: args.end,
      timeZone: args.timeZone || DEFAULT_TZ,
      calendarId: args.calendarId || DEFAULT_CAL,
    };
    return await postJSON(`${origin}/api/availability`, payload);
  }
  if (name === "create_hold") {
    const payload = {
      start: args.start,
      end: args.end,
      timeZone: args.timeZone || DEFAULT_TZ,
      calendarId: args.calendarId || DEFAULT_CAL,
      summary: args.summary || "DJ hold",
      description: args.description || "",
      attendees: Array.isArray(args.attendees) ? args.attendees : [],
      ttlMinutes: Number(args.ttlMinutes || HOLD_TTL_MIN)
    };
    const headers = AUTH_SECRET ? { Authorization: `Bearer ${AUTH_SECRET}` } : {};
    return await postJSON(`${origin}/api/hold`, payload, headers);
  }
  return { ok:false, error:`Unknown tool: ${name}` };
}

export default async function handler(req, res) {
  if (req.method === "GET" && req.query?.q) {
    // Simple GET test path still supported
    try {
      const client = await getOpenAIClient();
      const systemPrompt =
        `You are DJ Invizible's assistant. You can analyze questions and call tools to check availability or create a hold.
Default time zone: ${DEFAULT_TZ}. Default calendar: ${DEFAULT_CAL}. When asked about scheduling or holds, prefer calling a tool.`

      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: String(req.query.q) }
      ];

      // Let the model decide if a tool is needed
      const first = await client.chat.completions.create({
        model: DEFAULT_MODEL,
        messages,
        temperature: TEMPERATURE,
        tools,
        tool_choice: "auto"
      });

      const call = first.choices?.[0]?.message?.tool_calls?.[0];
      if (!call) {
        const content = first.choices?.[0]?.message?.content ?? "";
        return sseLikeJson(res, { ok:true, text: content, content, reply: { role:"assistant", content } });
      }

      // Execute tool
      const args = JSON.parse(call.function.arguments || "{}");
      const toolResult = await execTool(req, call.function.name, args);

      // Follow-up message with tool result
      const second = await client.chat.completions.create({
        model: DEFAULT_MODEL,
        temperature: TEMPERATURE,
        messages: [
          ...messages,
          { role: "assistant", tool_calls: [call] },
          { role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(toolResult) }
        ]
      });

      const content = second.choices?.[0]?.message?.content ?? JSON.stringify(toolResult);
      return sseLikeJson(res, { ok:true, text: content, content, reply: { role:"assistant", content }, toolResult });
    } catch (err) {
      console.error("[/api/chat GET] error:", err);
      return res.status(500).json({ ok:false, error: err?.message || "server_error" });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow","POST, GET");
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  try {
    const { json, form, raw } = await readBody(req);
    const messages = extractMessages({ json, form, raw, q: req.query?.q });
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ ok:false, error:"Missing 'messages' array or a prompt (prompt/text/message/msg/input/content/q)." });
    }

    const client = await getOpenAIClient();

    const systemPrompt =
      `You are DJ Invizible's assistant. You can analyze questions and call tools to check Google Calendar availability or create a hold.
- Default time zone: ${DEFAULT_TZ}
- Default calendar: ${DEFAULT_CAL}
- When asked to check a time or place a hold, call the appropriate tool with precise ISO times.
- If info is missing (start/end), ask a concise follow-up.`

    // Initial ask with tools
    const first = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      temperature: TEMPERATURE,
      messages: [{ role:"system", content: systemPrompt }, ...messages],
      tools,
      tool_choice: "auto"
    });

    const choice = first.choices?.[0];
    const call = choice?.message?.tool_calls?.[0];

    if (!call) {
      const content = choice?.message?.content ?? "";
      return res.status(200).json({ ok:true, text: content, content, reply: { role:"assistant", content } });
    }

    // Execute tool(s) — handle multiple if present
    const toolMsgs = [];
    for (const tc of choice.message.tool_calls || []) {
      const args = JSON.parse(tc.function.arguments || "{}");
      const toolResult = await execTool(req, tc.function.name, args);
      toolMsgs.push({ role: "assistant", tool_calls: [tc] });
      toolMsgs.push({ role: "tool", tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(toolResult) });
    }

    // Follow-up to produce the final answer
    const second = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      temperature: TEMPERATURE,
      messages: [{ role:"system", content: systemPrompt }, ...messages, ...toolMsgs]
    });

    const content = second.choices?.[0]?.message?.content ?? "";
    return res.status(200).json({ ok:true, text: content, content, reply: { role:"assistant", content } });
  } catch (err) {
    console.error("[/api/chat] error:", err);
    return res.status(500).json({ ok:false, error: err?.message || "server_error" });
  }
}
