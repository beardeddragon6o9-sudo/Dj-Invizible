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
const systemPrompt = `You are DJ Doom, DJ Invizible's friendly website assistant.
Talk naturally and briefly. A greeting gets a greeting and an open offer to help, not a booking questionnaire.
Answer the visitor's actual question first. Do not invent prices, shows, links, services, or personal facts.
Only start booking intake when the visitor asks about booking or availability.
Accept everyday dates and times, such as "October 2, 9pm until 1am". Convert formats internally.
Assume Pacific time. Treat an overnight end time as the following day. Ask only when genuinely ambiguous.
Do not ask for YYYY-MM-DD, 24-hour time, or repeated confirmation of already supplied information.
For availability collect the event date and performance time window, then call cal_check_availability.
Include date as the Pacific evening/event date (YYYY-MM-DD), and start/end as date strings or UTC timestamps.
Use blockType day, night, or full. Day is ${DAY_BLOCK_START}-${DAY_BLOCK_END}; night is ${NIGHT_BLOCK_START}-${NIGHT_BLOCK_END} next day.
Use eventTypeName "${DAY_EVENT}" for daytime and "${NIGHT_EVENT}" for nighttime.
These are calendar reservation blocks; keep the customer's performance hours separate.
Only claim availability from a successful tool result. A missing slot does not prove a conflicting booking.
For a booking request collect venue/address, event date, time window, contact name, email, and payment method.
Phone is optional. Infer preferredStart from the supplied time window. Never invent missing details.
Ask only for missing information, with at most two short questions per reply. Do not repeatedly print a full checklist.
You CAN submit an owner-review request with create_booking_request. You CANNOT create an official confirmed booking.
Once the details are complete, summarize briefly and ask permission ONCE if permission has not already been given.
"Yes", "send it", and "please create the request" in response to your offer are sufficient permission.
If the visitor supplies the final missing detail together with permission, proceed immediately without asking again.
Recheck availability and then call create_booking_request in the same turn. Do not ask for permission again after rechecking.
Never claim a request was sent, drafted externally, or failed without a corresponding tool result.
After successful submission, explain it is pending DJ Invizible's approval, not a confirmed booking.
If a tool reports an error, explain briefly without guessing its cause. Do not repeat a failed submission automatically.
Do not add notes such as "standard set" unless the visitor actually supplied them.`;


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

// --- Orchestrator
async function runChat(messages) {
  const client = await getOpenAIClient();
  const today = localDate(new Date().toISOString());
  const conversation = [{ role: 'system', content: systemPrompt + `\nToday's Pacific date is ${today}.` },
    ...messages.filter(m => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content }))];
  for (let round = 0; round < 6; round++) {
    const result = await client.chat.completions.create({
      model: DEFAULT_MODEL, temperature: TEMPERATURE,
      messages: conversation, tools, tool_choice: 'auto', parallel_tool_calls: false,
    });
    const reply = result.choices?.[0]?.message;
    if (!reply) throw new Error('Empty AI response.');
    if (!reply.tool_calls?.length) return { content: reply.content || 'Sorry, I could not finish that response. Please try again.' };
    conversation.push(reply);
    for (const call of reply.tool_calls) {
      const name = call.function?.name;
      let payload;
      try {
        const args = JSON.parse(call.function?.arguments || '{}');
        if (name === 'create_booking_request') {
          const block = args.eventTypeName === DAY_EVENT ? 'day' : 'night';
          const check = await checkBlockAvailability({dateStr: args.date, blockType: block});
          if (!check.available) return { content: 'I could not submit the request because the full reservation block is no longer available. No request was created.' };
        }
        payload = await runTool(name, args);
        if (name === 'create_booking_request') {
          if (!payload?.ok || !payload.request?.id) throw new Error('Request store did not confirm a saved request.');
          return { content: `Your booking request has been submitted for DJ Invizible to review. It is not a confirmed booking yet. Reference: ${payload.request.id}` };
        }
      } catch (err) {
        const reference = `chat-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
        let detail = String(err?.message || 'tool_error');
        for (const [key, value] of Object.entries(process.env)) {
          if (value && /KEY|TOKEN|SECRET|PASSWORD|URL/.test(key)) detail = detail.split(value).join('[redacted]');
        }
        console.error('[chat-tool-error]', JSON.stringify({ reference, tool: name, error: detail }));
        return { content: name === 'create_booking_request'
          ? `I could not confirm that your request was saved. Please contact DJ Invizible or have the owner check the inbox before retrying. Error reference: ${reference}`
          : `I could not complete the availability check. Please try again later. Error reference: ${reference}` };
      }
      conversation.push({role: 'tool', tool_call_id: call.id, content: JSON.stringify(payload)});
    }
  }
  return { content: 'I could not finish processing this request. No booking request was submitted in this turn. Please try again.' };
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


