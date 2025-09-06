import OpenAI from "openai";

// Explicit Node runtime (required for res.write on Vercel)
export const config = { runtime: "nodejs" };

// --- helpers ---
async function readJson(req) {
  // Works whether req.body exists or not
  try {
    if (req.body !== undefined) {
      if (typeof req.body === "string") return JSON.parse(req.body || "{}");
      if (typeof req.body === "object") return req.body || {};
    }
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

function sseWrite(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// --- handler ---
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// if CHAT_MODEL is set, prefer it; otherwise fall back to a widely-available default
const DEFAULT_MODEL = process.env.CHAT_MODEL || "gpt-4o-mini";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  // Always set SSE headers before doing work
  sseHeaders(res);

  try {
    const body = await readJson(req);
    const { messages = [], system, model } = body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      sseWrite(res, { error: "Missing 'messages' array in JSON body." });
      sseWrite(res, { done: true });
      return res.end();
    }

    const chatMessages = [];
    if (system) chatMessages.push({ role: "system", content: String(system) });
    for (const m of messages) {
      if (m && m.role && m.content != null) {
        chatMessages.push({ role: String(m.role), content: String(m.content) });
      }
    }

    const stream = await client.chat.completions.create({
      model: model || DEFAULT_MODEL,
      messages: chatMessages,
      temperature: TEMPERATURE,
      stream: true,
    });const TEMPERATURE = Number(process.env.CHAT_TEMPERATURE || "0.9");


    for await (const part of stream) {
      const delta = part?.choices?.[0]?.delta?.content || "";
      if (delta) sseWrite(res, { delta });
    }

    sseWrite(res, { done: true });
    res.end();
  } catch (err) {
    console.error("[/api/chat/stream] error:", err);
    // Send error to the client over SSE so you actually see it
    try { sseWrite(res, { error: err?.message || "server_error" }); sseWrite(res, { done: true }); }
    finally { res.end(); }
  }
}
