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
  `Night block is ${NIGHT_BLOCK_START}-${NIGHT_BLOCK_END}; day block is ${DAY_BLOCK_START}-${DAY_BLOCK_END} (Pacific). ` +
  "If any booking overlaps a block, the entire block is unavailable. " +
  "If a request spans both day and night blocks, both blocks must be free. " +
  "When calling availability, set blockType to 'night', 'day', or 'full' to enforce these blocks. " +
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

function getTimeZoneOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const vals = {};
  for (const part of parts) {
    if (part.type !== "literal") vals[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(vals.year),
    Number(vals.month) - 1,
    Number(vals.day),
    Number(vals.hour),
    Number(vals.minute),
    Number(vals.second)
  );
  return asUtc - date.getTime();
}

function zonedTimeToUtcMs(dateStr, timeStr, timeZone) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = getTimeZoneOffsetMs(utcGuess, timeZone);
  return utcGuess.getTime() - offset;
}

function buildBlockWindow(dateStr, blockType) {
  if (blockType === "day") {
    return {
      start: `${dateStr}T${DAY_BLOCK_START}:00`,
      end: `${dateStr}T${DAY_BLOCK_END}:00`,
    };
  }
  const nextDate = addDaysToDate(dateStr, 1);
  return {
    start: `${dateStr}T${NIGHT_BLOCK_START}:00`,
    end: `${nextDate}T${NIGHT_BLOCK_END}:00`,
  };
}

function extractRanges(raw) {
  const ranges = [];
  const pushRange = (r) => {
    if (r?.start && r?.end) ranges.push({ start: r.start, end: r.end });
  };
  const data = raw?.data || raw;
  if (Array.isArray(data)) data.forEach(pushRange);
  if (Array.isArray(data?.slots)) data.slots.forEach(pushRange);
  if (Array.isArray(data?.ranges)) data.ranges.forEach(pushRange);
  if (Array.isArray(data?.timeRanges)) data.timeRanges.forEach(pushRange);
  if (Array.isArray(data?.availability)) data.availability.forEach(pushRange);
  if (data && typeof data === "object") {
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) value.forEach(pushRange);
    }
  }
  return ranges;
}

function isBlockCovered(raw, blockStartMs, blockEndMs) {
  const ranges = extractRanges(raw);
  for (const range of ranges) {
    const startMs = Date.parse(range.start);
    const endMs = Date.parse(range.end);
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
      if (startMs <= blockStartMs && endMs >= blockEndMs) return true;
    }
  }
  return false;
}

async function checkBlockAvailability({ dateStr, blockType, eventTypeName, timeZone, baseArgs }) {
  const blocks = [];
  const needDay = blockType === "day" || blockType === "full";
  const needNight = blockType === "night" || blockType === "full";
  if (needDay) blocks.push("day");
  if (needNight) blocks.push("night");

  const results = [];
  for (const block of blocks) {
    const window = buildBlockWindow(dateStr, block);
    const blockStartMs = zonedTimeToUtcMs(
      window.start.slice(0, 10),
      window.start.slice(11, 16),
      timeZone
    );
    const blockEndMs = zonedTimeToUtcMs(
      window.end.slice(0, 10),
      window.end.slice(11, 16),
      timeZone
    );
    const raw = await calCheckAvailability({
      ...baseArgs,
      eventTypeName,
      start: window.start,
      end: window.end,
      timeZone,
      format: "range",
    });
    const available = isBlockCovered(raw, blockStartMs, blockEndMs);
    results.push({
      block,
      window,
      available,
    });
  }

  return {
    ok: true,
    blockType,
    date: dateStr,
    blocks: results,
    available: results.every((b) => b.available),
  };
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
        const dateStr = extractDateOnly(args?.start || args?.end);
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


