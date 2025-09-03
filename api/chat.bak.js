// /api/chat.js
// Final optimized version — GPT-5 Mini safe, persona-aware, and stable.

const FRIENDLY = {
  quota: "Out of juice for now — try again later.",
  generic: "I hit a snag. Mind trying again?",
  network: "Network hiccup. Try again.",
  bad: "Empty message. What should I say?",
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function systemPromptFor(persona) {
  const p = (persona || "").toLowerCase();
  if (p === "maverick") {
    return `
      You are Midnight Maverick, a country-themed DJ mascot.
      - Tone: warm, laid-back, friendly "yeehaw" vibe.
      - Be casual and conversational, but keep answers concise.
      - Do NOT confirm bookings yourself. Instead, suggest placing a tentative hold and notify DJ Invizible.
    `;
  }
  // Default → DJ Invizible
  return `
    You are DJ Invizible, an energetic bass/breaks DJ mascot.
    - Tone: hype, punchy, fun, and upbeat.
    - Be lively and expressive, but keep replies relevant.
    - Do NOT confirm bookings yourself. Instead, suggest placing a tentative hold and notify DJ Invizible.
  `;
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
    const body = req.body || {};
    const persona = body.persona || "invizible";
    const single = typeof body.message === "string" ? body.message.trim() : "";
    const history = Array.isArray(body.messages) ? body.messages : [];

    if (!single && history.length === 0) {
      return res.status(400).json({ ok: false, error: "bad_request", message: FRIENDLY.bad });
    }
    if (single && single.length > 6000) {
      return res.status(400).json({ ok: false, error: "message_too_long" });
    }

    // Build messages: system + prior history + current message
    const system = { role: "system", content: systemPromptFor(persona) };
    const turn = single ? [{ role: "user", content: single }] : [];
    const messages = [system, ...history, ...turn];

    // Call OpenAI GPT-5 Mini — no unsupported params
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        // No temperature, no max_tokens → GPT-5 Mini auto-handles
      }),
    });

    const isJSON = (r.headers.get("content-type") || "").includes("application/json");
    const data = isJSON ? await r.json() : null;

    if (!r.ok) {
      const code =
        data?.error?.code ||
        (r.status === 429 ? "insufficient_quota" : `http_${r.status}`);
      const msgRaw = data?.error?.message || "";
      let friendly = FRIENDLY.generic;

      if (code === "insufficient_quota" || code === "quota_exceeded") {
        friendly = FRIENDLY.quota;
      }

      console.error("[chat] OpenAI error:", { status: r.status, code, model, msg: msgRaw });

      return res.status(200).json({
        ok: false,
        error: code,
        message: friendly,
        details: data?.error || null,
      });
    }

    const text = data?.choices?.[0]?.message?.content ?? "";
    const usage = data?.usage || null;

    // Log usage stats in Vercel logs for visibility
    if (usage) {
      console.log(
        `[chat] persona=${persona} model=${model} prompt=${usage.prompt_tokens ?? 0} output=${usage.completion_tokens ?? 0} total=${usage.total_tokens ?? 0}`
      );
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
