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
const systemPrompt = "You are DJ Invizible's assistant.";

// --- Orchestrator
async function runChat(messages){
  const client = await getOpenAIClient();
  const result = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    temperature: TEMPERATURE,
    messages: [{role:"system", content: systemPrompt}, ...messages],
  });
  const content = result.choices?.[0]?.message?.content ?? "";
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
