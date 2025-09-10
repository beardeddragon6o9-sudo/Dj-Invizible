export const config = { runtime: "nodejs" };

const DEFAULT_MODEL = process.env.CHAT_MODEL || "gpt-4o-mini";
const TEMPERATURE   = Number(process.env.CHAT_TEMPERATURE || "0.9");

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

async function readBody(req) {
  // Try to honor what Vercel gives us, else parse raw
  if (req.body !== undefined) {
    if (typeof req.body === "string") return { raw: req.body, json: tryJSON(req.body), form: tryForm(req.body) };
    if (typeof req.body === "object" && req.body !== null) return { raw: "", json: req.body, form: null };
  }
  const raw = await readRaw(req);
  return { raw, json: tryJSON(raw), form: tryForm(raw) };
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

function extractMessages({ json, form, raw, q }) {
  // Accept LOTS of keys so legacy code "just works"
  const pick = (o, keys) => o ? keys.map(k => o[k]).find(v => v != null && v !== "") : null;

  // 1) If messages array present, use it
  let messages = Array.isArray(json?.messages) ? json.messages : null;

  // 2) Otherwise, build a single-user message from any reasonable key
  const prompt =
    q ||
    pick(json, ["prompt","text","message","msg","input","content","q","query"]) ||
    pick(form, ["prompt","text","message","msg","input","content","q","query"]) ||
    (typeof json === "string" ? json : null) ||
    (raw && raw.trim().startsWith("{") ? null : raw); // bare text

  if (!messages && prompt) {
    messages = [{ role: "user", content: String(prompt) }];
  }

  return messages || [];
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    // allow simple GET test: /api/chat?q=hello
    const q = req.query?.q;
    if (!q) return res.status(405).json({ ok:false, error:"method_not_allowed" });
    return respond({ res, messages: [{ role:"user", content:String(q) }] });
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

    return respond({ res, messages, system: json?.system, model: json?.model });
  } catch (err) {
    console.error("[/api/chat] parse error:", err);
    return res.status(500).json({ ok:false, error: err?.message || "server_error" });
  }
}

async function respond({ res, messages, system, model }) {
  try {
    const client = await getOpenAIClient();

    const chatMessages = [];
    if (system) chatMessages.push({ role:"system", content:String(system) });
    for (const m of messages) if (m?.role && m?.content != null) {
      chatMessages.push({ role:String(m.role), content:String(m.content) });
    }

    const completion = await client.chat.completions.create({
      model: model || DEFAULT_MODEL,
      messages: chatMessages,
      temperature: TEMPERATURE,
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    return res.status(200).json({
      ok: true,
      text: content,
      content,
      reply: { role:"assistant", content },
    });
  } catch (err) {
    console.error("[/api/chat] openai error:", err);
    return res.status(500).json({ ok:false, error: err?.message || "server_error" });
  }
}
