// /api/chat.js
// Next.js / Vercel serverless function (JavaScript)

const FRIENDLY = {
  quota: "Out of juice for now — try again later.",
  generic: "I hit a snag. Mind trying again?",
  network: "Network hiccup. Try again.",
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function systemPromptFor(persona) {
  if ((persona || "").toLowerCase() === "maverick") {
    return `You are Midnight Maverick, a friendly, country-themed DJ mascot. Speak casual with a light "yeehaw" vibe, but keep answers concise and helpful. Do not confirm bookings yourself; always say you'll place a tentative hold and wait for DJ confirmation.`;
  }
  // default: Invizible
  return `You are DJ Invizible, an energetic party vibe DJ mascot. Keep replies tight, punchy, and upbeat. Do not confirm bookings yourself; always say you'll place a tentative hold and wait for DJ confirmation.`;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5-mini";

  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      error: "missing_api_key",
      message:
        "Server is missing OPENAI_API_KEY. Add it in Vercel → Settings → Environment Variables.",
    });
  }

  try {
    // Accept either { message, persona } or { messages: [...], persona }
    const body = req.body || {};
    const userMessage = typeof body.message === "string" ? body.message.trim() : "";
    const persona = body.persona || "invizible";

    // Optional lightweight history (array of {role, content}), else single turn
    const history = Array.isArray(body.messages) ? body.messages : [];
    if (!userMessage && history.length === 0) {
      return res.status(400).json({ ok: false, error: "bad_request", message: "Empty message." });
    }

    // Compose messages
    const system = { role: "system", content: systemPromptFor(persona) };
    const turn = userMessage ? [{ role: "user", content: userMessage }] : [];
    const messages = [system, ...history, ...turn];

    // Safety: cap message length to avoid abuse during dev
    if (userMessage && userMessage.length > 6000) {
      return res.status(400).json({ ok: false, error: "message_too_long" });
    }

    // OpenAI Chat Completions
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
      }),
    });

    const isJSON = (r.headers.get("content-type") || "").includes("application/json");
    const data = isJSON ? await r.json() : null;

    if (!r.ok) {
      const code =
        data?.error?.code ||
        (r.status === 429 ? "insufficient_quota" : `http_${r.status}`);
      const friendly =
        code === "insufficient_quota" || code === "quota_exceeded"
          ? FRIENDLY.quota
          : FRIENDLY.generic;

      // Log minimal diagnostics to Vercel logs
      console.error("[chat] OpenAI error:", { status: r.status, code, model });

      return res.status(200).json({
        ok: false,
        error: code,
        message: friendly,
        details: data?.error || null,
      });
    }

    const text = data?.choices?.[0]?.message?.content ?? "";
    const usage = data?.usage || null;

    // Optional: simple usage log for transparency
    if (usage) {
      const inTok = usage.prompt_tokens ?? 0;
      const outTok = usage.completion_tokens ?? 0;
      console.log(
        `[chat] persona=${persona} model=${model} tokens_in=${inTok} tokens_out=${outTok}`
      );
    } else {
      console.log(`[chat] persona=${persona} model=${model} (no usage reported)`);
    }

    return res.status(200).json({
      ok: true,
      provider: "openai",
      model,
      persona,
      message: text,
      usage,
    });
  } catch (err) {
    console.error("[chat] server error:", err);
    return res.status(200).json({
      ok: false,
      error: "server_error",
      message: FRIENDLY.network,
    });
  }
}
