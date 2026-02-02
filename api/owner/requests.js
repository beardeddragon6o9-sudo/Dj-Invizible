export const config = { runtime: "nodejs" };

import { requireOwner } from "../_lib/ownerAuth.js";
import { listBookingRequests, storeInfo } from "../_lib/requestsStore.js";

export default async function handler(req, res) {
  if ((req.method || "GET") !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    requireOwner(req);
    const includeCanceled = String(req.query?.includeCanceled || "") === "1";
    let items = await listBookingRequests();
    if (!includeCanceled) {
      items = items.filter((item) => item?.status !== "canceled");
    }
    return res.status(200).json({ ok: true, items, store: storeInfo() });
  } catch (err) {
    const status = err?.message === "unauthorized" ? 401 : 500;
    return res.status(status).json({ ok: false, error: err?.message || "server_error" });
  }
}
