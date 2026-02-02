import crypto from "crypto";

const HAS_KV = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
let kvClient = null;
let webPushClient = null;
let vapidConfigured = false;

const memory = {
  list: [],
  items: new Map(),
};

function clean(obj) {
  return Object.fromEntries(
    Object.entries(obj || {}).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
}

async function getKv() {
  if (!HAS_KV) return null;
  if (!kvClient) {
    const mod = await import("@vercel/kv");
    kvClient = mod.kv;
  }
  return kvClient;
}

function getVapidDetails() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:owner@example.com";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

async function getWebPush() {
  if (webPushClient) return webPushClient;
  const mod = await import("web-push");
  webPushClient = mod.default || mod;
  return webPushClient;
}

async function ensureVapid() {
  if (vapidConfigured) return true;
  const details = getVapidDetails();
  if (!details) return false;
  const wp = await getWebPush();
  wp.setVapidDetails(details.subject, details.publicKey, details.privateKey);
  vapidConfigured = true;
  return true;
}

function hashEndpoint(endpoint) {
  return crypto.createHash("sha256").update(endpoint).digest("hex");
}

function normalizeSubscription(sub) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return null;
  return clean({
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
  });
}

export function getPublicVapidKey() {
  const details = getVapidDetails();
  return details?.publicKey || null;
}

export async function saveSubscription(sub) {
  const normalized = normalizeSubscription(sub);
  if (!normalized) throw new Error("Invalid subscription payload.");
  const id = hashEndpoint(normalized.endpoint);
  const kv = await getKv();
  if (kv) {
    await kv.set(`push_sub:${id}`, normalized);
    await kv.lpush("push_sub:list", id);
    return { ok: true };
  }
  memory.items.set(id, normalized);
  if (!memory.list.includes(id)) memory.list.unshift(id);
  return { ok: true };
}

async function listSubscriptions() {
  const kv = await getKv();
  if (kv) {
    const ids = await kv.lrange("push_sub:list", 0, 999);
    if (!ids?.length) return [];
    const keys = ids.map((id) => `push_sub:${id}`);
    const items = await kv.mget(keys);
    return (items || []).filter(Boolean);
  }
  return memory.list.map((id) => memory.items.get(id)).filter(Boolean);
}

async function removeSubscriptionByEndpoint(endpoint) {
  const id = hashEndpoint(endpoint);
  const kv = await getKv();
  if (kv) {
    await kv.del(`push_sub:${id}`);
    return;
  }
  memory.items.delete(id);
}

export async function sendPushToAll(payload) {
  const ready = await ensureVapid();
  if (!ready) {
    return { ok: false, error: "Missing VAPID keys." };
  }
  const subs = await listSubscriptions();
  if (!subs.length) return { ok: true, sent: 0 };

  const wp = await getWebPush();
  const body = JSON.stringify(payload || {});
  const results = await Promise.allSettled(
    subs.map((sub) =>
      wp.sendNotification(sub, body).catch(async (err) => {
        const code = err?.statusCode;
        if (code === 404 || code === 410) {
          await removeSubscriptionByEndpoint(sub.endpoint);
        }
        throw err;
      })
    )
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  return { ok: true, sent };
}
