import { calCheckAvailability } from "../_lib/cal.js";
import { createBookingRequest } from "../_lib/requestsStore.js";

export const config = { runtime: "nodejs" };

// --- Config & envs
const DEFAULT_MODEL = process.env.CHAT_MODEL || "gpt-5-mini";
function _safeTemp(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.7;      // default
  return Math.max(0, Math.min(2, n));       // clamp 0..2
}
const TEMPERATURE   = _safeTemp(process.env.CHAT_TEMPERATURE);

// --- OpenAI client (ESM)
async function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// --- tiny utils
async function readRaw(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  return Buffer.concat(chunks).toString("utf8");
}
function tryJSON(s){ try { return s ? JSON.parse(s) : null } catch { return null } }
async function readBody(req){
  if (req.body !== undefined) {
    if (typeof req.body === "string") return tryJSON(req.body) ?? {};
    if (typeof req.body === "object" && req.body !== null) return req.body;
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
const NIGHT_EVENT = process.env.CAL_EVENT_TYPE_NAME || "Night gig";
const DAY_EVENT = process.env.CAL_EVENT_TYPE_NAME_DAY || "Day time DJ";
const systemPrompt =
  "You are DJ Invizible's assistant. " +
  "Your goal is to screen booking requests, not create official bookings. " +
  "First collect only the date and a specific time window; do not claim availability without a time window. " +
  "Do not list the full required details until after availability is confirmed. " +
  "Then check availability for that window and only proceed if slots are available. " +
  "Collect: venue, date, time window, preferred start time, contact name, contact phone or email (email required to finalize booking), and preferred payment method. " +
  "Assume Pacific time; do not ask about time zones or display them. " +
  "Ask: \"Want me to create a booking request to DJ Invizible?\" before sending. " +
  "When scheduling, choose the Cal.com event type based on intent: " +
  `use eventTypeName \"${NIGHT_EVENT}\" for evening/night gigs (default), ` +
  `use eventTypeName \"${DAY_EVENT}\" for daytime/morning/afternoon gigs. ` +
  "Always check availability before sending a booking request. " +
  "If no slots are available, ask for alternate dates or times. " +
  "You may check availability, but do not create or cancel bookings.";


const tools = [
  {
    type: "function",
    function: {
      name: "cal_check_availability",
      description: "Check available time slots for a Cal.com event type.",
      parameters: {
        type: "object",
        properties: {
          start: { type: "string", description: "ISO 8601 start datetime (UTC) or date." },
          end: { type: "string", description: "ISO 8601 end datetime (UTC) or date." },
          timeZone: { type: "string", description: "IANA time zone (e.g. America/Los_Angeles)." },
          duration: { type: "integer", description: "Slot duration in minutes." },
          format: { type: "string", description: "Use 'range' for time ranges." },
          bookingUidToReschedule: { type: "string" },
          eventTypeId: { type: "integer" },
          eventTypeSlug: { type: "string" },
          eventTypeName: { type: "string" },
          username: { type: "string" },
          teamSlug: { type: "string" },
          organizationSlug: { type: "string" },
        },
        required: ["start", "end"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_booking_request",
      description: "Create a booking request for DJ Invizible (screening only).",
      parameters: {
        type: "object",
        properties: {
          eventTypeName: { type: "string" },
          venue: { type: "string" },
          date: { type: "string", description: "Event date in Pacific time (YYYY-MM-DD)." },
          timeWindow: { type: "string", description: "Preferred time window in Pacific time." },
          preferredStart: { type: "string", description: "Preferred start time in Pacific time." },
          contactName: { type: "string" },
          contactEmail: { type: "string" },
          contactPhone: { type: "string" },
          paymentMethod: { type: "string" },
          notes: { type: "string" },
        },
        required: ["venue", "date", "timeWindow", "contactName", "paymentMethod"],
      },
    },
  },
];

async function runTool(name, args) {
  switch (name) {
    case "cal_check_availability":
      {
        const start = args?.start;
        let end = args?.end;
        const isDateOnly = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
        const addDays = (s, days) => {
          const d = new Date(`${s}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + days);
          return d.toISOString().slice(0, 10);
        };
        if (isDateOnly(start) && (!end || (isDateOnly(end) && end === start))) {
          end = addDays(start, 1);
        }
        return await calCheckAvailability({
          ...args,
          start,
          end,
          timeZone: args?.timeZone || "America/Los_Angeles",
        });
      }
    case "create_booking_request":
      return await createBookingRequest({
        eventTypeName: args?.eventTypeName || NIGHT_EVENT,
        venue: args?.venue,
        date: args?.date,
        timeWindow: args?.timeWindow,
        preferredStart: args?.preferredStart,
        contactName: args?.contactName,
        contactEmail: args?.contactEmail,
        contactPhone: args?.contactPhone,
        paymentMethod: args?.paymentMethod,
        notes: args?.notes,
        source: "chat",
      });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// --- Orchestrator
async function runChat(messages){
  const client = await getOpenAIClient();
  const result = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    temperature: TEMPERATURE,
    messages: [{role:"system", content: systemPrompt}, ...messages],
    tools,
    tool_choice: "auto",
  });

  const first = result.choices?.[0]?.message;
  if (!first?.tool_calls?.length) {
    const content = first?.content ?? "";
    return { content };
  }

  const toolMessages = [];
  for (const call of first.tool_calls) {
    const name = call?.function?.name;
    let args = {};
    try {
      args = call?.function?.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      args = {};
    }
    let payload;
    try {
      payload = await runTool(name, args);
    } catch (err) {
      payload = { ok: false, error: err?.message || "tool_error" };
    }
    toolMessages.push({
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(payload),
    });
  }

  const followup = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    temperature: TEMPERATURE,
    messages: [{role:"system", content: systemPrompt}, ...messages, first, ...toolMessages],
  });
  const content = followup.choices?.[0]?.message?.content ?? "";
  return { content };
}

// --- Handler
export default async function handler(req, res){
  const method = req.method || "GET";

  // Simple GET probe: /api/chat?q=hello
  if (method === "GET" && req.query?.q) {
    try {
      const out = await runChat([{ role:"user", content: String(req.query.q) }]);
      return res.status(200).json({ ok:true, text: out.content, content: out.content, reply:{role:"assistant",content:out.content} });
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
    const out = await runChat(messages);
    return res.status(200).json({ ok:true, text: out.content, content: out.content, reply:{role:"assistant",content:out.content} });
  } catch (err) {
    return res.status(500).json({ ok:false, error: err?.message || "server_error" });
  }
}


