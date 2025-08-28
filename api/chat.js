// api/chat.js — Vercel Serverless Function
export default async function handler(req, res) {
  // --- CORS (allow your GitHub Pages origin) ---
  const origin = req.headers.origin || '';
  const allowed = ['https://beardeddragon6o9-sudo.github.io']; // your Pages origin (no trailing slash)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', allowed.includes(origin) ? origin : '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }
  res.setHeader('Access-Control-Allow-Origin', allowed.includes(origin) ? origin : '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { message, persona } = req.body || {};
    if (!message) return res.status(400).json({ error: 'Missing message' });

    const personaSystem =
      persona === 'maverick'
        ? `You are Midnight Maverick, a friendly country-themed DJ persona. Be concise, upbeat, with a touch of yeehaw.
Return ONLY strict JSON like:
{"reply":"<what you would say>","intent":"mixes|shows|book|about|contact|null"}`
        : `You are DJ Invizible’s AI. Confident, concise, bass/breaks vibe.
Return ONLY strict JSON like:
{"reply":"<what you would say>","intent":"mixes|shows|book|about|contact|null"}`;

    // Call OpenAI
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini', // or gpt-4o-mini
        temperature: 0.7,
        max_tokens: 300,
        messages: [
          { role: 'system', content: personaSystem },
          { role: 'user', content: message },
        ],
      }),
    });

    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || '{}';

    // Parse strict JSON; fallback to simple scrape if needed
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const intentMatch = raw.match(/"intent"\s*:\s*"(\w+)"/i);
      const replyMatch = raw.match(/"reply"\s*:\s*"([\s\S]*?)"/i);
      parsed = {
        reply: replyMatch ? replyMatch[1] : raw.replace(/\[intent:[^\]]+\]/i, '').trim(),
        intent: intentMatch ? intentMatch[1] : null,
      };
    }

    const text = typeof parsed.reply === 'string' ? parsed.reply : 'Ok.';
    const intent = typeof parsed.intent === 'string' ? parsed.intent.toLowerCase() : null;

    return res.status(200).json({ text, intent });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'AI error' });
  }
}
