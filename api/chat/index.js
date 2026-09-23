import { BOOKING_ZONE, localDate, blockWindow, hasBlockSlot, eventNameFor } from "../_lib/bookingBlocks.js";
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
const NIGHT_BLOCK_START = "18:00";
const NIGHT_BLOCK_END = "03:00";
const DAY_BLOCK_START = "06:00";
const DAY_BLOCK_END = "16:00";
const systemPrompt =
  "You are DJ Invizible's friendly booking assistant. Your job is to collect and send screening requests, not confirm official Cal.com bookings. " +
  "Keep replies concise and conversational, using details already supplied without asking the user to repeat them. " +
  "Collect event date and a specific time window first, then use cal_check_availability. " +
  "After availability is confirmed, ask only for missing booking details: venue, contact name, one working contact method (email or phone), and payment method. " +
  "A phone number is sufficient if no email is supplied. Preferred start is the beginning of the time window unless the customer specifies otherwise. " +
  "Do not ask for redundant confirmation of a date or time already clearly provided. " +
  "Ask for a single final go-ahead to send the booking request. Once the customer says yes and all required details are present, call create_booking_request immediately. " +
  "Never say a booking request was sent unless the tool reports success. If the tool fails, briefly explain why and ask only for the missing detail, or say sending failed. " +
  "Assume Pacific time; do not ask about time zones. " +
  "For evening/night gigs use eventTypeName " + JSON.stringify(NIGHT_EVENT) + "; for daytime gigs use " + JSON.stringify(DAY_EVENT) + ". " +
  "Night block is " + NIGHT_BLOCK_START + "-" + NIGHT_BLOCK_END + "; day block is " + DAY_BLOCK_START + "-" + DAY_BLOCK_END + ". " +
  "If an event spans day and night blocks, both must be free. Always check availability before sending a request, and ask for alternate dates if unavailable. " +
  "Do not create or cancel an official Cal.com booking.";


const tools = [
  {
    type: "function",
    function: {
      name: "cal_check_availability",
      description: "Check available time slots for a Cal.com event type.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Event date in Pacific time, YYYY-MM-DD. Use the evening date for overnight gigs." },
          start: { type: "string", description: "ISO 8601 start datetime (UTC) or date." },
          end: { type: "string", description: "ISO 8601 end datetime (UTC) or date." },
          timeZone: { type: "string", description: "IANA time zone (e.g. America/Los_Angeles)." },
          duration: { type: "integer", description: "Slot duration in minutes." },
          format: { type: "string", description: "Use 'range' for time ranges." },
          blockType: { type: "string", description: "Use 'day', 'night', or 'full' to enforce DJ block windows." },
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

function extractDateOnly(value) {
  if (!value || typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function addDaysToDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function checkBlockAvailability({ dateStr, blockType }) {
  if (!['day', 'night', 'full'].includes(blockType)) throw new Error('Invalid block type.');
  const blocks = blockType === 'full' ? ['day', 'night'] : [blockType];
  const results = [];
  for (const block of blocks) {
    const window = blockWindow(dateStr, block);
    const raw = await calCheckAvailability({
      eventTypeName: eventNameFor(block),
      start: window.start, end: window.end,
      timeZone: BOOKING_ZONE, format: 'range',
    });
    results.push({ block, window, available: hasBlockSlot(raw, window) });
  }
  return { ok: true, blockType, date: dateStr, blocks: results,
    available: results.every(b => b.available),
    note: 'No suitable slot does not prove an existing booking; schedule or event duration can also prevent availability.' };
}

async function runTool(name, args) {
  switch (name) {
    case "cal_check_availability":
      {
        const timeZone = args?.timeZone || "America/Los_Angeles";
        const eventTypeName = args?.eventTypeName || NIGHT_EVENT;
        const eventName = String(eventTypeName || "").toLowerCase();
        let blockType = args?.blockType;
        if (!blockType) {
          if (eventName.includes("day")) blockType = "day";
          if (eventName.includes("night")) blockType = "night";
        }
        const dateStr = localDate(args?.date || args?.start || args?.end);
        if (blockType && dateStr) {
          return await checkBlockAvailability({
            dateStr,
            blockType,
            eventTypeName,
            timeZone,
            baseArgs: args,
          });
        }

        const start = args?.start;
        let end = args?.end;
        if (extractDateOnly(start) && (!end || extractDateOnly(end) === start)) {
          end = addDaysToDate(start, 1);
        }
        return await calCheckAvailability({
          ...args,
          eventTypeName,
          start,
          end,
          timeZone,
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

// --- Orchestrator: let the model finish availability checks AND request creation in one turn.
async function runChat(messages) {
  const client = await getOpenAIClient();
  const today = localDate(new Date().toISOString());
  const conversation = [
    { role: 'system', content: systemPrompt + '\nToday in Pacific time is ' + today + '.' },
    ...messages.filter(m => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content })),
  ];
  // A tool result must be returned to the model WITH tools still enabled.
  // Otherwise the assistant can promise to send a request without ever calling the store.
  for (let round = 0; round < 6; round += 1) {
    const result = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      temperature: TEMPERATURE,
      messages: conversation,
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: false,
    });
    const reply = result.choices?.[0]?.message;
    if (!reply) throw new Error('Empty AI response.');
    if (!reply.tool_calls?.length) {
      const content = reply.content || '';
      // Never pass through an unsupported claim that a submission is underway.
      if (/(?:i(?:'|’)?(?:ll|m)|i will|we(?:'|’)?(?:ll|re))\s+(?:now\s+)?(?:send|submit|forward|create|call)|(?:sending|submitting|forwarding|creating)\s+(?:the\s+)?(?:booking\s+)?request/i.test(content) &&
          /(?:booking\s+)?request/i.test(content)) {
        return { content: 'I have not submitted a booking request yet. Please ask me to send it again. Only a confirmation with a request ID means it was saved.' };
      }
      return { content: content || 'Sorry, I could not finish that response. Please try again.' };
    }
    conversation.push(reply);
    for (const call of reply.tool_calls) {
      const name = call.function?.name;
      let payload;
      try {
        const args = JSON.parse(call.function?.arguments || '{}');
        if (name === 'create_booking_request') {
          // Re-check the full reservation block immediately before creating the request.
          const block = args.eventTypeName === DAY_EVENT ? 'day' : 'night';
          const check = await checkBlockAvailability({ dateStr: args.date, blockType: block });
          if (!check.available) {
            return { content: 'The reservation block is no longer available, so no request was submitted. Please choose another date.' };
          }
        }
        payload = await runTool(name, args);
        if (name === 'create_booking_request') {
          if (!payload?.ok || !payload.request?.id) throw new Error('Booking request was not confirmed by the database.');
          return {
            content: 'Your booking request was submitted for DJ Invizible to review. It is not a confirmed gig yet. Request ID: ' + payload.request.id + '.',
            requestId: payload.request.id,
          };
        }
      } catch (err) {
        console.error('[chat booking tool]', name, err?.message || 'tool_error');
        if (name === 'create_booking_request') {
          return { content: 'I could not confirm that the request was saved. Please check the owner inbox before retrying. Error: ' + (err?.message || 'tool_error') };
        }
        return { content: 'I could not complete the availability check, and no request was submitted. Please try again later.' };
      }
      conversation.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(payload) });
    }
  }
  return { content: 'I could not finish the booking process this turn. No request was submitted in this turn. Please try again.' };
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


