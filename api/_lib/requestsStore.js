import crypto from "crypto";
import { sendPushToAll } from "./pushStore.js";

// The restored Upstash integration is connected with Vercel's storage2_ prefix.
// Never fall back to the archived integration or ephemeral serverless memory.
const KV_URL = process.env.storage2_KV_REST_API_URL;
const KV_TOKEN = process.env.storage2_KV_REST_API_TOKEN;
let kvClient = null;

const memory = {
  list: [],
  items: new Map(),
};

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

async function getKv() {
  if (!KV_URL || !KV_TOKEN) {
    throw new Error("Booking database is not configured: missing storage2_ Upstash environment variables.");
  }
  if (!kvClient) {
    const { createClient } = await import("@vercel/kv");
    kvClient = createClient({ url: KV_URL, token: KV_TOKEN });
  }
  return kvClient;
}

function clean(obj) {
  return Object.fromEntries(
    Object.entries(obj || {}).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
}

function validateRequest(input) {
  const required = ["venue", "date", "timeWindow", "contactName", "paymentMethod"];
  const missing = required.filter((k) => !input?.[k]);
  if (missing.length) throw new Error(`Missing required fields: ${missing.join(", ")}`);
  if (!input.contactEmail && !input.contactPhone) {
    throw new Error("Contact email or phone is required.");
  }
}

// Serialize approvals across browser tabs and serverless instances. The TTL
// allows recovery if an execution terminates without running its finally block.
export async function acquireBookingApproval(id) {
  const kv = await getKv();
  const token = crypto.randomUUID();
  const acquired = await kv.set(`booking_approval_lock:${id}`, token, { nx: true, ex: 120 });
  return acquired === "OK" ? token : null;
}

export async function releaseBookingApproval(id, token) {
  const kv = await getKv();
  const key = `booking_approval_lock:${id}`;
  // Compare-and-delete atomically to avoid clearing a successor's lock.
  await kv.eval(
    'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end',
    [key],
    [token]
  );
}

export function storeInfo() {
  return { type: KV_URL && KV_TOKEN ? "vercel_kv" : "unconfigured" };
}

export async function createBookingRequest(input) {
  validateRequest(input);
  const item = clean({
    id: newId(),
    status: "pending",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    eventTypeName: input.eventTypeName || process.env.CAL_EVENT_TYPE_NAME || "Night gig",
    venue: input.venue,
    date: input.date,
    timeWindow: input.timeWindow,
    preferredStart: input.preferredStart,
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    paymentMethod: input.paymentMethod,
    notes: input.notes,
    source: input.source,
  });

  const kv = await getKv();
  if (kv) {
    const key = `booking_request:${item.id}`;
    const listKey = "booking_request:list";
    await kv.set(key, item);
    await kv.lpush(listKey, item.id);
  } else {
    memory.items.set(item.id, item);
    memory.list.unshift(item.id);
  }

  try {
    await sendPushToAll({
      title: "New booking request",
      body: `${item.eventTypeName || "Gig"} • ${item.date || ""} ${item.timeWindow || ""}`.trim(),
      url: "/owner/",
      requestId: item.id,
    });
  } catch {}

  return { ok: true, request: item };
}

export async function getBookingRequest(id) {
  if (!id) return null;
  const kv = await getKv();
  if (kv) {
    return await kv.get(`booking_request:${id}`);
  }
  return memory.items.get(id) || null;
}

export async function listBookingRequests(limit = 200) {
  const kv = await getKv();
  if (kv) {
    const listKey = "booking_request:list";
    const ids = await kv.lrange(listKey, 0, Math.max(0, limit - 1));
    if (!ids?.length) return [];
    const keys = ids.map((id) => `booking_request:${id}`);
    const items = await kv.mget(keys);
    return (items || []).filter(Boolean);
  }

  return memory.list.slice(0, limit).map((id) => memory.items.get(id)).filter(Boolean);
}

export async function updateBookingRequest(id, patch) {
  if (!id) throw new Error("Missing request id.");
  const existing = await getBookingRequest(id);
  if (!existing) throw new Error("Request not found.");

  const updated = clean({
    ...existing,
    ...patch,
    updatedAt: nowIso(),
  });

  const kv = await getKv();
  if (kv) {
    await kv.set(`booking_request:${id}`, updated);
    return updated;
  }

  memory.items.set(id, updated);
  if (!memory.list.includes(id)) memory.list.unshift(id);
  return updated;
}
