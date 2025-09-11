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
function tryForm(s){ try{ if(!s||!s.includes("=")) return null; const p=new URLSearchParams(s); const o={}; for(const [k,v] of p)o[k]=v; return o } catch { return null } }

async function readBody(req){
  if (req.body!==undefined){
    if (typeof req.body==="string") return { raw:req.body, json:tryJSON(req.body), form:tryForm(req.body) };
    if (typeof req.body==="object" && req.body!==null) return { raw:"", json:req.body, form:null };
  }
  const raw = await readRaw(req);
  return { raw, json:tryJSON(raw), form:tryForm(raw) };
}

function extractMessages({ json, form, raw, q }){
  const pick=(o,keys)=>o?keys.map(k=>o[k]).find(v=>v!=null&&v!==""):null;
  let messages = Array.isArray(json?.messages) ? json.messages : null;
  const prompt =
    q ||
    pick(json,["prompt","text","message","msg","input","content","q","query"]) ||
    pick(form,["prompt","text","message","msg","input","content","q","query"]) ||
    (typeof json==="string" ? json : null) ||
    (raw && raw.trim().startsWith("{") ? null : raw);
  if (!messages && prompt) messages=[{ role:"user", content:String(prompt) }];
  return messages || [];
}

const tools=[
  { type:"function", function:{
      name:"check_availability",
      description:"Check Google Calendar availability for a time range.",
      parameters:{ type:"object", properties:{
        start:{type:"string"}, end:{type:"string"},
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

function buildOrigin(req){ const host = process.env.VERCEL_URL || req.headers.host; return host.startsWith("http")?host:`https://${host}`; }
async function postJSON(url, body, extraHeaders={}){
  const r = await fetch(url,{ method:"POST", headers:{ "Content-Type":"application/json", ...extraHeaders }, body:JSON.stringify(body) });
  const text = await r.text();
  let data; try{ data=JSON.parse(text) }catch{ data={ ok:false, error:"invalid_json", raw:text } }
  return { httpOk:r.ok, status:r.status, ...data };
}

async function execTool(req, name, args){
  const origin=buildOrigin(req);
  if(name==="check_availability"){
    const payload={ start:args.start, end:args.end, timeZone:args.timeZone||DEFAULT_TZ, calendarId:args.calendarId||DEFAULT_CAL };
    console.log("[tool] check_availability", payload);
    return await postJSON(`${origin}/api/availability`, payload);
  }
  if(name==="create_hold"){
    const payload={ start:args.start, end:args.end, timeZone:args.timeZone||DEFAULT_TZ, calendarId:args.calendarId||DEFAULT_CAL, summary:args.summary||"DJ hold", description:args.description||"", attendees:Array.isArray(args.attendees)?args.attendees:[], ttlMinutes:Number(args.ttlMinutes||HOLD_TTL_MIN) };
    const headers = AUTH_SECRET ? { Authorization:`Bearer ${AUTH_SECRET}` } : {};
    console.log("[tool] create_hold", { ...payload, attendees:`${payload.attendees.length} emails` });
    return await postJSON(`${origin}/api/hold`, payload, headers);
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
  if (req.method==="GET" && req.query?.q){
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
      const toolResult=await execTool(req, call.function.name, args);

      const second=await client.chat.completions.create({
        model:DEFAULT_MODEL, temperature:TEMPERATURE,
        messages:[
          ...messages,
          { role:"assistant", tool_calls:[call] },
          { role:"tool", tool_call_id:call.id, name:call.function.name, content:JSON.stringify(toolResult) }
        ]
      });

      const content=second.choices?.[0]?.message?.content ?? JSON.stringify(toolResult);
      return res.status(200).json({ ok:true, text:content, content, reply:{role:"assistant",content}, toolResults:[toolResult] });
    }catch(err){
      console.error("[/api/chat GET] error:", err);
      return res.status(500).json({ ok:false, error:err?.message||"server_error" });
    }
  }

  if (req.method!=="POST"){
    res.setHeader("Allow","POST, GET");
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  try{
    const { json, form, raw } = await readBody(req);
    const messages = extractMessages({ json, form, raw, q:req.query?.q });
    if (!Array.isArray(messages) || messages.length===0){
      return res.status(400).json({ ok:false, error:"Missing 'messages' array or a prompt (prompt/text/message/msg/input/content/q)." });
    }

    const client=await getOpenAIClient();

    const first=await client.chat.completions.create({
      model:DEFAULT_MODEL, temperature:TEMPERATURE,
      messages:[ {role:"system",content:systemPrompt}, ...messages ],
      tools, tool_choice:"auto"
    });

    const choice=first.choices?.[0];
    const toolCalls=choice?.message?.tool_calls || [];

    if (!toolCalls.length){
      const content=choice?.message?.content ?? "";
      return res.status(200).json({ ok:true, text:content, content, reply:{role:"assistant",content} });
    }

    // Execute all tool calls and collect results
    const toolMsgs=[]; const toolResults=[];
    for (const tc of toolCalls){
      const args=JSON.parse(tc.function.arguments||"{}");
      const tr=await execTool(req, tc.function.name, args);
      toolResults.push({ name:tc.function.name, args, result:tr });
      toolMsgs.push({ role:"assistant", tool_calls:[tc] });
      toolMsgs.push({ role:"tool", tool_call_id:tc.id, name:tc.function.name, content:JSON.stringify(tr) });
    }

    const second=await client.chat.completions.create({
      model:DEFAULT_MODEL, temperature:TEMPERATURE,
      messages:[ {role:"system",content:systemPrompt}, ...messages, ...toolMsgs ]
    });

    let content = second.choices?.[0]?.message?.content ?? "";
    // If any tool failed, append a concise error note
    const failed = toolResults.find(tr => tr.result?.ok===false || tr.result?.httpOk===false);
    if (failed && !content) {
      content = `Sorry—tool error (${failed.name}): ${failed.result?.error||"unknown"}.`;
    }

    return res.status(200).json({ ok:true, text:content, content, reply:{role:"assistant",content}, toolResults });
  }catch(err){
    console.error("[/api/chat] error:", err);
    return res.status(500).json({ ok:false, error:err?.message||"server_error" });
  }
}
