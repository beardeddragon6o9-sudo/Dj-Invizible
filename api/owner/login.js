export const config = { runtime: "nodejs" };

import { readBody } from "../_lib/http.js";
import { setOwnerSession, verifyOwnerPassword } from "../_lib/ownerAuth.js";

export default async function handler(req, res) {
  if ((req.method || "POST") !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const body = await readBody(req);
    const password = body?.password;
    if (!password) return res.status(400).json({ ok: false, error: "Missing password." });
    if (!verifyOwnerPassword(password)) {
      return res.status(401).json({ ok: false, error: "Invalid password." });
    }
    setOwnerSession(res);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "server_error" });
  }
}
