// Stateless email-code auth for /orders, modelled on the teebeepay PIN flow.
//
// request-code: generate a 6-digit code, return an HMAC-signed token carrying a
//   hash of {code,email} + expiry. The plaintext code is emailed, never stored.
// verify-code: re-hash the submitted code against the token; if it matches and the
//   token is unexpired, issue a longer-lived session token {email, exp}.
//
// No database is involved, so this works on serverless without shared state.

import crypto from "crypto";

const SECRET =
  process.env.ORDERS_SECRET ||
  process.env.TEEBEEPAY_SECRET ||
  // Build-safe fallback so `next build` never throws; real secret is set on Vercel.
  "orders-dev-secret-change-me";

const CODE_TTL_MS = 10 * 60 * 1000; // code valid 10 min
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // session valid 12 h

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function hmac(data: string): string {
  return b64url(crypto.createHmac("sha256", SECRET).update(data).digest());
}

export function newCode(): string {
  // 6-digit, leading zeros allowed.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function normalizeEmail(email: unknown): string {
  return String(email || "").trim().toLowerCase();
}

export function isEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function codeHash(code: string, email: string): string {
  return hmac(`code:${email}:${code}`);
}

// Sign an arbitrary small payload object → "<payloadB64>.<sig>".
export function signToken(payload: Record<string, unknown>): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(body)}`;
}

export function verifyToken(token: unknown): Record<string, any> | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  // constant-time compare
  const expected = hmac(body);
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  let payload: any;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload?.exp === "number" && Date.now() > payload.exp) return null;
  return payload;
}

// Token issued by request-code; carries the code hash so verify-code is stateless.
export function makeCodeToken(email: string, code: string): string {
  return signToken({ k: "code", email, ch: codeHash(code, email), exp: Date.now() + CODE_TTL_MS });
}

// Long-lived session token returned after a correct code.
export function makeSessionToken(email: string): string {
  return signToken({ k: "session", email, exp: Date.now() + SESSION_TTL_MS });
}

// Returns the authenticated email for a valid session token, else null.
export function sessionEmail(token: unknown): string | null {
  const p = verifyToken(token);
  if (!p || p.k !== "session" || !p.email) return null;
  return String(p.email);
}

// ---- In-memory per-IP rate limiting (baseline; fine for low traffic) ----
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 6; // code requests per window per IP
const rateMap = new Map<string, { count: number; resetAt: number }>();

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function rateOk(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_MAX) return false;
  entry.count += 1;
  return true;
}
