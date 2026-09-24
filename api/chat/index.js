import { BOOKING_ZONE, localDate, blockWindow, hasBlockSlot, eventNameFor } from "../_lib/bookingBlocks.js";
import { calCheckAvailability } from "../_lib/cal.js";
import { createBookingRequest } from "../_lib/requestsStore.js";
import { buildArtistPrompt, artistNameFor, normalizePersona } from "../_lib/artistInfo.js";

export const config = { runtime: "nodejs" };

// --- Config & envs
// The experimental branch defaults to Luna. Production main still defaults to gpt-5-mini.
// An explicitly configured CHAT_MODEL in Vercel always takes precedence.
const DEFAULT_MODEL = process.env.CHAT_MODEL || "gpt-5.6-luna";
const IS_LUNA_EXPERIMENT = DEFAULT_MODEL === "gpt-5.6-luna";
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
const bookingPrompt = `
BOOKING AND AVAILABILITY RULES:
You can check Cal.com availability and save a booking request for owner review; you CANNOT promise, accept, cancel or create a confirmed gig yourself.
Assume Pacific time and understand ordinary language such as "October 10, 9 till 1". Ask a brief clarifying question only if the date or AM/PM is genuinely ambiguous. Overnight performance end times fall on the next day. Never require visitors to write ISO dates or repeat an already clear date/time.
The fixed calendar reservation blocks are separate from customer performance hours: night ${NIGHT_BLOCK_START} to ${NIGHT_BLOCK_END} next day, day ${DAY_BLOCK_START} to ${DAY_BLOCK_END}. Use event type ${JSON.stringify(NIGHT_EVENT)} for nighttime and ${JSON.stringify(DAY_EVENT)} for daytime.
When a visitor supplies a date and performance window, call cal_check_availability (with blockType day or night and the Pacific event date) before reporting availability. A date alone is not enough to know which block they want: ask day or evening when unclear. Only claim availability after a successful tool check, and don't call unavailable time "already booked" unless the tool establishes that.
When the customer wants a booking request, gather only what is missing: venue/address, date, time window, contact name, at least one working contact method (email preferred, phone accepted for screening), and preferred payment method. If only a phone is provided, note that an email will be required later for an official calendar reservation, but don't block submitting the review request.
Infer preferredStart from the beginning of the performance window; keep performance hours distinct from the fixed reservation block. Never invent customer details, address, contact method, price or special event notes.
Avoid repeating a checklist, asking for a timestamp format, reconfirming settled details, or asking more than two short questions in one reply. Do not ask for payment information like card numbers, deposits or banking details: only a preferred method such as cash or e-transfer.
If all required details and the visitor's permission to submit are present, CALL create_booking_request immediately. A clear instruction like "send it", "book me in" in response to a proposed review request, or an initial request to send with full details is sufficient permission. Don't repeatedly ask for approval or narrate that you're sending it.
Recheck availability before creating a booking request. If availability changed or a tool failed, explain accurately. After a successful save, the server itself will return the request ID; do not claim submission or invent an ID without the actual tool result.
For quote-only questions, answer whatever confirmed pricing is available in the knowledge profile. If none is confirmed, tell them the DJ will need to quote the specific event; offer the existing booking-review process only if they want to proceed. Never give a pretend price or claim the DJ personally responded.
Do not create or cancel an official Cal.com booking.`;


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

async function runTool(name, args, persona = "invizible") {
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
        artist: artistNameFor(persona),
        source: "chat",
      });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Luna's reasoning + function tools require the Responses API. Keep the
// Chat Completions path below for the existing GPT-5 Mini fallback.
// Convert the existing tool schemas without changing their parameters.
// strict:false preserves the current optional booking/contact fields.
const lunaTools = tools.map(({ function: fn }) => ({
  type: 'function',
  name: fn.name,
  description: fn.description,
  parameters: fn.parameters,
  strict: false,
}));

