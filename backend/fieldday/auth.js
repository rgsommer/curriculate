/**
 * Field Day — auth middleware (ESM).
 *
 * Looks for a Bearer token in the Authorization header; falls back to a
 * cookie named `fielddaySession` for same-origin browser usage.
 *
 * Attaches:
 *   req.fdSession   — { _id, role, schoolId, leaderName, email, expiresAt }
 *   req.fdSchoolId  — ObjectId | null
 */
import { Session } from "./models.js";
import { errResp } from "./utils.js";

async function loadSession(req) {
  let token = "";
  const auth = req.headers.authorization || "";
  if (auth.toLowerCase().startsWith("bearer ")) token = auth.slice(7).trim();
  if (!token && req.cookies) token = req.cookies.fielddaySession || "";
  if (!token) return null;
  const sess = await Session.findOne({ token }).lean();
  if (!sess) return null;
  if (sess.expiresAt && new Date(sess.expiresAt).getTime() < Date.now()) return null;
  return sess;
}

export async function requireSession(req, res, next) {
  try {
    const sess = await loadSession(req);
    if (!sess) return errResp(res, 401, "unauthorized");
    req.fdSession = sess;
    req.fdSchoolId = sess.schoolId || null;
    next();
  } catch (e) { next(e); }
}

export function requireAdmin(req, res, next) {
  if (!req.fdSession || req.fdSession.role !== "admin") return errResp(res, 403, "admin_required");
  next();
}

export function requireSchool(req, res, next) {
  if (!req.fdSchoolId) return errResp(res, 400, "no_school_selected");
  next();
}
