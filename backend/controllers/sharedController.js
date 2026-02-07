// backend/controllers/sharedController.js
import crypto from "crypto";
import jwt from "jsonwebtoken";
import TaskSet from "../models/TaskSet.js";
import SharedTasksetLink from "../models/SharedTasksetLink.js";

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function generateRoomCode() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 2; i++) code += letters[Math.floor(Math.random() * letters.length)];
  return code;
}

function safeAuthorDisplay(s) {
  return String(s || "").trim().slice(0, 60);
}

/**
 * POST /api/shared/:token/launch
 * Public endpoint.
 * Returns:
 *  - presenterJwt: guest JWT that your TeacherApp can use everywhere
 *  - roomCode: new room code (2 letters)
 *  - tasksetMeta: { _id, name, numTasks, subject, gradeLevel }
 */
export async function sharedLaunchController(req, res) {
  try {
    const rawToken = String(req.params.token || "").trim();
    if (!rawToken) return res.status(400).json({ ok: false, error: "Missing token" });

    const tokenHash = hashToken(rawToken);

    const link = await SharedTasksetLink.findOne({ tokenHash }).lean();
    if (!link) return res.status(404).json({ ok: false, error: "Link not found" });

    if (link.revokedAt) return res.status(410).json({ ok: false, error: "Link revoked" });

    const now = Date.now();
    const expMs = new Date(link.expiresAt).getTime();
    if (!Number.isFinite(expMs) || now > expMs) {
      return res.status(410).json({ ok: false, error: "Link expired" });
    }

    const taskset = await TaskSet.findById(link.tasksetId).lean();
    if (!taskset) return res.status(404).json({ ok: false, error: "Task set not found" });

    // Room code for this run (fresh each click)
    const roomCode = generateRoomCode();

    // Mint a guest presenter JWT.
    // IMPORTANT: your authAny.js (Option A) should accept this without requiring a User doc.
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return res.status(500).json({ ok: false, error: "Server missing JWT_SECRET" });

    const guestClaims = {
      guest: true,
      type: "guest",
      // keep minimal; authAny should not require DB lookup for guest tokens
      sharedTokenHash: tokenHash,
      sharedFromTeacherId: String(link.createdByUserId || ""),
      sharedFromTeacherName: safeAuthorDisplay(link.authorDisplay),
      roomCode,
      // Helpful to show “Shared by R. Sommer”
      authorDisplay: safeAuthorDisplay(link.authorDisplay),
    };

    // Guest token lifetime should be short-ish; it can be refreshed by re-clicking the link.
    // Keep it <= share expiry.
    const secondsToExpiry = Math.max(60, Math.floor((expMs - now) / 1000));
    const jwtExpiresIn = Math.min(secondsToExpiry, 60 * 60 * 6); // up to 6 hours

    const presenterJwt = jwt.sign(guestClaims, jwtSecret, { expiresIn: jwtExpiresIn });

    const numTasks = Array.isArray(taskset.tasks) ? taskset.tasks.length : Number(taskset.numTasks || 0) || 0;

    return res.json({
      ok: true,
      roomCode,
      presenterJwt,
      expiresAt: link.expiresAt,
      authorDisplay: safeAuthorDisplay(link.authorDisplay),
      tasksetMeta: {
        _id: String(taskset._id),
        name: String(taskset.name || taskset.title || "Task Set"),
        subject: String(taskset.subject || ""),
        gradeLevel: String(taskset.gradeLevel || ""),
        numTasks,
      },
    });
  } catch (err) {
    console.error("sharedLaunchController error:", err);
    return res.status(500).json({ ok: false, error: "Failed to launch shared task set" });
  }
}
