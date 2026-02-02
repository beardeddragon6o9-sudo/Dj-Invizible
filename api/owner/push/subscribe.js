export const config = { runtime: "nodejs" };

import { readBody } from "../../_lib/http.js";
import { requireOwner } from "../../_lib/ownerAuth.js";
import { saveSubscription } from "../../_lib/pushStore.js";

export default async function handler(req, res) {
  if ((req.method || "POST") !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    requireOwner(req);
    const body = await readBody(req);
    const subscription = body?.subscription || body;
    const out = await saveSubscription(subscription);
    return res.status(200).json({ ok: true, ...out });
  } catch (err) {
    const status = err?.message === "unauthorized" ? 401 : 500;
    return res.status(status).json({ ok: false, error: err?.message || "server_error" });
  }
}
