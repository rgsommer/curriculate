// Shared auth helpers for TeebeePay API routes.
//
// Token model (HMAC-signed, no DB session):
//   PIN token   — short-lived (10 min), carries the PIN hash + email
//   Auth token  — longer-lived (8 h), carries user id + role + clearance
//
// Pattern lifted from /api/stocks/* and adapted for TeebeePay roles.
import crypto from "crypto";
import { MongoClient, ObjectId } from "mongodb";

export const ROLE_CLEARANCE: Record<string, number> = {
  system_owner: 4, principal: 3, bookkeeper: 2, site_payroll: 1, employee: 0,
  audit_client: 0,                          // external audit client — sees only their own engagement
  // Legacy aliases from earlier in the project
  super_admin: 4, company_admin: 3, payroll_admin: 1,
};
export function clearanceOf(role: string): number {
  return ROLE_CLEARANCE[role] ?? 0;
}

/* ── secret ─────────────────────────────────────────────────────── */
export function getSecret(): string {
  return process.env.TEEBEEPAY_SECRET
      || process.env.STOCKS_SECRET
      || process.env.SESSION_SECRET
      || "dev-only-fallback-change-me";
}

/* ── tiny per-IP rate limit ──────────────────────────────────────── */
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 8;
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}
export function rateOk(ip: string): boolean {
  const now = Date.now();
  const e = rateMap.get(ip);
  if (!e || now > e.resetAt) { rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS }); return true; }
  if (e.count >= RATE_MAX) return false;
  e.count++;
  return true;
}

/* ── base64url + HMAC ────────────────────────────────────────────── */
function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(s: string): Buffer {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}
function constantTimeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function signToken(payload: object, secret: string = getSecret()): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig  = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}
export function verifyToken<T = any>(token: string, secret: string = getSecret()): T | null {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = b64url(crypto.createHmac("sha256", secret).update(body).digest());
    if (!constantTimeEq(sig, expected)) return null;
    const payload = JSON.parse(b64urlDecode(body).toString("utf8")) as { exp?: number };
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload as T;
  } catch { return null; }
}

/* ── PIN helpers ─────────────────────────────────────────────────── */
export function newPin(): string {
  return String(crypto.randomInt(100000, 1_000_000));   // 6 digits
}
export function pinHash(pin: string, email: string, secret: string = getSecret()): string {
  return crypto.createHash("sha256").update(pin + "|" + email.toLowerCase() + "|" + secret).digest("hex");
}

/* ── Mongo (cached across hot reloads on Vercel) ─────────────────── */
declare global {
  // eslint-disable-next-line no-var
  var _teebepayMongoPromise: Promise<MongoClient> | undefined;
}
export function mongoPromise() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) return null;
  if (!global._teebepayMongoPromise) {
    global._teebepayMongoPromise = new MongoClient(uri).connect();
  }
  return global._teebepayMongoPromise;
}
export async function db() {
  const c = await mongoPromise();
  if (!c) throw new Error("MONGO_URI not configured");
  const database = c.db(process.env.MONGO_DB || process.env.MONGODB_DB || "pngpay");
  // Fire-and-forget; guarded so it runs at most once per warm process.
  import("./_indexes").then((m) => m.ensureIndexes(database)).catch(() => {});
  return database;
}
export { ObjectId };

/* ── Authenticated-route helper ──────────────────────────────────── */
export interface AuthedUser {
  uid: string;
  email: string;
  role: string;
  clearance: number;
  company_id: string | null;
  exp: number;
}
export function readAuth(req: Request): AuthedUser | null {
  const hdr = req.headers.get("authorization") || "";
  const tok = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (!tok) return null;
  const p = verifyToken<AuthedUser>(tok);
  if (!p || !p.uid || !p.email) return null;
  return p;
}

// Magic approval token: signed payload that lets a remote AP approve a
// specific pay period from an emailed link without logging in.
export interface ApprovalToken {
  kind: "approve_period";
  pid: string;          // pay_period_id
  email: string;        // AP's email
  exp: number;
}
export function makeApprovalToken(pid: string, email: string): string {
  return signToken({
    kind: "approve_period",
    pid, email: email.toLowerCase(),
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,   // 7 days
  });
}
export function readApprovalToken(token: string): ApprovalToken | null {
  const p = verifyToken<ApprovalToken>(token);
  if (!p || p.kind !== "approve_period" || !p.pid) return null;
  return p;
}
