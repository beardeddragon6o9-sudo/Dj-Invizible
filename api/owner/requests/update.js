export const config = { runtime: "nodejs" };

import { readBody } from "../../_lib/http.js";
import { requireOwner } from "../../_lib/ownerAuth.js";
import {
  getBookingRequest,
  updateBookingRequest,
} from "../../_lib/requestsStore.js";
import { calCancelBooking, calCreateBooking } from "../../_lib/cal.js";

function nowIso() {
  return new Date().toISOString();
}

export default async function handler(req, res) {
  if ((req.method || "POST") !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    requireOwner(req);
    const body = await readBody(req);
    const id = body?.id;
    const action = body?.action;
    if (!id || !action) {
      return res.status(400).json({ ok: false, error: "Missing id or action." });
    }

    const request = await getBookingRequest(id);
    if (!request) return res.status(404).json({ ok: false, error: "Request not found." });

    if (action === "approve") {
      const start = body?.start;
      if (!start) return res.status(400).json({ ok: false, error: "Missing start time." });
      if (!request.contactEmail) {
        return res.status(400).json({ ok: false, error: "Contact email required to book." });
      }

      let booking;
      try {
        booking = await calCreateBooking({
          start,
          attendee: {
            name: request.contactName,
            email: request.contactEmail,
            timeZone: "America/Los_Angeles",
            phoneNumber: request.contactPhone,
          },
          eventTypeName: request.eventTypeName,
          metadata: {
            requestId: request.id,
            venue: request.venue,
            timeWindow: request.timeWindow,
            preferredStart: request.preferredStart,
            paymentMethod: request.paymentMethod,
            notes: request.notes,
          },
        });
      } catch (err) {
        const failed = await updateBookingRequest(id, {
          status: "booking_failed",
          bookingError: err?.message || "booking_failed",
        });
        return res.status(500).json({ ok: false, error: err?.message || "booking_failed", request: failed });
      }

      const bookingUid = booking?.data?.uid || booking?.uid;
      const updated = await updateBookingRequest(id, {
        status: "booked",
        approvedAt: nowIso(),
        start,
        booking,
        bookingUid,
      });
      return res.status(200).json({ ok: true, request: updated });
    }

    if (action === "decline") {
      const updated = await updateBookingRequest(id, {
        status: "declined",
        declinedAt: nowIso(),
        declineReason: body?.reason,
      });
      return res.status(200).json({ ok: true, request: updated });
    }

    if (action === "cancel") {
      const bookingUid =
        body?.bookingUid || request?.bookingUid || request?.booking?.uid || request?.booking?.data?.uid;
      if (!bookingUid) {
        return res.status(400).json({ ok: false, error: "Missing bookingUid to cancel." });
      }
      await calCancelBooking({
        bookingUid,
        cancellationReason: body?.reason,
      });
      const updated = await updateBookingRequest(id, {
        status: "canceled",
        canceledAt: nowIso(),
        cancelReason: body?.reason,
      });
      return res.status(200).json({ ok: true, request: updated });
    }

    return res.status(400).json({ ok: false, error: "Invalid action." });
  } catch (err) {
    const status = err?.message === "unauthorized" ? 401 : 500;
    return res.status(status).json({ ok: false, error: err?.message || "server_error" });
  }
}
