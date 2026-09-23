import { BOOKING_ZONE, blockWindow, hasBlockSlot, eventNameFor } from "../../_lib/bookingBlocks.js";
export const config = { runtime: "nodejs" };

import { readBody } from "../../_lib/http.js";
import { requireOwner } from "../../_lib/ownerAuth.js";
import {
  getBookingRequest,
  updateBookingRequest,
} from "../../_lib/requestsStore.js";
import { calCancelBooking, calCreateBooking, calCheckAvailability } from "../../_lib/cal.js";

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
      const performanceStart = body?.start;
      const eventTypeName = request.eventTypeName;
      const block = eventTypeName === eventNameFor('day') ? 'day' : eventTypeName === eventNameFor('night') ? 'night' : null;
      if (!block) return res.status(400).json({ ok: false, error: 'Unknown event type; check the request before approving.' });
      const window = blockWindow(request.date, block);
      const start = window.start;
      const performanceMs = Date.parse(performanceStart);
      if (!Number.isFinite(performanceMs) || performanceMs < Date.parse(start) || performanceMs >= Date.parse(window.end)) {
        return res.status(400).json({ ok: false, error: 'Performance start must be inside the event date’s reservation block.' });
      }
      if (request.bookingUid || request.status === 'booked') {
        return res.status(409).json({ ok: false, error: 'This request already has a booking.' });
      }
      if (request.status === 'booking_pending') {
        return res.status(409).json({ ok: false, error: 'Check Cal.com for the previous booking attempt before retrying.' });
      }
      const available = await calCheckAvailability({ start, end: window.end, timeZone: BOOKING_ZONE, eventTypeName, format: 'range' });
      if (!hasBlockSlot(available, window)) {
        return res.status(409).json({ ok: false, error: 'The full reservation block is not available. Check Cal.com availability hours and duration.' });
      }
      if (!start) return res.status(400).json({ ok: false, error: "Missing start time." });
      if (!request.contactEmail) {
        return res.status(400).json({ ok: false, error: "Contact email required to book." });
      }

      let booking;
      let bookingError;
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
            performanceStart,
            reservationStart: start,
            reservationEnd: window.end,
            venue: request.venue,
            timeWindow: request.timeWindow,
            preferredStart: request.preferredStart,
            paymentMethod: request.paymentMethod,
            notes: request.notes,
          },
        });
      } catch (err) {
        bookingError = err?.message || "booking_failed";
        const msg = String(bookingError).toLowerCase();
        const status = err?.status;
        const timeoutLike =
          status === 504 ||
          status === 524 ||
          status === 408 ||
          msg.includes("timeout") ||
          msg.includes("timed out");
        const failed = await updateBookingRequest(id, {
          status: timeoutLike ? "booking_pending" : "booking_failed",
          bookingError,
          lastAttemptAt: nowIso(),
        });
        const httpStatus = timeoutLike ? 202 : 500;
        return res.status(httpStatus).json({ ok: false, error: bookingError, request: failed });
      }

      const bookingUid = booking?.data?.uid || booking?.uid;
      const updated = await updateBookingRequest(id, {
        status: "booked",
        approvedAt: nowIso(),
        start,
        performanceStart,
        reservationEnd: window.end,
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
      let cancelError = null;
      try {
        await calCancelBooking({
          bookingUid,
          cancellationReason: body?.reason,
        });
      } catch (err) {
        cancelError = err?.message || "cancel_failed";
        const msg = String(cancelError).toLowerCase();
        const status = err?.status;
        const treatAsCanceled =
          status === 404 ||
          status === 409 ||
          msg.includes("already") ||
          msg.includes("canceled") ||
          msg.includes("cancelled") ||
          msg.includes("not found");
        if (!treatAsCanceled) {
          return res.status(500).json({ ok: false, error: cancelError });
        }
      }
      const updated = await updateBookingRequest(id, {
        status: "canceled",
        canceledAt: nowIso(),
        cancelReason: body?.reason,
        cancelError,
      });
      return res.status(200).json({ ok: true, request: updated });
    }

    return res.status(400).json({ ok: false, error: "Invalid action." });
  } catch (err) {
    const status = err?.message === "unauthorized" ? 401 : 500;
    return res.status(status).json({ ok: false, error: err?.message || "server_error" });
  }
}
