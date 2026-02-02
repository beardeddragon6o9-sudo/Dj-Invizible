export const config = { runtime: "nodejs" };

import { getPublicVapidKey } from "../../_lib/pushStore.js";

export default async function handler(req, res) {
  if ((req.method || "GET") !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const key = getPublicVapidKey();
  if (!key) return res.status(500).json({ ok: false, error: "Missing VAPID_PUBLIC_KEY." });
  return res.status(200).json({ ok: true, publicKey: key });
}
