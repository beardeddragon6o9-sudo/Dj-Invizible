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

async function readRaw(req) { const chunks=[]; for await (const ch of req) chunks.push(ch); return Buffer.concat(chunks).toString("utf8"); }
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
async function execTool(req, name, args){
  const base = origin(req);
  if (name==="check_availability"){
    return await postJSON(`${base}/api/availability`, {
      start: args.start, end: args.end,
      timeZone: args.timeZone || DEFAULT_TZ,
      calendarId: args.calendarId || DEFAULT_CAL
    });
  }
  if (name==="create_hold"){
    const headers = AUTH_SECRET ? { Authorization:`Bearer ${AUTH_SECRET}` } : {};
    return await postJSON(`${base}/api/hold`, {
      start: args.start, end: args.end,
      timeZone: args.timeZone || DEFAULT_TZ,
      calendarId: args.calendarId || DEFAULT_CAL,
      summary: args.summary || "DJ hold",
      description: args.description || "",
      attendees: Array.isArray(args.attendees) ? args.attendees : [],
      ttlMinutes: Number(args.ttlMinutes || HOLD_TTL_MIN)
    }, headers);
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

export default async function handler(req,res){
  const method = req.method || "GET";

  // Simple GET test path still supported: /api/chat?q=...
  if (method==="GET" && req.query?.q){
    try{
      const client=await getOpenAIClient();
      const messages=[ {role:"system",content:systemPrompt}, {role:"user",content:String(req.query.q)} ];
      const first=await client.chat.completions.create({ model:DEFAULT_MODEL, temperature:TEMPERATURE, messages, tools, tool_choice:"auto" });
      const call=first.choices?.[0]?.message?.tool_calls?.[0];
      if (!call){
        const content=first.choices?.[0]?.message?.content ?? "";
        return res.status(200).json({ ok:true, text:content, content, reply:{role:"assistant",content} });
      }
      const args=JSON.parse(call.function.arguments||"{}");
      const tr=await execTool(req, call.function.name, args);
      const second=await client.chat.completions.create({
        model:DEFAULT_MODEL, temperature:TEMPERATURE,
        messages:[ ...messages, {role:"assistant",tool_calls:[call]}, {role:"tool",tool_call_id:call.id,name:call.function.name,content:JSON.stringify(tr)} ]
      });
      const content=second.choices?.[0]?.message?.content ?? JSON.stringify(tr);
      return res.status(200).json({ ok:true, text:content, content, reply:{role:"assistant",content}, toolResults:[tr] });
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

    const client = await getOpenAIClient();

    const first = await client.chat.completions.create({
      model: DEFAULT_MODEL, temperature: TEMPERATURE,
      messages: [{role:"system",content:systemPrompt}, ...messages],
      tools, tool_choice: "auto"
    });

    const choice = first.choices?.[0];
    const toolCalls = choice?.message?.tool_calls || [];
    if (!toolCalls.length){
      const content = choice?.message?.content ?? "";
      return res.status(200).json({ ok:true, text:content, content, reply:{role:"assistant",content} });
    }

    const toolMsgs=[]; const results=[];
    for (const tc of toolCalls){
      const args = JSON.parse(tc.function.arguments||"{}");
      const tr = await execTool(req, tc.function.name, args);
      results.push({ name: tc.function.name, args, result: tr });
      toolMsgs.push({ role:"assistant", tool_calls:[tc] });
      toolMsgs.push({ role:"tool", tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(tr) });
    }

    const second = await client.chat.completions.create({
      model: DEFAULT_MODEL, temperature: TEMPERATURE,
      messages: [{role:"system",content:systemPrompt}, ...messages, ...toolMsgs]
    });

    const content = second.choices?.[0]?.message?.content ?? "";
    return res.status(200).json({ ok:true, text:content, content, reply:{role:"assistant",content}, toolResults: results });
  }catch(err){
    return res.status(500).json({ ok:false, error: err?.message || "server_error" });
  }
}
