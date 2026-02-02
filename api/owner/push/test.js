export const config = { runtime: "nodejs" };

import { requireOwner } from "../../_lib/ownerAuth.js";
import { sendTestPush } from "../../_lib/pushStore.js";

export default async function handler(req, res) {
  if ((req.method || "POST") !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    requireOwner(req);
    const out = await sendTestPush();
    if (!out.ok) return res.status(500).json(out);
    return res.status(200).json(out);
  } catch (err) {
    const status = err?.message === "unauthorized" ? 401 : 500;
    return res.status(status).json({ ok: false, error: err?.message || "server_error" });
  }
}
