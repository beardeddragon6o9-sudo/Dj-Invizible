export const config = { runtime: "nodejs" };

import { calCreateBooking } from "../_lib/cal.js";

async function readRaw(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  return Buffer.concat(chunks).toString("utf8");
}
function tryJSON(s) {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
async function readBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === "string") return tryJSON(req.body) ?? {};
    if (typeof req.body === "object" && req.body !== null) return req.body;
  }
  const raw = await readRaw(req);
  return tryJSON(raw) ?? {};
}

export default async function handler(req, res) {
  const method = req.method || "POST";
  if (method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const body = await readBody(req);
    const data = await calCreateBooking(body);
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "server_error" });
  }
}