function safeChatContent(content) {
  // Never pass through a claim of submission without a verified database ID.
  if (/(?:i(?:'|’)?(?:ll|m)|i will|we(?:'|’)?(?:ll|re))\s+(?:now\s+)?(?:send|submit|forward|create|call)|(?:sending|submitting|forwarding|creating)\s+(?:the\s+)?(?:booking\s+)?request/i.test(content) &&
      /(?:booking\s+)?request/i.test(content)) {
    return 'I have not submitted a booking request yet. Please ask me to send it again. Only a confirmation with a request ID means it was saved.';
  }
  return content || 'Sorry, I could not finish that response. Please try again.';
}

async function runLunaChat(messages, selectedPersona = 'invizible') {
  const persona = normalizePersona(selectedPersona);
  const client = await getOpenAIClient();
  const today = localDate(new Date().toISOString());
  const input = [
    { role: 'system', content: buildArtistPrompt(persona) + '\n' + bookingPrompt + '\nToday in Pacific time is ' + today + '.' },
    ...messages.filter(m => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content })),
  ];

  for (let round = 0; round < 6; round += 1) {
    const result = await client.responses.create({
      model: DEFAULT_MODEL,
      reasoning: { effort: 'low' },
      // Carry encrypted reasoning between stateless function-call turns.
      include: ['reasoning.encrypted_content'],
      input,
      tools: lunaTools,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      store: false,
    });
    if (result.status === 'incomplete' || result.status === 'failed') {
      throw new Error('Luna could not complete the response.');
    }
    const output = Array.isArray(result.output) ? result.output : [];
    const calls = output.filter(item => item.type === 'function_call');
    if (!calls.length) {
      // output_text is an SDK convenience field. The fallback also works
      // with a plain response and avoids exposing non-text reasoning items.
      const content = result.output_text || output
        .filter(item => item.type === 'message')
        .flatMap(item => item.content || [])
        .filter(item => item.type === 'output_text')
        .map(item => item.text)
        .join('\n');
      return { content: safeChatContent(content) };
    }
    // Return EVERY response item, including reasoning, along with the tool
    // output. This is required for stateless reasoning/function-call turns.
    input.push(...output);
    for (const call of calls) {
      const name = call.name;
      let payload;
      try {
        const args = JSON.parse(call.arguments || '{}');
        if (name === 'create_booking_request') {
          const block = args.eventTypeName === DAY_EVENT ? 'day' : 'night';
          const check = await checkBlockAvailability({ dateStr: args.date, blockType: block });
          if (!check.available) {
            return { content: 'The reservation block is no longer available, so no request was submitted. Please choose another date.' };
          }
        }
        payload = await runTool(name, args, persona);
        if (name === 'create_booking_request') {
          if (!payload?.ok || !payload.request?.id) throw new Error('Booking request was not confirmed by the database.');
          return {
            content: 'Your booking request was submitted for ' + artistNameFor(persona) + ' to review. It is not a confirmed gig yet. Request ID: ' + payload.request.id + '.',
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
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(payload) });
    }
  }
  return { content: 'I could not finish the booking process this turn. No request was submitted in this turn. Please try again.' };
}

// --- Orchestrator: let the model finish availability checks AND request creation in one turn.
async function runChat(messages, selectedPersona = "invizible") {
  if (IS_LUNA_EXPERIMENT) return runLunaChat(messages, selectedPersona);
  const persona = normalizePersona(selectedPersona);
  const client = await getOpenAIClient();
  const today = localDate(new Date().toISOString());
  const conversation = [
    { role: 'system', content: buildArtistPrompt(persona) + '\n' + bookingPrompt + '\nToday in Pacific time is ' + today + '.' },
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
        payload = await runTool(name, args, persona);
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
      const out = await runChat([{ role:"user", content: String(req.query.q) }], req.query?.persona);
      return res.status(200).json({ ok:true, model: DEFAULT_MODEL, text: out.content, content: out.content, reply:{role:"assistant",content:out.content} });
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
    const out = await runChat(messages, body?.persona);
    return res.status(200).json({ ok:true, model: DEFAULT_MODEL, text: out.content, content: out.content, reply:{role:"assistant",content:out.content} });
  } catch (err) {
    return res.status(500).json({ ok:false, error: err?.message || "server_error" });
  }
}


