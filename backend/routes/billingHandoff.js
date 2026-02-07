import express from "express";
import jwt from "jsonwebtoken";
import { authAny } from "../middleware/authAny.js";

const router = express.Router();

function getJwtSecret() {
  return process.env.JWT_SECRET || process.env.JWT_SECRET_KEY || process.env.JWT_KEY || null;
}

function cookieDomain() {
  return process.env.CURRICULATE_COOKIE_DOMAIN || ".curriculate.net";
}

router.post("/billing/handoff", authAny, async (req, res) => {
  const secret = getJwtSecret();
  if (!secret) return res.status(500).json({ error: "JWT secret not configured" });

  const now = Math.floor(Date.now() / 1000);
  const handoffCode = jwt.sign(
    { typ: "billing_handoff", userId: String(req.user._id), iat: now },
    secret,
    { expiresIn: "2m" }
  );

  res.json({ handoffCode });
});

router.post("/billing/handoff/consume", async (req, res) => {
  const secret = getJwtSecret();
  if (!secret) return res.status(500).json({ error: "JWT secret not configured" });

  const { handoffCode } = req.body || {};
  if (!handoffCode) return res.status(400).json({ error: "Missing handoffCode" });

  let payload;
  try {
    payload = jwt.verify(handoffCode, secret);
  } catch {
    return res.status(401).json({ error: "Invalid or expired handoffCode" });
  }

  if (payload?.typ !== "billing_handoff" || !payload?.userId) {
    return res.status(401).json({ error: "Invalid handoffCode payload" });
  }

  const sessionToken = jwt.sign(
    { id: payload.userId, typ: "web_billing_session" },
    secret,
    { expiresIn: "30m" }
  );

  res.cookie("curriculate_token", sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    domain: cookieDomain(),
    path: "/",
    maxAge: 30 * 60 * 1000,
  });

  res.json({ ok: true });
});

export default router;
