import crypto from "crypto";

const COOKIE_NAME = "owner_session";
const TTL_HOURS = Number(process.env.OWNER_SESSION_TTL_HOURS || 168);
const SESSION_TTL_MS = Math.max(1, TTL_HOURS) * 60 * 60 * 1000;

function getPassword() {
  const pwd = process.env.OWNER_PASSWORD;
  if (!pwd) throw new Error("OWNER_PASSWORD is not set");
  return pwd;
}

function getSecret() {
  const secret = process.env.OWNER_SESSION_SECRET;
  if (!secret) throw new Error("OWNER_SESSION_SECRET is not set");
  return secret;
}

function b64url(input) {
  return Buffer.from(JSON.stringify(input)).toString("base64url");
}

function sign(data) {
  return crypto.createHmac("sha256", getSecret()).update(data).digest("base64url");
}

function parseCookies(req) {
  const header = req?.headers?.cookie || "";
  const out = {};
  header.split(";").forEach((part) => {
    const [k, ...rest] = part.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(rest.join("="));
  });
  return out;
}

function createToken() {
  const now = Date.now();
  const payload = { iat: now, exp: now + SESSION_TTL_MS };
  const body = b64url(payload);
  const sig = sign(body);
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  if (sign(body) !== sig) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload?.exp || Date.now() > payload.exp) return null;
  return payload;
}

function cookieFlags() {
  const flags = ["HttpOnly", "Path=/", "SameSite=Strict"];
  if (process.env.NODE_ENV === "production") flags.push("Secure");
  return flags.join("; ");
}

export function verifyOwnerPassword(password) {
  return password === getPassword();
}

export function setOwnerSession(res) {
  const token = createToken();
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${token}; Max-Age=${maxAge}; ${cookieFlags()}`);
}

export function clearOwnerSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Max-Age=0; ${cookieFlags()}`);
}

export function requireOwner(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  const payload = verifyToken(token);
  if (!payload) throw new Error("unauthorized");
  return payload;
}
