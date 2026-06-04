// backend/services/subsAuthToken.js
//
// Session-token signing/verification for the /subs app, shared by every
// subs route so tokens round-trip. Byte-compatible HMAC scheme with the
// rest of the platform (see stocksAuth.js): a base64url JSON payload and
// a base64url HMAC-SHA256 signature, joined by ".".
//
// The signing secret is read from SUBS_SECRET, falling back to
// STOCKS_SECRET / MEDICENTRE_SECRET so a single platform secret works in
// dev. Set a dedicated SUBS_SECRET in production to isolate this app's
// tokens.

import crypto from "crypto";

export const SUBS_COOKIE_NAME = "subs_session";
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days

export function getSubsSecret() {
  return process.env.SUBS_SECRET || process.env.STOCKS_SECRET || process.env.MEDICENTRE_SECRET || "";
}

function b64url(buf) {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

export function signSubsSession(email, secret = getSubsSecret()) {
  const payload = {
    email: String(email).toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
    sub: "subs-session",
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySubsSession(token, secret = getSubsSecret()) {
  if (!secret) return null;
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8"));
    if (payload?.sub !== "subs-session") return null;
    if (typeof payload?.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload?.email !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

// Pull the session token from the HttpOnly cookie, falling back to a
// Bearer header for non-browser callers.
export function getSubsToken(req) {
  const cookie = req.headers?.cookie || "";
  const m = cookie.match(/(?:^|;\s*)subs_session=([^;]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  const a = req.headers?.authorization || req.headers?.Authorization || "";
  return typeof a === "string" && a.startsWith("Bearer ") ? a.slice(7).trim() : null;
}

// Express middleware: require a valid subs session; attaches req.subsUser.
export function requireSubsAuth(req, res, next) {
  const token = getSubsToken(req);
  if (!token) return res.status(401).json({ error: "Missing session credential" });
  const payload = verifySubsSession(token);
  if (!payload) return res.status(401).json({ error: "Invalid or expired session" });
  req.subsUser = { email: payload.email.toLowerCase() };
  next();
}

export function subsCookieOpts() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    ...(isProd ? { domain: process.env.CURRICULATE_COOKIE_DOMAIN || ".curriculate.net" } : {}),
    path: "/",
  };
}
