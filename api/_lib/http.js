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

export async function readBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === "string") return tryJSON(req.body) ?? {};
    if (typeof req.body === "object" && req.body !== null) return req.body;
  }
  const raw = await readRaw(req);
  return tryJSON(raw) ?? {};
}
