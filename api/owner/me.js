export const config = { runtime: "nodejs" };

import { requireOwner } from "../_lib/ownerAuth.js";

export default async function handler(req, res) {
  if ((req.method || "GET") !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    requireOwner(req);
    return res.status(200).json({ ok: true, authenticated: true });
  } catch {
    return res.status(401).json({ ok: false, authenticated: false });
  }
}
