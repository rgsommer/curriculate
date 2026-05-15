// backend/routes/tasksApp.js
//
// Backend for the personal "/tasks" app on www.curriculate.net/tasks.
// Two concerns:
//   1) Passwordless email + PIN auth (separate from the regular teacher login,
//      but reusing the same User collection and the same JWT_SECRET).
//   2) CRUD over the user's personal LifeTask items (categories: work,
//      family, church) with a per-user index for sync across devices.
//
// All routes are mounted under /api/tasks-app/* in backend/index.js.

import express from "express";
import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";

import User from "../models/User.js";
import LifeTask, { LIFE_TASK_CATEGORIES, LIFE_TASK_RECURRENCES } from "../models/LifeTask.js";
import EmailLoginPin from "../models/EmailLoginPin.js";
import { authRequired } from "../middleware/authRequired.js";
import { sendSystemEmail } from "../email/shareInviteEmailer.js";

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generatePin() {
  // 6-digit numeric PIN, leading zeros preserved
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

function requireJwtSecret() {
  const secret =
    process.env.JWT_SECRET || process.env.JWT_SECRET_KEY || process.env.JWT_KEY;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
}

function signTasksAppToken(user) {
  return jwt.sign(
    {
      userId: String(user._id),
      email: user.email,
      // Tag the token so we know it was minted by the tasks app, useful for logs.
      via: "tasks-app",
    },
    requireJwtSecret(),
    { expiresIn: "60d" } // "stay logged in"
  );
}

function isDevReturnEnabled() {
  const v = String(process.env.RETURN_LOGIN_PIN || "").trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  return process.env.NODE_ENV !== "production";
}

function pinEmailHtml(pin) {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
    <h2 style="margin:0 0 12px;font-weight:600;font-size:20px">Your Tasks sign-in code</h2>
    <p style="margin:0 0 16px;color:#475569">Use this code to sign in to your tasks at curriculate.net/tasks. It expires in 10 minutes.</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:6px;background:#f1f5f9;border-radius:12px;padding:16px 24px;text-align:center;color:#0f172a;margin:0 0 16px">
      ${pin}
    </div>
    <p style="margin:0;color:#94a3b8;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
  </div>`;
}

// ── Rate limits ──────────────────────────────────────────────────────

const requestPinLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many PIN requests, please wait a minute." },
});

const verifyPinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many verification attempts, please wait." },
});

// ── Auth: request + verify PIN ───────────────────────────────────────

/**
 * POST /api/tasks-app/auth/request-pin
 * Body: { email }
 * Always returns { ok:true } to avoid email enumeration. In dev (or when
 * RETURN_LOGIN_PIN=true) the response also includes the pin so it can be
 * pasted back during testing.
 */
router.post("/auth/request-pin", requestPinLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: "Please enter a valid email." });
    }

    const pin = generatePin();
    const pinHash = await bcrypt.hash(pin, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Invalidate any earlier outstanding PIN for this email so only the latest works.
    await EmailLoginPin.deleteMany({ email });
    await EmailLoginPin.create({ email, pinHash, expiresAt });

    // Send the email. We don't block the response on send success — but we do
    // log failures so they're visible in PM2 logs.
    sendSystemEmail({
      to: email,
      subject: `Your sign-in code: ${pin}`,
      html: pinEmailHtml(pin),
    }).catch((err) => {
      console.warn("[tasks-app] sendSystemEmail failed:", err?.message || err);
    });

    if (isDevReturnEnabled()) {
      console.log(`[tasks-app] dev PIN for ${email}: ${pin}`);
      return res.json({ ok: true, devPin: pin });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/tasks-app/auth/request-pin failed:", err);
    // Soft-fail: still return ok so we don't leak account existence.
    return res.json({ ok: true });
  }
});

/**
 * POST /api/tasks-app/auth/verify-pin
 * Body: { email, pin }
 * On success: { ok:true, token, user }
 */
router.post("/auth/verify-pin", verifyPinLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const pin = String(req.body?.pin || "").trim();

    if (!email || !pin) {
      return res.status(400).json({ ok: false, error: "Email and PIN are required." });
    }

    const record = await EmailLoginPin.findOne({ email }).sort({ createdAt: -1 });
    if (!record || record.consumedAt || record.expiresAt < new Date()) {
      return res.status(401).json({ ok: false, error: "That code has expired. Send a new one." });
    }

    if (record.attempts >= 5) {
      return res.status(429).json({ ok: false, error: "Too many wrong attempts. Send a new code." });
    }

    const ok = await bcrypt.compare(pin, record.pinHash);
    if (!ok) {
      record.attempts += 1;
      await record.save();
      return res.status(401).json({ ok: false, error: "That code didn't match." });
    }

    record.consumedAt = new Date();
    await record.save();

    // Find or create a User. We don't set a passwordHash — passwordless only.
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ email });
    }

    const token = signTasksAppToken(user);
    return res.json({
      ok: true,
      token,
      user: {
        userId: String(user._id),
        email: user.email,
        name: user.name || "",
      },
    });
  } catch (err) {
    console.error("POST /api/tasks-app/auth/verify-pin failed:", err);
    return res.status(500).json({ ok: false, error: "Server error." });
  }
});

/**
 * GET /api/tasks-app/me
 * Quick sanity check used by the frontend on startup to validate the stored token.
 */
router.get("/me", authRequired, async (req, res) => {
  return res.json({
    ok: true,
    user: {
      userId: req.userId,
      email: req.user?.email,
      name: req.user?.name || "",
    },
  });
});

// ── Tasks CRUD ───────────────────────────────────────────────────────

function serializeTask(t) {
  return {
    id: String(t._id),
    title: t.title,
    category: t.category,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    recurrence: t.recurrence || "none",
    createdAt: t.createdAt ? t.createdAt.toISOString() : null,
    updatedAt: t.updatedAt ? t.updatedAt.toISOString() : null,
  };
}

function parseDueAt(input) {
  if (input == null || input === "") return null;
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return d;
}

function sanitizeCategory(input, fallback = "family") {
  const c = String(input || "").trim().toLowerCase();
  return LIFE_TASK_CATEGORIES.includes(c) ? c : fallback;
}

function sanitizeRecurrence(input, fallback = "none") {
  const r = String(input || "").trim().toLowerCase();
  return LIFE_TASK_RECURRENCES.includes(r) ? r : fallback;
}

// Advance a date by `recurrence`. Handles month-end rollover correctly:
// Jan 31 + 1 month → Feb 28 (or Feb 29 in leap years), not Mar 3.
// `from` is the anchor date; if null, "now" is used.
function advanceDate(from, recurrence) {
  const base = from ? new Date(from) : new Date();
  const next = new Date(base.getTime());

  if (recurrence === "weekly") {
    next.setDate(next.getDate() + 7);
    return next;
  }
  if (recurrence === "monthly") {
    const day = next.getDate();
    next.setDate(1);              // step off the cliff so setMonth doesn't roll
    next.setMonth(next.getMonth() + 1);
    const dim = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, dim));
    return next;
  }
  if (recurrence === "yearly") {
    const month = next.getMonth();
    const day = next.getDate();
    next.setDate(1);
    next.setFullYear(next.getFullYear() + 1);
    const dim = new Date(next.getFullYear(), month + 1, 0).getDate();
    next.setMonth(month);
    next.setDate(Math.min(day, dim));
    return next;
  }
  return null;
}

/**
 * GET /api/tasks-app/tasks
 * Returns ALL of the user's tasks (active + completed) so the client can sort
 * and group locally. The list is small (personal todos) so this is fine.
 */
router.get("/tasks", authRequired, async (req, res) => {
  try {
    const tasks = await LifeTask.find({ userId: req.userId })
      .sort({ completedAt: 1, dueAt: 1, createdAt: 1 })
      .lean();
    return res.json({ ok: true, tasks: tasks.map(serializeTask) });
  } catch (err) {
    console.error("GET /api/tasks-app/tasks failed:", err);
    return res.status(500).json({ ok: false, error: "Server error." });
  }
});

/**
 * POST /api/tasks-app/tasks
 * Body: { title, category?, dueAt? }
 */
router.post("/tasks", authRequired, async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ ok: false, error: "Title is required." });

    const category = sanitizeCategory(req.body?.category);
    const dueAt = parseDueAt(req.body?.dueAt);
    const recurrence = sanitizeRecurrence(req.body?.recurrence);

    const task = await LifeTask.create({
      userId: req.userId,
      title,
      category,
      dueAt,
      recurrence,
    });

    return res.json({ ok: true, task: serializeTask(task) });
  } catch (err) {
    console.error("POST /api/tasks-app/tasks failed:", err);
    return res.status(500).json({ ok: false, error: "Server error." });
  }
});

/**
 * PATCH /api/tasks-app/tasks/:id
 * Body: any subset of { title, category, dueAt, completed }
 *   - completed: true  -> sets completedAt = now
 *   - completed: false -> clears completedAt
 */
router.patch("/tasks/:id", authRequired, async (req, res) => {
  try {
    const task = await LifeTask.findOne({ _id: req.params.id, userId: req.userId });
    if (!task) return res.status(404).json({ ok: false, error: "Task not found." });

    const wasIncomplete = !task.completedAt;

    if ("title" in req.body) {
      const t = String(req.body.title || "").trim();
      if (!t) return res.status(400).json({ ok: false, error: "Title cannot be empty." });
      task.title = t;
    }
    if ("category" in req.body) {
      task.category = sanitizeCategory(req.body.category, task.category);
    }
    if ("dueAt" in req.body) {
      task.dueAt = parseDueAt(req.body.dueAt);
    }
    if ("recurrence" in req.body) {
      task.recurrence = sanitizeRecurrence(req.body.recurrence, task.recurrence);
    }
    if ("completed" in req.body) {
      task.completedAt = req.body.completed ? new Date() : null;
    }

    await task.save();

    // If we just transitioned a recurring task into a completed state, spawn
    // the next occurrence. We anchor the new dueAt off the original dueAt
    // (so a weekly task stays on its weekly slot even if completed late);
    // if there was no dueAt, anchor off "now".
    let spawnedTask = null;
    const justCompleted = wasIncomplete && !!task.completedAt;
    if (justCompleted && task.recurrence && task.recurrence !== "none") {
      const nextDue = advanceDate(task.dueAt || new Date(), task.recurrence);
      if (nextDue) {
        spawnedTask = await LifeTask.create({
          userId: task.userId,
          title: task.title,
          category: task.category,
          dueAt: nextDue,
          recurrence: task.recurrence,
        });
      }
    }

    return res.json({
      ok: true,
      task: serializeTask(task),
      spawnedTask: spawnedTask ? serializeTask(spawnedTask) : null,
    });
  } catch (err) {
    console.error("PATCH /api/tasks-app/tasks/:id failed:", err);
    return res.status(500).json({ ok: false, error: "Server error." });
  }
});

/**
 * DELETE /api/tasks-app/tasks/:id
 */
router.delete("/tasks/:id", authRequired, async (req, res) => {
  try {
    const result = await LifeTask.deleteOne({ _id: req.params.id, userId: req.userId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ ok: false, error: "Task not found." });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/tasks-app/tasks/:id failed:", err);
    return res.status(500).json({ ok: false, error: "Server error." });
  }
});

export default router;
