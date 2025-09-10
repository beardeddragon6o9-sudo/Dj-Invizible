export const config = { runtime: "nodejs" };

const DEFAULT_MODEL = process.env.CHAT_MODEL || "gpt-4o-mini";
const TEMPERATURE   = Number(process.env.CHAT_TEMPERATURE || "0.9");

async function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const { default: OpenAI } = await import("openai"); // dynamic import avoids cold-start crash
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

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
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const body = await readJson(req);

    // Accept multiple shapes: {messages}, {prompt}, {text}, bare string
    let messages = Array.isArray(body?.messages) ? body.messages : [];
    const prompt = body?.prompt || body?.text || (typeof body === "string" ? body : null);

    if (!messages.length && prompt) {
      messages = [{ role: "user", content: String(prompt) }];
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ ok: false, error: "Missing 'messages' array or 'prompt'/'text'." });
    }

    const system = body?.system;
    const model  = body?.model || DEFAULT_MODEL;

    const chatMessages = [];
    if (system) chatMessages.push({ role: "system", content: String(system) });
    for (const m of messages) {
      if (m?.role && m?.content != null) {
        chatMessages.push({ role: String(m.role), content: String(m.content) });
      }
    }

    const client = await getOpenAIClient();

    const completion = await client.chat.completions.create({
      model,
      messages: chatMessages,
      temperature: TEMPERATURE,
    });

    const reply = completion.choices?.[0]?.message?.content ?? "";
    // Return a generous shape so your legacy code can pick any of these:
    return res.status(200).json({
      ok: true,
      text: reply,
      content: reply,
      reply: { role: "assistant", content: reply },
    });
  } catch (err) {
    console.error("[/api/chat] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "server_error" });
  }
}
