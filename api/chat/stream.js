import OpenAI from "openai";
export const config = { runtime: "nodejs" };

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DEFAULT_MODEL = process.env.CHAT_MODEL || "gpt-4o-mini";
const TEMPERATURE = Number(process.env.CHAT_TEMPERATURE || "0.9");

async function readJson(req) {
  try {
    if (req.body !== undefined) {
      if (typeof req.body === "string") return JSON.parse(req.body || "{}");
      if (typeof req.body === "object") return req.body || {};
    }
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}
function sseWrite(res, obj) { res.write(\`data: \${JSON.stringify(obj)}\\n\\n\`); }

export default async function handler(req, res) {
  if (req.method !== "POST" && !(req.method === "GET" && req.query?.q)) {
    res.setHeader("Allow", "POST, GET");
    return res.status(405).end("Method Not Allowed");
  }

  sseHeaders(res);

  try {
    let body = {};
    if (req.method === "POST") body = await readJson(req);

    // Accept multiple shapes
    const q = req.query?.q;
    const prompt = body?.prompt || body?.text || (typeof body === "string" ? body : null) || q;
    let messages = Array.isArray(body?.messages) ? body.messages : [];
    if (!messages.length && prompt) {
      messages = [{ role: "user", content: String(prompt) }];
    }

    const system = body?.system;
    const model = body?.model || DEFAULT_MODEL;

    if (!Array.isArray(messages) || messages.length === 0) {
      sseWrite(res, { error: "Missing 'messages' array or 'prompt'/'text'/'q'." });
      sseWrite(res, { done: true });
      return res.end();
    }

    const chatMessages = [];
    if (system) chatMessages.push({ role: "system", content: String(system) });
    for (const m of messages) if (m?.role && m?.content != null) {
      chatMessages.push({ role: String(m.role), content: String(m.content) });
    }

    const stream = await client.chat.completions.create({
      model,
      messages: chatMessages,
      temperature: TEMPERATURE,
      stream: true,
    });

    for await (const part of stream) {
      const delta = part?.choices?.[0]?.delta?.content || "";
      if (delta) sseWrite(res, { delta });
    }
    sseWrite(res, { done: true });
    res.end();
  } catch (err) {
    console.error("[/api/chat/stream] error:", err);
    try { sseWrite(res, { error: err?.message || "server_error" }); sseWrite(res, { done: true }); }
    finally { res.end(); }
  }
}
