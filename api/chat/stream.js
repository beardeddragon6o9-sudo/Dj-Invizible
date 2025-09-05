import OpenAI from "openai";
export const config = { runtime: "nodejs" }; // enables res.write in Vercel

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DEFAULT_MODEL = process.env.CHAT_MODEL || "gpt5-mini";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  const { messages = [], system, model } = req.body || {};
  const chatMessages = [];
  if (system) chatMessages.push({ role: "system", content: system });
  for (const m of messages) chatMessages.push({ role: m.role, content: m.content });

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  try {
    const stream = await client.chat.completions.create({
      model: model || DEFAULT_MODEL,
      messages: chatMessages,
      stream: true,
    });

    for await (const part of stream) {
      const delta = part.choices?.[0]?.delta?.content || "";
      if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error(err);
    try { res.write(`data: ${JSON.stringify({ error: err.message || "server_error" })}\n\n`); }
    finally { res.end(); }
  }
}
