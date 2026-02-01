export const config = { runtime: "nodejs" };

import { clearOwnerSession } from "../_lib/ownerAuth.js";

export default async function handler(req, res) {
  if ((req.method || "POST") !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  clearOwnerSession(res);
  return res.status(200).json({ ok: true });
}
