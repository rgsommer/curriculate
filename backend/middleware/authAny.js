import jwt from "jsonwebtoken";
import User from "../models/User.js";

function getJwtSecret() {
  return process.env.JWT_SECRET || process.env.JWT_SECRET_KEY || process.env.JWT_KEY || null;
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
  const cookies = parseCookies(req.headers?.cookie || "");
  if (cookies.curriculate_token) return cookies.curriculate_token;
  return null;
}

export async function authAny(req, res, next) {
  const secret = getJwtSecret();
  if (!secret) return res.status(500).json({ error: "JWT secret not configured" });

  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    const payload = jwt.verify(token, secret);
    const userId = payload?.id || payload?._id || payload?.userId;
    if (!userId) return res.status(401).json({ error: "Invalid token" });

    const user = await User.findById(userId).lean();
    if (!user) return res.status(401).json({ error: "User not found" });

    req.user = user;
    req.authTokenPayload = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
