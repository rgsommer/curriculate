import jwt from "jsonwebtoken";
import User from "../models/User.js";

function getJwtSecret() {
  return process.env.JWT_SECRET || process.env.JWT_SECRET_KEY || process.env.JWT_KEY || null;
}

function wantsSse(req) {
  return String(req.headers.accept || "").includes("text/event-stream");
}

function writeSseFatal(res, message) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write("event: fatal\n");
  res.write("data: " + JSON.stringify({ ok: false, error: message }) + "\n\n");
  res.end();
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}


function extractToken(req) {
  const auth = req.headers?.authorization || req.headers?.Authorization;
  if (auth && typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }

  // Allow SSE/EventSource to pass token in querystring
  const qToken = req.query?.token;
  if (qToken && typeof qToken === "string" && qToken.trim()) {
    return qToken.trim();
  }

  const cookies = parseCookies(req.headers?.cookie || "");
  if (cookies.curriculate_token) return cookies.curriculate_token;

  return null;
}

function isGuestPayload(payload) {
  return (
    payload?.guest === true ||
    payload?.isGuest === true ||
    payload?.type === "guest" ||
    payload?.role === "guest" ||
    payload?.kind === "guest"
  );
}

function buildGuestUser(payload) {
  // Minimal user object for guests. Any gated plan features will remain blocked.
  const authorDisplay =
    payload?.authorDisplay ||
    payload?.sharedFromTeacherName ||
    payload?.displayName ||
    payload?.name ||
    "Guest";

  return {
    _id: null,
    guest: true,
    authorDisplay,

    // Default to FREE capabilities
    planTier: payload?.planTier || "FREE",
    planStudentDetail: false,
    planExportsPdf: false,
    planPrioritySupport: false,
    planMultiClass: false,
    planSeats: 1,
    planAiMonthly: 0,

    billingPastDue: false,
    billingGraceUntil: null,
  };
}

export async function authAny(req, res, next) {
  const secret = getJwtSecret();
  if (!secret) return res.status(500).json({ error: "JWT secret not configured" });

  const token = extractToken(req);
  if (!token) {
    if (wantsSse(req)) return writeSseFatal(res, "Not authenticated");
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const payload = jwt.verify(token, secret);

    // ✅ Guest presenter tokens are allowed (no DB lookup)
    if (isGuestPayload(payload)) {
      req.user = buildGuestUser(payload);
      req.userId = null;
      req.authTokenPayload = payload;
      return next();
    }

    const userId = payload?.id || payload?._id || payload?.userId;
    if (!userId) {
      if (wantsSse(req)) return writeSseFatal(res, "Invalid token");
      return res.status(401).json({ error: "Invalid token" });
    }

    const user = await User.findById(userId).lean();
    if (!user) {
      if (wantsSse(req)) return writeSseFatal(res, "User not found");
      return res.status(401).json({ error: "User not found" });
    }

    req.user = user;
    req.userId = String(userId);
    req.authTokenPayload = payload;
    return next();
  } catch {
    if (wantsSse(req)) return writeSseFatal(res, "Invalid or expired token");
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export default authAny;
