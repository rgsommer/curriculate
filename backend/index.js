// ====================================================================
//  Curriculate Backend – Rooms, Teams, Stations, Tasks, AI, Emailing
// ====================================================================

// 1) Bootstrap (loads env vars first)
import "dotenv/config";

// 2) Core server deps
import express from "express";
import http from "http";
import cors from "cors";
import bodyParser from "body-parser";
import { Server } from "socket.io";
import mongoose from "mongoose";

// 3) Third-party SDKs / crypto
import crypto from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// 4) Shared constants (used across server)
import { TASK_TYPE_META } from "../shared/taskTypes.js";
import { COLORS } from "../shared/colors.js";

// 5) Local utils
import { recordNoiseSample, computeNoiseSummary } from "./utils/noiseTelemetry.js";

// 6) Models
import Session from "./models/Session.js"; // Or LiveSession if renamed
import TeamSession from "./models/TeamSession.js";
import TaskSet from "./models/TaskSet.js";
import User from "./models/User.js";
import TeacherProfile from "./models/TeacherProfile.js";
import AccessCode from "./models/AccessCode.js";
import SystemEmailTemplate from "./models/SystemEmailTemplate.js";
import ReferralProgramSettings from "./models/ReferralProgramSettings.js";

// 7) AI / email services
import { generateAIScore } from "./ai/aiScoring.js";
import { generateSessionSummaries } from "./ai/sessionSummaries.js";
import { sendTranscriptEmail } from "./email/transcriptEmailer.js";
import { sendSystemEmail } from "./email/shareInviteEmailer.js";
import OpenAI from "openai";

// 8) Controllers
import { getMeController } from "./controllers/meController.js"; // you’ll create this
import { listSessions, getSessionDetails } from "./controllers/analyticsController.js";

// 9) Middleware
import { authRequired } from "./middleware/authRequired.js";

// 10) Routes
import authRoutes from "./routes/auth.js";
import stripeRoutes from "./routes/stripe.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";
import demoTasksetStreamRoutes from "./routes/demoTasksetStream.js";
import aiTasksetsRouter from "./routes/aiTasksets.js";
import tasksetsRouter from "./routes/tasksets.js";
import sharedRoutes from "./routes/shared.js";
import { hashShareToken } from "./models/SharedTasksetLink.js"; // adjust path if needed
import resultsRoutes from "./routes/resultsRoutes.js";


// --------------------------------------------------------------------
// Reports are immutable snapshots (do NOT overload Session with reports)
// --------------------------------------------------------------------
// NOTE: We define the model here to keep index.js drop-in friendly.
// If you later add ./models/SessionReport.js, you can remove this block
// and import the model instead.
const SessionReport = mongoose.models.SessionReport || mongoose.model(
  "SessionReport",
  new mongoose.Schema(
    {
      ownerId: { type: String, index: true, required: true },
      roomCode: { type: String, index: true, required: true },
      className: { type: String, default: "" },
      gradeLevel: { type: String, default: "" },
      planTierUsed: { type: String, default: "" },

      // Summary / overview for quick listing + email teaser
      headline: { type: String, default: "" },


      // Shared-run attribution (when a different presenter ran the task set)
      sharedToken: { type: String, default: "" },
      sharedFromTeacherId: { type: String, default: "" },
      sharedFromTeacherName: { type: String, default: "" },
      sharedFromTeacherEmail: { type: String, default: "" },
      runByPresenterId: { type: String, default: "" },
      runByPresenterName: { type: String, default: "" },
      runByPresenterEmail: { type: String, default: "" },

      overviewEmail: { type: String, default: "" }, // brief email-ready overview (plain text)
      parentNote: { type: String, default: "" }, // "Today in __class..." (plain text)

      // Full report payload (JSON snapshot)
      summary: { type: mongoose.Schema.Types.Mixed, default: null },
      transcript: { type: mongoose.Schema.Types.Mixed, default: null },
      perParticipant: { type: mongoose.Schema.Types.Mixed, default: null },

      // Attachments metadata (photos/recordings that were submitted)
      mediaSubmissions: { type: Array, default: [] }, // [{teamId, teamName, taskIndex, taskType, label, url, submittedAt}]
      // Classroom noise telemetry (class-level, not per-student)
      noiseSummary: { type: mongoose.Schema.Types.Mixed, default: null },
      noiseSamples: { type: Array, default: [] }, // [{t, level, brightness, threshold}]
      // Optional: if your emailer generates a PDF and returns a storage url, store it here
      pdfUrl: { type: String, default: "" },

      // Scoring / rubric categories used for this report
      assessmentCategories: { type: Array, default: [] },
      includeIndividualReports: { type: Boolean, default: false },
    },
    { timestamps: true }
  )
  );


function renderEmailTemplate(str, vars) {
  let out = String(str || "");
  for (const [k, v] of Object.entries(vars || {})) {
    out = out.replaceAll(`{{${k}}}`, String(v ?? ""));
  }
  return out;
}

function computeAuthorDisplay(ownerName) {
  const s = String(ownerName || "").trim();
  if (!s) return "";
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]; // e.g. "Richard"
  const first = parts[0];
  const last = parts[parts.length - 1];
  return `${first[0].toUpperCase()}. ${last}`;
}

async function ensureDefaultEmailTemplates() {
  // Only create if missing (so Admin edits are preserved)
  const defaults = [
    {
      key: "share-invite",
      label: "Share link email (initial)",
      enabled: true,
      subject: "Curriculate: {{SENDER_NAME}} shared a task set with you",
      html: `
<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111827;line-height:1.5;">
  <h2 style="margin:0 0 8px 0;">A task set was shared with you</h2>
  <p style="margin:0 0 10px 0;"><b>{{SENDER_NAME}}</b> shared <b>{{TASKSET_NAME}}</b> with you on Curriculate.</p>

  {{CUSTOM_MESSAGE_BLOCK}}

  <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;margin:12px 0;">
    <div style="font-weight:700;">Open and run the task set</div>
    <ol style="margin:8px 0 0 18px;color:#334155;">
      <li>Click <b>Open in Curriculate</b></li>
      <li>Curriculate opens two tabs: <b>Host</b> (projector) + <b>Live</b> (presenter controls)</li>
      <li>Run it as many times as you want (refresh regenerates the room but reuses the same task set)</li>
    </ol>

    <div style="margin-top:10px;">
      <a href="{{SHARE_URL}}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;">
        Open in Curriculate
      </a>
    </div>

    <div style="margin-top:10px;color:#475569;font-size:13px;">This link expires on {{EXPIRES_DATE}}.</div>
  </div>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;"/>
  <p style="margin:0;color:#475569;font-size:13px;">
    Want to keep Curriculate ready for next time? Explore plan tiers and classroom analytics in the presenter app.
  </p>
</div>
`,
      followupDays: null,
    },
    {
      key: "share-followup-7",
      label: "Follow-up email (7 days)",
      enabled: true,
      subject: "Reminder: a Curriculate task set is waiting for you",
      html: `
<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111827;line-height:1.5;">
  <h2 style="margin:0 0 8px 0;">Reminder: a task set was shared with you</h2>
  <p style="margin:0 0 10px 0;">{{SENDER_NAME}} shared a ready-to-run task set with you on Curriculate.</p>
  <div style="margin-top:10px;">
    <a href="{{SHARE_URL}}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;">
      Open in Curriculate
    </a>
  </div>
  <div style="margin-top:10px;color:#475569;font-size:13px;">This link expires on {{EXPIRES_DATE}}.</div>
</div>
`,
      followupDays: 7,
    },
    {
      key: "share-followup-30",
      label: "Follow-up email (30 days)",
      enabled: true,
      subject: "Final reminder: shared Curriculate task set",
      html: `
<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111827;line-height:1.5;">
  <h2 style="margin:0 0 8px 0;">Final reminder</h2>
  <p style="margin:0 0 10px 0;">If you still need it, the shared task set link is below (if it hasn’t expired).</p>
  <div style="margin-top:10px;">
    <a href="{{SHARE_URL}}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;">
      Open in Curriculate
    </a>
  </div>
  <div style="margin-top:10px;color:#475569;font-size:13px;">This link expires on {{EXPIRES_DATE}}.</div>
</div>
`,
      followupDays: 30,
    },
    {
      key: "referral-reward",
      label: "Referral reward email (sender)",
      enabled: true,
      subject: "You earned a free month of Curriculate 🎉",
      html: `
<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111827;line-height:1.5;">
  <h2 style="margin:0 0 8px 0;">You did it 🎉</h2>
  <p style="margin:0 0 10px 0;">{{SENDER_NAME}}, thanks for sharing Curriculate with other teachers.</p>

  <div style="background:#ecfeff;border:1px solid #a5f3fc;border-radius:12px;padding:12px 14px;margin:12px 0;">
    <div style="font-weight:800;">Reward unlocked</div>
    <div style="margin-top:6px;">You’ve hit the referral goal of <b>{{THRESHOLD}}</b> successful shares. We’ve queued <b>{{REWARD_MONTHS}}</b> free month(s) on your account.</div>
  </div>

  <p style="margin:0;color:#475569;font-size:13px;">If you have any questions, just reply to this email and our team will help.</p>
</div>
`,
      followupDays: null,
    },
  ];

  for (const d of defaults) {
    const exists = await SystemEmailTemplate.findOne({ key: d.key }).lean();
    if (!exists) await SystemEmailTemplate.create(d);
  }
}

async function ensureDefaultReferralSettings() {
  // Keep this in a single doc so Admin can edit the program globally
  const key = "default";
  const exists = await ReferralProgramSettings.findOne({ key }).lean();
  if (exists) return;
  await ReferralProgramSettings.create({ key, enabled: true, threshold: 5, rewardMonths: 1 });
}
// --------------------------------------------------------------------
// Shared task set links (secure, expiring links for substitute presenters)
// --------------------------------------------------------------------
const SharedTasksetLink =
  mongoose.models.SharedTasksetLink ||
  mongoose.model(
    "SharedTasksetLink",
    new mongoose.Schema(
      {
        token: { type: String, index: true, unique: true, required: true },
        tasksetId: { type: String, index: true, required: true },

        ownerId: { type: String, index: true, required: true },
        ownerName: { type: String, default: "" },
        ownerEmail: { type: String, default: "" },

        createdAt: { type: Date, default: () => new Date() },
        expiresAt: { type: Date, required: true, index: true },
        revokedAt: { type: Date, default: null },

        // Optional, for cross-compat with access codes / districts
        entryCode: { type: String, default: "", index: true },

        // Email tracking + follow-ups
        invites: {
          type: [
            new mongoose.Schema(
              {
                toEmail: { type: String, default: "" },
                ccEmail: { type: String, default: "" },
                senderUserId: { type: String, default: "" },
                senderName: { type: String, default: "" },
                sentAt: { type: Date },
                followup7SentAt: { type: Date },
                followup30SentAt: { type: Date },
                firstUsedAt: { type: Date },
                countedForReward: { type: Boolean, default: false },
                rewardSentAt: { type: Date },
              },
              { _id: false }
            ),
          ],
          default: [],
        },

        firstUsedAt: { type: Date, default: null },
        lastUsedAt: { type: Date, default: null },
        usedCount: { type: Number, default: 0 },
      },
      { minimize: false }
    )
  );

// ====================================================================
//  CORS
// ====================================================================
const allowedOrigins = [
  "https://set.curriculate.net",
  "https://play.curriculate.net",
  "https://curriculate.net",
  "https://www.curriculate.net",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:4173",
  "http://localhost:4174",
  "http://localhost:3000",
];

function isVercelPreview(origin) {
  return origin && origin.endsWith(".vercel.app");
}

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const ok = allowedOrigins.includes(origin) || isVercelPreview(origin);

    if (!ok) console.warn("Blocked CORS origin:", origin);

    // IMPORTANT:
    // Returning false means "no CORS headers" (browser will block).
    // That's okay for blocked origins, but we must return true for allowed ones.
    return callback(null, ok);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-demo-admin-key"],
  optionsSuccessStatus: 204,
};

const app = express();

const server = http.createServer(app);

// 1) CORS + parsers first
app.use(cors(corsOptions));
app.use(bodyParser.json({ limit: "25mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "25mb" }));

// (If you also use express.json elsewhere, don’t double-stack unnecessarily.)
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// 2) Auth + misc routes that don’t depend on tasksets
app.use("/api/auth", authRoutes);

stripeRoutes.use(cors(corsOptions));
stripeRoutes.options("*", cors(corsOptions));
app.use("/api/stripe", stripeRoutes);

app.use("/api/subscription", subscriptionRoutes);

// 3) Demo stream routes
app.use("/api/demo", demoTasksetStreamRoutes);

// 4) Taskset routes (your new canonical ones)
// If your routers already do their own auth, mount directly:
app.use("/api/ai/tasksets", aiTasksetsRouter);
app.use("/api/tasksets", tasksetsRouter);

// 5) Shared taskset links (public, no auth)
app.use("/api/shared", sharedRoutes);

// 6) Grading (and other large payload) file limit
app.use(express.json({ limit: "25mb" }));
import adminUsageSummaryRouter from "./routes/adminUsageSummary.js";
app.use("/admin", adminUsageSummaryRouter);
// Results sharing routes
app.use(express.json({ limit: "2mb" })); // bump if your payload is bigger
app.use("/results", resultsRoutes);

// Admin gate (server-side)
const adminRequired = [
  authRequired,
  (req, res, next) => {
    const u = req.user || {};
    const roles = Array.isArray(u.roles) ? u.roles : [];
    const ok = u.isAdmin === true || u.role === "admin" || u.userType === "admin" || roles.includes("admin");
    if (!ok) return res.status(403).json({ ok: false, error: "Admin only." });
    next();
  },
];

app.get("/api/version", (req, res) => {
  res.json({ ok: true, version: "ACCESS-CODE-BUILD-2025-12-31b" });
});

// Simple UUID generator
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

//const raceWinner = {};
const teamClues = new Map(); // ← global store for mystery clues

// helper functions
function getOwnerId(req) {
  return String(req.user?._id || req.user?.userId || req.user?.id || req.userId || "").trim();
}

async function getReferralSettings() {
  const s = await ReferralProgramSettings.findOne({ key: "default" }).lean();
  return {
    enabled: s ? s.enabled !== false : true,
    threshold: s ? Number(s.threshold || 5) : 5,
    rewardMonths: s ? Number(s.rewardMonths || 1) : 1,
  };
}

async function maybeSendReferralReward({ senderUserId, senderEmail, senderName } = {}) {
  try {
    if (!senderUserId || !senderEmail) return { ok: true, skipped: true };
    const settings = await getReferralSettings();
    if (!settings.enabled) return { ok: true, skipped: true };

    // Count distinct recipients who have actually run a shared taskset, and haven't been counted for rewards yet.
    const agg = await SharedTasksetLink.aggregate([
      { $unwind: "$invites" },
      {
        $match: {
          "invites.senderUserId": String(senderUserId),
          "invites.firstUsedAt": { $ne: null },
          $or: [
            { "invites.countedForReward": { $exists: false } },
            { "invites.countedForReward": false },
          ],
        },
      },
      // Deduplicate by recipient email
      {
        $group: {
          _id: { toEmail: { $toLower: "$invites.toEmail" } },
          linkId: { $first: "$_id" },
          sentAt: { $first: "$invites.sentAt" },
        },
      },
      { $sort: { sentAt: 1 } },
      { $limit: Math.max(1, settings.threshold) },
    ]);

    if (!agg || agg.length < settings.threshold) return { ok: true, skipped: true };

    // Mark these invites as counted (best-effort)
    for (const row of agg) {
      const email = String(row?._id?.toEmail || "").trim();
      if (!email) continue;
      await SharedTasksetLink.updateOne(
        { _id: row.linkId, "invites.toEmail": new RegExp(`^${email}$`, "i") },
        { $set: { "invites.$.countedForReward": true } }
      );
    }

    // Send reward email
    const tpl = (await SystemEmailTemplate.findOne({ key: "referral-reward" }).lean()) || {};
    const subjectTemplate = tpl.subject || "You earned a free month of Curriculate 🎉";
    const htmlTemplate = tpl.html || "";
    const vars = {
      SENDER_NAME: senderName || "Presenter",
      THRESHOLD: settings.threshold,
      REWARD_MONTHS: settings.rewardMonths,
    };

    await sendSystemEmail({
      to: senderEmail,
      subject: renderEmailTemplate(subjectTemplate, vars),
      html: renderEmailTemplate(htmlTemplate, vars),
    });

    // Also stamp a rewardSentAt on the *most recent* invite we just counted (for metrics)
    await SharedTasksetLink.updateOne(
      { token: { $exists: true }, "invites.senderUserId": String(senderUserId), "invites.firstUsedAt": { $ne: null }, "invites.rewardSentAt": { $exists: false } },
      { $set: { "invites.$.rewardSentAt": new Date() } }
    );

    return { ok: true, sent: true };
  } catch (e) {
    console.warn("[referral-reward] failed:", e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}


function getSessionByRoomCode(code) {
  return rooms[code.toUpperCase()];
}

const POST_SUBMIT_SECONDS = Number(process.env.POST_SUBMIT_SECONDS || 10);

// ------------------------------
// S3 Media Upload (Presigned URLs)
// ------------------------------
const AWS_REGION = process.env.AWS_REGION || "us-east-2";
const S3_BUCKET = process.env.S3_BUCKET || "";
const S3_URL_EXPIRY_SECONDS = Number(process.env.S3_URL_EXPIRY_SECONDS || 300); // 5 minutes
const S3_GET_URL_EXPIRY_SECONDS = Number(process.env.S3_GET_URL_EXPIRY_SECONDS || 3600); // 1 hour

let _s3Client = null;
function getS3Client() {
  if (_s3Client) return _s3Client;
  if (!S3_BUCKET) return null;
  _s3Client = new S3Client({ region: AWS_REGION });
  return _s3Client;
}

function safeExtFromContentType(contentType = "") {
  const ct = String(contentType).toLowerCase();
  if (ct.includes("audio/webm")) return "webm";
  if (ct.includes("audio/wav")) return "wav";
  if (ct.includes("audio/mpeg") || ct.includes("audio/mp3")) return "mp3";
  if (ct.includes("audio/ogg")) return "ogg";
  if (ct.includes("image/png")) return "png";
  if (ct.includes("image/jpeg") || ct.includes("image/jpg")) return "jpg";
  if (ct.includes("image/webp")) return "webp";
  return "bin";
}

function canTeamAccessRoom(roomCode, teamId) {
  try {
    const room = getSessionByRoomCode(roomCode);
    if (!room) return false;
    if (!teamId) return false;
    return Boolean(room.teams && room.teams[teamId]);
  } catch {
    return false;
  }
}

function updateTeamScore(room, teamId, points) {
  // room may be a room object or (in some legacy calls) a roomCode string
  let targetRoom = room;
  if (!targetRoom || !targetRoom.teams) {
    if (typeof room === "string") {
      targetRoom = getSessionByRoomCode(room) || null;
    }
  }
  if (targetRoom?.teams?.[teamId]) {
    targetRoom.teams[teamId].score =
      (targetRoom.teams[teamId].score || 0) + points;
  }
}

// Add non-task bonus points (e.g., TreasureRunner warm-up) in a way that
// updates BOTH the in-memory team score (legacy) and the roomState.scores
// (which are derived from room.submissions).
function addBonusSubmission(room, teamId, points, reason = "bonus", meta = {}) {
  if (!room || !room.teams || !room.teams[teamId]) return false;

  const pts = Number(points) || 0;
  if (!Number.isFinite(pts) || pts === 0) return false;

  // Legacy score field (some older UIs still read this)
  updateTeamScore(room, teamId, pts);

  const team = room.teams[teamId];
  const teamName = team?.teamName || `Team-${String(teamId).slice(-4)}`;

  if (!Array.isArray(room.submissions)) room.submissions = [];

  room.submissions.push({
    roomCode: room.code,
    teamId,
    teamName,
    playerId: null,
    taskIndex: -1,
    answer: { type: "bonus", reason, meta },
    photoUrl: null,
    correct: null,
    points: pts,
    aiScore: { strategy: "bonus", reason, meta },
    timeMs: null,
    submittedAt: Date.now(),
  });

  return true;
}


function getRandomTeam(roomCode) {
  const room = rooms[roomCode];
  const teams = Object.values(room?.teams || {});
  return teams.length > 0
    ? teams[Math.floor(Math.random() * teams.length)]
    : { teamName: "Team" };
}

// ====================================================================
//  EXPRESS MIDDLEWARE
// ====================================================================
app.use(bodyParser.json({ limit: "3mb" }));
app.use("/api/subscription", subscriptionRoutes);
app.use("/auth", authRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/stripe", stripeRoutes);
// Register the route for tripe first 
app.get("/api/me", authRequired, getMeController);

// ====================================================================
//  SOCKET.IO
// ====================================================================
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman)
      if (!origin) return callback(null, true);

      const allowed = allowedOrigins;

      if (
        allowed.some((allowedOrigin) => origin.startsWith(allowedOrigin)) ||
        origin.endsWith(".vercel.app")
      ) {
        callback(null, true);
      } else {
        console.warn("Socket.IO CORS blocked:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  },
});

// --------------------------------------------------------------------
// MongoDB Connection
// --------------------------------------------------------------------
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("❌ MONGO_URI is not defined in environment!");
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log("Mongo connected");
    // Seed system templates/settings once (Admin edits are preserved)
    try {
      await ensureDefaultEmailTemplates();
      await ensureDefaultReferralSettings();
    } catch (e) {
      console.warn("[seed] failed:", e?.message || e);
    }
  })
  .catch((err) => console.error("Mongo connection error:", err));

// ====================================================================
//  ROOM ENGINE (In-Memory)
// ====================================================================
const rooms = {}; // rooms["AB"] = { teacherSocketId, teams, stations, taskset, ... }

// Teacher instance pruning: ensures each LiveSession instance owns only ONE room.
// Uses a stable teacherInstanceId (sent by LiveSession), so refresh/reconnect doesn't leak rooms.
function normalizeTeacherInstanceId(raw, socketIdFallback) {
  const v = typeof raw === "string" ? raw.trim() : "";
  return v ? v : `socket:${socketIdFallback}`;
}

function pruneTeacherRoomsByInstance(teacherInstanceId, keepCode = null) {
  const keep = keepCode ? String(keepCode).toUpperCase() : null;

  for (const [code, room] of Object.entries(rooms)) {
    if (!room) continue;
    if (room.teacherInstanceId !== teacherInstanceId) continue;
    if (keep && code === keep) continue;

    // notify and boot everyone, then delete
    try {
      io.to(code).emit("room:closed", { roomCode: code });
    } catch {}
    try {
      io.in(code).socketsLeave(code);
    } catch {}
    delete rooms[code];

    console.log(`[ROOM] pruned old room ${code} for teacherInstanceId=${teacherInstanceId}`);
  }
}

const OFFLINE_TIMEOUT_MS = 1000 * 60 * 30; // 30 minutes

// Keep-alive server interval that broadcasts available rooms every ~5–10 seconds
setInterval(() => {
  const now = Date.now();
  const available = Object.values(rooms)
    // A room is "available" if the teacher heartbeat is still fresh.
    // We also keep ACTIVE rooms visible for late joiners even after launch.
    .filter((r) => {
      if (!r) return false;
      const alive = r.expiresAt == null || r.expiresAt > now;
      if (!alive) return false;
      return !!(r.teacherSocketId || r.isActive || r.taskset);
    })
    .map((r) => ({
      roomCode: r.code,
      locationCode: r.locationCode || "Classroom",
      isActive: !!r.isActive,
      startedAt: r.startedAt || null,
      teamCount: Object.keys(r.teams || {}).length,
      lastTeacherSeenAt: r.lastTeacherSeenAt || null,
    }));

  io.emit("rooms:available", available);
}, 20000);

async function createRoom(roomCode, teacherSocketId, locationCode = "Classroom") {
  const stations = {};
  const NUM_STATIONS = 8;
  for (let i = 1; i <= NUM_STATIONS; i++) {
    const id = `station-${i}`;
    stations[id] = { id, assignedTeamId: null, color: COLORS[i - 1] || null };
  }

  const room = {
    code: roomCode,
    teacherSocketId,
    createdAt: Date.now(),
    // Heartbeat/availability
    lastTeacherSeenAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 60, // 1 hour rolling expiry
    teams: {},
    stations,
    taskset: null,
    taskIndex: -1,
    submissions: [],
    startedAt: null,
    isActive: false,
    locationCode, // e.g. "Classroom"

    // Random-treats state
    treatsConfig: {
      enabled: true,
      total: 4,
      given: 0,
    },
    pendingTreats: {}, // teamId -> true

    // Noise-control state
    noiseControl: {
      enabled: false,
      threshold: 0, // 0–100; 0 ⇒ off
    },
    noiseLevel: 0, // smoothed noise measure (0–100)
    noiseBrightness: 1, // 1 = full bright, ~0.3 = dim
    tasks: [], // legacy quick-task array (kept for future use)
    currentTaskIndex: -1, // legacy
    selectedRooms: null, // prevents crash in join-room

    // ==== BRAINSTORM BATTLE STATE ====
    // We keep a per-room object keyed by a "task key" so multiple
    // brainstorm tasks in a set don't overwrite each other.
    brainstormBattles: {
      // [taskKey]: {
      //   taskKey,
      //   startedAt,
      //   ideasByTeam: { [teamId]: string[] }
      // }
    },

    // ==== MAD DASH SEQUENCE STATE ====
    // Filled only when a mad-dash game is running
    madDashSequence: null,
    diffDetectiveRace: null,
    flashcardsRace: null,
    hangmanDuel: null, // Hangman Duel per-team sync state

    // ==== GUESS WHO (YES/NO DEDUCTION) STATE ====
    // Per-taskKey state; each team has its own timer/guess count.
    // { [taskKey]: { taskKey, timeLimitSeconds, maxGuesses, startedAtByTeam: { [teamId]: ms }, guessesByTeam: { [teamId]: number }, revealedByTeam: { [teamId]: boolean } } }
    guessWhoGames: {},
  };

  // Load existing teams from DB
  const existingTeams = await TeamSession.find({ roomCode });
  for (const t of existingTeams) {
    const teamId = t._id.toString();
    room.teams[teamId] = {
      teamId,
      teamName: t.teamName,
      members: Array.isArray(t.members) ? t.members : [],
      score: 0,
      stationColor: null,
      currentStationId: null,
      taskIndex: -1,
      status: t.status,
      lastSeenAt: t.lastSeenAt,
    };
  }

  return room;
}

// All-team rotation (kept for possible future use)
function reassignStations(room) {
  const stationIds = Object.keys(room.stations || {});
  const teamIds = Object.keys(room.teams || {});
  if (stationIds.length === 0 || teamIds.length === 0) return;

  if (typeof room._stationRound !== "number") {
    room._stationRound = 0;
  }
  room._stationRound += 1;

  stationIds.forEach((id) => {
    room.stations[id].assignedTeamId = null;
  });

  const sortedTeams = [...teamIds].sort();

  sortedTeams.forEach((teamId, index) => {
    const stationIdx = (index + room._stationRound) % stationIds.length;
    const stationId = stationIds[stationIdx];

    const team = room.teams[teamId];
    if (!team) return;

    team.currentStationId = stationId;
    team.lastScannedStationId = null;
    if (!room.stations[stationId]) {
      room.stations[stationId] = { id: stationId, assignedTeamId: null };
    }
    room.stations[stationId].assignedTeamId = teamId;
  });
}

// Reassign only a single team's station, ensuring uniqueness
function reassignStationForTeam(room, teamId) {
  const stationIds = Object.keys(room.stations || {});
  if (stationIds.length === 0) return;

  const team = room.teams?.[teamId];
  if (!team) return;

  const current = team.currentStationId || null;

  // Stations occupied by OTHER teams
  const occupiedByOthers = new Set(
    Object.entries(room.stations || {})
      .filter(([id, s]) => s.assignedTeamId && s.assignedTeamId !== teamId)
      .map(([id]) => id)
  );

  // Prefer stations that are:
  //  - not the current one
  //  - not occupied by other teams
  const candidates = stationIds.filter(
    (id) => id !== current && !occupiedByOthers.has(id)
  );

  // Fallbacks if all stations are technically “occupied”
  const nextStationId =
    candidates[0] ||
    stationIds.find((id) => id !== current) ||
    stationIds[0];

  // Clear old station assignment (for this team)
  if (
    current &&
    room.stations[current] &&
    room.stations[current].assignedTeamId === teamId
  ) {
    room.stations[current].assignedTeamId = null;
  }

  // Set new station
  team.currentStationId = nextStationId;
  team.lastScannedStationId = null; // force new scan

  if (!room.stations[nextStationId]) {
    room.stations[nextStationId] = { id: nextStationId, assignedTeamId: null };
  }

  // 🔹 Reserve this station for this team
  room.stations[nextStationId].assignedTeamId = teamId;
}

function buildTranscript(room) {
  const taskset = room.taskset;
  const tasks = taskset?.tasks || [];

  const taskRecords = tasks.map((t, i) => ({
    index: i,
    title: t.title || t.taskType,
    taskType: t.taskType,
    prompt: t.prompt,
    points: t.points ?? 10,
  }));

  const teamScores = {};
  for (const sub of room.submissions) {
    if (!teamScores[sub.teamId]) {
      teamScores[sub.teamId] = {
        teamId: sub.teamId,
        teamName: sub.teamName,
        totalPoints: 0,
        attempts: 0,
      };
    }
    teamScores[sub.teamId].totalPoints += sub.points ?? 0;
    teamScores[sub.teamId].attempts += 1;
  }

  return {
    roomCode: room.code,
    taskSetName: room?.taskset?.name || room?.taskset?.title || "",
    sharedToken: room.sharedToken || "",
    sharedFromTeacherId: room.reportOwnerId || "",
    sharedFromTeacherName: room.reportOwnerName || "",
    sharedFromTeacherEmail: room.reportOwnerEmail || "",
    runByPresenterId: room.runByPresenterId || "",
    runByPresenterName: room.runByPresenterName || "",
    runByPresenterEmail: room.runByPresenterEmail || "",
    startedAt: room.startedAt,
    completedAt: Date.now(),
    tasks: taskRecords,
    scores: teamScores,
    submissions: room.submissions,
  };
}

function computePerParticipantStats(room, transcript) {
  const tasks = transcript.tasks || [];
  const tasksByIndex = {};
  tasks.forEach((t) => (tasksByIndex[t.index] = t));

  const participants = {};

  for (const sub of room.submissions) {
    const key = `${sub.teamId}::${sub.playerId}`;
    if (!participants[key]) {
      participants[key] = {
        teamId: sub.teamId,
        teamName: sub.teamName,
        studentName: sub.playerId,
        attempts: 0,
        correctCount: 0,
        pointsEarned: 0,
        pointsPossible: 0,
      };
    }

    const entry = participants[key];
    entry.attempts += 1;
    if (sub.correct) entry.correctCount += 1;
    entry.pointsEarned += sub.points ?? 0;

    const taskMeta = tasksByIndex[sub.taskIndex];
    if (taskMeta) {
      entry.pointsPossible += taskMeta.points ?? 10;
    }
  }

  const totalTasks = tasks.length;

  return Object.values(participants).map((p) => ({
    ...p,
    engagementPercent:
      totalTasks > 0 ? Math.round((p.attempts / totalTasks) * 100) : 0,
    finalPercent:
      p.pointsPossible > 0
        ? Math.round((p.pointsEarned / p.pointsPossible) * 100)
        : 0,
  }));
}

function buildRoomState(room) {
  if (!room) {
    return {
      code: null,
      locationCode: "Classroom",
      reportOwnerId: "",
      reportOwnerName: "",
      reportOwnerEmail: "",
      runByPresenterId: "",
      runByPresenterName: "",
      runByPresenterEmail: "",
      sharedToken: "",
      teams: {},
      stations: [],
      scores: {},
      taskIndex: -1,
      startedAt: null,
      isActive: false,

      treatsConfig: {
        enabled: true,
        total: 4,
        given: 0,
      },
      pendingTreatTeams: [],

      noise: {
        enabled: false,
        threshold: 0,
        level: 0,
        brightness: 1,
      },

      // Backward/forward compatibility: StudentApp reads noiseConfig
      noiseConfig: {
        enabled: false,
        threshold: 0,
      },

      brainstorm: null,
      moodCheckins: {},
      selectedRooms: [],
    };
  }

  const stationsArray = Object.values(room.stations || {});

  // Build scores from submissions, not team.score
  const scores = {};
  for (const sub of room.submissions || []) {
    if (!scores[sub.teamId]) scores[sub.teamId] = 0;
    scores[sub.teamId] += sub.points ?? 0;
  }

  // Detect a one-off Quick Task "taskset" so it doesn’t turn on the
  // full task-flow UI in LiveSession
  const isQuickTaskset =
    !!room.taskset &&
    room.taskset.name === "Quick task" &&
    Array.isArray(room.taskset.tasks) &&
    room.taskset.tasks.length === 1;

  // Derive an "overall" taskIndex for display...
  let overallTaskIndex = -1;

  if (!isQuickTaskset) {
    overallTaskIndex =
      typeof room.taskIndex === "number" ? room.taskIndex : -1;

    const perTeamIndices = Object.values(room.teams || {}).map((t) =>
      typeof t.taskIndex === "number" ? t.taskIndex : -1
    );

    if (perTeamIndices.length > 0) {
      const maxTeamIndex = Math.max(...perTeamIndices);
      if (maxTeamIndex > overallTaskIndex) {
        overallTaskIndex = maxTeamIndex;
      }
    }
  }

  const treatsConfig = room.treatsConfig || {
    enabled: true,
    total: 4,
    given: 0,
  };

  const noiseControl = room.noiseControl || { enabled: false, threshold: 0 };

  // ==== BRAINSTORM STATE SUMMARY FOR LIVESession / UI ====
  let brainstormSummary = null;
  if (room.brainstormBattles && typeof room.brainstormBattles === "object") {
    // Take the most recent active battle (if any)
    const entries = Object.values(room.brainstormBattles);
    if (entries.length > 0) {
      const latest = entries.reduce((a, b) =>
        (a.startedAt || 0) > (b.startedAt || 0) ? a : b
      );
      const teams = {};
      Object.entries(latest.ideasByTeam || {}).forEach(([teamId, ideas]) => {
        const team = (room.teams || {})[teamId];
        const label = team?.teamName || `Team-${String(teamId).slice(-4)}`;
        teams[teamId] = {
          teamId,
          teamName: label,
          ideaCount: ideas.length,
        };
      });
      brainstormSummary = {
        taskKey: latest.taskKey,
        startedAt: latest.startedAt,
        teams,
      };
    }
  }

  return {
    code: room.code,
    locationCode: room.locationCode || "Classroom",
    reportOwnerId: room.reportOwnerId || "",
    reportOwnerName: room.reportOwnerName || "",
    reportOwnerEmail: room.reportOwnerEmail || "",
    runByPresenterId: room.runByPresenterId || "",
    runByPresenterName: room.runByPresenterName || "",
    runByPresenterEmail: room.runByPresenterEmail || "",
    sharedToken: room.sharedToken || "",
    teams: (() => {
      const out = {};
      for (const [teamId, t] of Object.entries(room.teams || {})) {
        if (!t || typeof t !== "object") continue;

        out[teamId] = {
          id: t.id || teamId,
          teamName: t.teamName || t.name || null,
          members: Array.isArray(t.members) ? t.members : [],
          // station assignment
          station: t.station || null,
          currentStationId: t.currentStationId || null,
          lastScannedStationId: t.lastScannedStationId || null,
          locationSlug: t.locationSlug || null,

          // task progression
          taskIndex: typeof t.taskIndex === "number" ? t.taskIndex : -1,
          nextTaskIndex: typeof t.nextTaskIndex === "number" ? t.nextTaskIndex : null,

          // connectivity + misc
          connected: !!t.connected,
          joinedAt: t.joinedAt || null,
          status: t.status || null,
          stale: !!t.stale,
          lastSeenAt: t.lastSeenAt || null,
        };
      }
      return out;
    })(),

    stations: stationsArray,
    scores,
    taskIndex: overallTaskIndex,
    startedAt: room.startedAt || null,
    isActive: !!room.isActive,
    selectedRooms: Array.isArray(room.selectedRooms) ? room.selectedRooms : [],
    moodCheckins: room.moodCheckins && typeof room.moodCheckins === "object" ? room.moodCheckins : {},
    submissions: Array.isArray(room.submissions) ? room.submissions : [],
    
    // Random treats (for LiveSession UI)
    treatsConfig: {
      enabled: !!treatsConfig.enabled,
      total:
        typeof treatsConfig.total === "number" &&
        !Number.isNaN(treatsConfig.total)
          ? treatsConfig.total
          : 2,
      given:
        typeof treatsConfig.given === "number" &&
        !Number.isNaN(treatsConfig.given)
          ? treatsConfig.given
          : 0,
    },
    pendingTreatTeams: Object.keys(room.pendingTreats || {}),

    // Noise-control state (for LiveSession + StudentApp)
    noise: {
      enabled: !!noiseControl.enabled && (noiseControl.threshold || 0) > 0,
      threshold:
        typeof noiseControl.threshold === "number" &&
        !Number.isNaN(noiseControl.threshold)
          ? noiseControl.threshold
          : 0,
      level:
        typeof room.noiseLevel === "number" && !Number.isNaN(room.noiseLevel)
          ? room.noiseLevel
          : 0,
      brightness:
        typeof room.noiseBrightness === "number" &&
        !Number.isNaN(room.noiseBrightness)
          ? room.noiseBrightness
          : 1,
    },

    // Backward/forward compatibility: StudentApp reads noiseConfig
    noiseConfig: {
      enabled: !!noiseControl.enabled && (noiseControl.threshold || 0) > 0,
      threshold:
        typeof noiseControl.threshold === "number" &&
        !Number.isNaN(noiseControl.threshold)
          ? noiseControl.threshold
          : 0,
    },

    // Brainstorm battle – light summary so LiveSession can show counts
    brainstorm: brainstormSummary,
  };
}

function sendTaskToTeam(room, teamId, index) {
  index = Number.isFinite(index) ? index : 0;
  index = Math.max(0, Math.floor(index));

  if (!room?.taskset) return;
  if (!room?.teams?.[teamId]) return;

  const tasks = Array.isArray(room.taskset.tasks) ? room.taskset.tasks : [];
  if (tasks.length === 0) return;

  // If they've finished all tasks, mark complete for this team only
  if (index >= tasks.length) {
    room.teams[teamId].taskIndex = tasks.length;
    io.to(teamId).emit("session:complete");
    return;
  }

  const task = tasks[index];
  if (!task) return;

  // If this is a Diff Detective task, initialise / reset race state
  // the first time any team is sent this particular index.
  if (task.taskType === "diff-detective") {
    if (
      !room.diffDetectiveRace ||
      room.diffDetectiveRace.taskIndex !== index
    ) {
      room.diffDetectiveRace = {
        active: true,
        taskIndex: index,
        startedAt: Date.now(),
        completedTeams: new Set(),
        winnerTeamId: null,
      };

      // Let all clients know a Diff Detective race has started.
      io.to(room.code).emit("diff-detective-race-start", {
        roomCode: room.code,
        taskIndex: index,
        startedAt: room.diffDetectiveRace.startedAt,
      });
    }
  }

  // If this is a Flashcards Race task, initialise race state the first time
  // any team is sent this particular index.
  if (task.taskType === "flashcards-race") {
    _fcEnsureRaceState(io, room, task, index);

    const r = room.flashcardsRace || {};
    const deck = Array.isArray(r.deck) ? r.deck : [];

    // Broadcast initial "start" event so FlashcardsRaceTask can show card 0 + shared leaderboard
    io.to(room.code).emit("flashcards-race:start", {
      taskIndex: index,
      card: deck[0] || null,
      cardIndex: 0,
      totalCards: deck.length,
      secondsPerCard: r.secondsPerCard || 20,
      startedAt: r.cardStartedAt || r.startedAt || Date.now(),
      scores: r.scores || {},
      interTeam: true,
      intraTeam: false,
    });
  }

// If this is a Guess Who (yes/no deduction) task, initialise per-team state
if (task.taskType === "guess-who") {
  const taskKey = `${room.code}:guess-who:${index}`;
  if (!room.guessWhoGames) room.guessWhoGames = {};
  if (!room.guessWhoGames[taskKey]) {
    room.guessWhoGames[taskKey] = {
      taskKey,
      taskIndex: index,
      timeLimitSeconds:
        Number(task.timeLimitSeconds) > 0 ? Number(task.timeLimitSeconds) : 60,
      maxGuesses: Number(task.maxGuesses) > 0 ? Number(task.maxGuesses) : 10,
      startedAtByTeam: {},
      guessesByTeam: {},
      revealedByTeam: {},
    };
  }
  // Ensure team counters exist
  const game = room.guessWhoGames[taskKey];
  if (game && teamId) {
    if (typeof game.guessesByTeam?.[teamId] !== "number") {
      game.guessesByTeam[teamId] = 0;
    }
    if (typeof game.revealedByTeam?.[teamId] !== "boolean") {
      game.revealedByTeam[teamId] = false;
    }
  }
}

  room.teams[teamId].taskIndex = index;

  const timeLimitSeconds =
    typeof task.timeLimitSeconds === "number"
      ? task.timeLimitSeconds
      : typeof task.time_limit === "number"
      ? task.time_limit
      : null;

  const payload = {
    taskIndex: index, // preferred
    index,            // legacy
    task,
    timeLimitSeconds,
    totalTasks: tasks.length,
  };

  io.to(teamId).emit("task:launch", payload);
  io.to(teamId).emit("task:assigned", payload);
}

// ------------------------------
// Helpers: treats + noise
// ------------------------------
function ensureTreatsConfig(room) {
  if (!room.treatsConfig) {
    room.treatsConfig = {
      enabled: true,
      total: 4,
      given: 0,
    };
  }
  if (!room.pendingTreats) {
    room.pendingTreats = {};
  }
}

function isMultiRoomRoom(room) {
  return Array.isArray(room?.selectedRooms) && room.selectedRooms.length > 1;
}

function normalizeSlug(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function displayRoomLabel(room, slugOrLabel) {
  const fallback = String(room?.locationCode || "Classroom").trim();
  const slug = normalizeSlug(slugOrLabel);
  const selected = Array.isArray(room?.selectedRooms) ? room.selectedRooms : [];

  for (const label of selected) {
    if (normalizeSlug(label) === slug) return String(label).trim();
  }
  // If they scanned something not in selectedRooms, treat as classroom (your rule)
  return fallback;
}

function formatGoTo(room, locationSlugOrLabel, colorName) {
  const color = String(colorName || "").toUpperCase();
  if (isMultiRoomRoom(room)) {
    const locLabel = displayRoomLabel(room, locationSlugOrLabel).toUpperCase();
    return `${locLabel} ${color}`;
  }
  return color;
}

function maybeAwardTreat(code, room, teamId) {
  ensureTreatsConfig(room);
  const cfg = room.treatsConfig;
  if (!cfg.enabled) return;
  if (cfg.total <= 0) return;
  if (cfg.given >= cfg.total) return;

  // Simple probability model:
  const remaining = cfg.total - cfg.given;
  const base = Math.min(0.15 * remaining, 0.6); // 0.15, 0.3, 0.45, 0.6...
  const alreadyPending = room.pendingTreats && room.pendingTreats[teamId];
  const chance = alreadyPending ? base * 0.25 : base;

  if (Math.random() > chance) return;

  cfg.given += 1;
  room.pendingTreats[teamId] = true;

  const team = room.teams?.[teamId];
  const teamName = team?.teamName || `Team-${String(teamId).slice(-4)}`;

  // Notify teacher app (LiveSession) and student device.
  io.to(code).emit("teacher:treatAssigned", {
    roomCode: code,
    teamId,
    teamName,
  });
  io.to(teamId).emit("student:treatAssigned", {
    roomCode: code,
    teamId,
    message: "See your teacher for a treat!",
  });
}

function ensureNoiseControl(room) {
  if (!room.noiseControl) {
    room.noiseControl = {
      enabled: false,
      threshold: 0,
    };
  }
  if (typeof room.noiseLevel !== "number") {
    room.noiseLevel = 0;
  }
  if (typeof room.noiseBrightness !== "number") {
    room.noiseBrightness = 1;
  }
}

// Simple deep equal for arrays (for mystery card task)
function arraysDeepEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (e) {
    return false;
  }
}

function scoreMatchingTask(task, answer, basePoints) {
  // Accept shapes:
  // task.config.correctMatches OR task.correctMatches
  // answer.matches OR answer.correctMatches OR answer.pairs
  const cfg = (task && typeof task === "object" ? (task.config || task) : {}) || {};

  const correctMatches =
    (cfg && typeof cfg.correctMatches === "object" && cfg.correctMatches) ||
    (task && typeof task.correctMatches === "object" && task.correctMatches) ||
    null;

  if (!correctMatches || typeof correctMatches !== "object") {
    return {
      ok: false,
      error: "Task has no correctMatches.",
      correct: null,
      pointsEarned: 0,
      aiScore: { strategy: "matching", error: "missing-correctMatches" },
    };
  }

  const submitted =
    (answer && typeof answer.matches === "object" && answer.matches) ||
    (answer && typeof answer.correctMatches === "object" && answer.correctMatches) ||
    (answer && typeof answer.pairs === "object" && answer.pairs) ||
    null;

  if (!submitted || typeof submitted !== "object") {
    return {
      ok: false,
      error: "Answer has no matches map.",
      correct: false,
      pointsEarned: 0,
      aiScore: { strategy: "matching", error: "missing-submitted-matches" },
    };
  }

  const leftIds = Object.keys(correctMatches);
  if (leftIds.length === 0) {
    return {
      ok: false,
      error: "No pairs in correctMatches.",
      correct: null,
      pointsEarned: 0,
      aiScore: { strategy: "matching", error: "empty-correctMatches" },
    };
  }

  let correctCount = 0;
  let evaluated = 0;

  for (const leftId of leftIds) {
    const expectedRight = String(correctMatches[leftId] ?? "");
    const gotRight = submitted[leftId] != null ? String(submitted[leftId]) : "";
    evaluated += 1;
    if (expectedRight && gotRight && expectedRight === gotRight) correctCount += 1;
  }

  const fraction = evaluated > 0 ? Math.max(0, Math.min(1, correctCount / evaluated)) : 0;
  const pointsEarned = Math.round((Number(basePoints) || 0) * fraction);

  const correct =
    fraction === 1 ? true :
    fraction === 0 ? false :
    null;

  return {
    ok: true,
    correct,
    pointsEarned,
    aiScore: {
      strategy: "matching",
      correctCount,
      totalPairs: evaluated,
      fractionCorrect: fraction,
      maxPoints: Number(basePoints) || 0,
      totalScore: pointsEarned,
    },
  };
}

function scoreVennSortTask(task, answer, basePoints) {
  // Accept shapes:
  // - correctAnswer at task.correctAnswer OR task.config.correctAnswer
  // - submitted placements at answer.placements OR answer (if already shaped)
  const cfg = (task && typeof task === "object" ? (task.config || task) : {}) || {};

  const correctAnswer =
    (task && typeof task.correctAnswer === "object" && task.correctAnswer) ||
    (cfg && typeof cfg.correctAnswer === "object" && cfg.correctAnswer) ||
    null;

  if (!correctAnswer || typeof correctAnswer !== "object") {
    return {
      ok: false,
      error: "Task has no correctAnswer map.",
      correct: null,
      pointsEarned: 0,
      aiScore: { strategy: "vennsort", error: "missing-correctAnswer" },
    };
  }

  const submitted =
    (answer && typeof answer === "object" && typeof answer.placements === "object" && answer.placements) ||
    (answer && typeof answer === "object" ? answer : null);

  if (!submitted || typeof submitted !== "object") {
    return {
      ok: false,
      error: "Answer has no placements map.",
      correct: null,
      pointsEarned: 0,
      aiScore: { strategy: "vennsort", error: "missing-submitted-placements" },
    };
  }

  const correctKeys = Object.keys(correctAnswer);
  if (correctKeys.length === 0) {
    return {
      ok: false,
      error: "No items in correctAnswer.",
      correct: null,
      pointsEarned: 0,
      aiScore: { strategy: "vennsort", error: "empty-correctAnswer" },
    };
  }

  const normCats = (arr) =>
    Array.isArray(arr)
      ? arr
          .map((x) => String(x || "").trim())
          .filter(Boolean)
          .sort()
      : [];

  let correctCount = 0;
  let evaluated = 0;

  for (const itemId of correctKeys) {
    const expected = normCats(correctAnswer[itemId]);
    const got = normCats(submitted[itemId]);

    evaluated += 1;

    // Exact match (including "belongs nowhere" => [])
    if (JSON.stringify(expected) === JSON.stringify(got)) {
      correctCount += 1;
    }
  }

  const fraction = evaluated > 0 ? Math.max(0, Math.min(1, correctCount / evaluated)) : 0;
  const pointsEarned = Math.round((Number(basePoints) || 0) * fraction);

  const correct =
    fraction === 1 ? true :
    fraction === 0 ? false :
    null;

  return {
    ok: true,
    correct,
    pointsEarned,
    aiScore: {
      strategy: "vennsort",
      correctCount,
      totalItems: evaluated,
      fractionCorrect: fraction,
      maxPoints: Number(basePoints) || 0,
      totalScore: pointsEarned,
    },
  };
}

function updateNoiseDerivedState(code, room) {
  ensureNoiseControl(room);
  const control = room.noiseControl;

  const enabled = !!control.enabled && (control.threshold || 0) > 0;
  const threshold =
    typeof control.threshold === "number" &&
    !Number.isNaN(control.threshold)
      ? control.threshold
      : 0;
  const level =
    typeof room.noiseLevel === "number" && !Number.isNaN(room.noiseLevel)
      ? room.noiseLevel
      : 0;

  let brightness = 1;
  if (enabled) {
    const center = threshold;
    const band = 15; // +/- range around center
    if (level <= center - band) {
      brightness = 1;
    } else if (level >= center + band) {
      brightness = 0.3;
    } else {
      const t = (level - (center - band)) / (2 * band); // 0 → 1
      brightness = 1 - t * 0.7; // 1 → 0.3
    }
  }

  room.noiseBrightness = brightness;

  // Emit direct noise status (for live meters / dimming)
  io.to(code).emit("session:noiseLevel", {
    roomCode: code,
    level,
    brightness,
    enabled,
    threshold,
  });

  // StudentApp listens to this for dimming + live meter.
  // Record a class-level noise sample for reporting (capped; no-op if disabled)
  try {
    recordNoiseSample(room, { level, brightness, enabled, threshold });
  } catch (e) { /* telemetry must never break session */ }
  io.to(code).emit("noise:update", {
    roomCode: code,
    level,
    brightness,
    enabled,
    threshold,
  });

  // Also refresh room:state so LiveSession sees latest
  const state = buildRoomState(room);
  io.to(code).emit("room:state", state);
  io.to(code).emit("roomState", state);
}

// ================================
// Task advancement (server-authoritative)
// ================================

const NEXT_TASK_DELAY_MS = 15000;

/**
 * Ensures only ONE pending next-task timer exists per session.
 * Stores timer handles on the session object (in-memory).
 */
function scheduleNextTask({
    io,
    session,
    roomCode,
    delayMs = NEXT_TASK_DELAY_MS,
    reason = "auto",
    baseTaskIndex = null,
  }) {
    if (!session) return;

    // If already scheduled, do nothing (prevents duplicates from multiple submissions)
    if (session._nextTaskTimeout) return;

    const startAt = Date.now();
    session._nextTaskDueAt = startAt + delayMs;

    io.to(roomCode).emit("task:advance-scheduled", {
      dueAt: session._nextTaskDueAt,
      delayMs,
      reason,
    });

    session._nextTaskTimeout = setTimeout(() => {
      session._nextTaskTimeout = null;
      session._nextTaskDueAt = null;

      advanceTaskNow({
        io,
        session,
        roomCode,
        reason: reason === "auto" ? "auto-delay" : reason,
        baseTaskIndex,
      });
    }, delayMs);
  }

function cancelScheduledNextTask(session) {
  if (!session) return;
  if (session._nextTaskTimeout) {
    clearTimeout(session._nextTaskTimeout);
    session._nextTaskTimeout = null;
  }
  session._nextTaskDueAt = null;
}

/**
 * Scan-gated "advance": unlock the next task for ALL teams by setting nextTaskIndex.
 * Does NOT push the task directly (students still must scan).
 */
function advanceTaskNow({ io, session, roomCode, reason = "manual", baseTaskIndex = null }) {
  if (!session) return;

  const tasks = session.taskset?.tasks || session.tasks || session.roomState?.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    io.to(roomCode).emit("task:advance-error", { reason: "No tasks found on session." });
    return;
  }

  const teams = session.teams || {};
  const teamIds = Object.keys(teams);

  // Determine which task we're advancing FROM.
  // If caller provides baseTaskIndex, trust it (best for "all teams submitted idx").
  // Otherwise infer from max team.taskIndex.
  const inferredCurrent =
    teamIds.length > 0
      ? Math.max(
          ...teamIds.map((id) =>
            typeof teams[id]?.taskIndex === "number" ? teams[id].taskIndex : -1
          )
        )
      : -1;

  const currentIndex =
    typeof baseTaskIndex === "number" && baseTaskIndex >= 0 ? baseTaskIndex : inferredCurrent;

  const nextIndex = currentIndex + 1;

  if (nextIndex >= tasks.length) {
    // End of taskset
    io.to(roomCode).emit("taskset:ended", { reason });
    io.to(roomCode).emit("session:complete"); // backward compat with older flows
    return;
  }

  // Unlock next task for every team
  for (const id of teamIds) {
    if (!teams[id]) continue;
    teams[id].nextTaskIndex = nextIndex;
  }

  // Broadcast state so TeacherApp + StudentApp see that next is unlocked
  const state = buildRoomState(session);
  io.to(roomCode).emit("room:state", state);
  io.to(roomCode).emit("roomState", state);

  // Optional UI event for teacher dashboards
  io.to(roomCode).emit("task:advance", { taskIndex: nextIndex, reason });
}


// ====================================================================
//  FLASHCARDS RACE – SERVER-SIDE INTER-TEAM COORDINATION
// ====================================================================
// Notes:
// - This is intentionally lightweight: it coordinates buzz + answer + shared leaderboard
//   across teams in the same room (inter-team enabled).
// - The client can still run locally if these events are never used, but when used, the
//   server becomes the source of truth for who buzzed first, scoring, and advancing cards.

function _fcNormalizeAnswer(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function _fcCardMatchesAnswer(card, answerText) {
  const a = _fcNormalizeAnswer(answerText);
  if (!a) return false;

  const correct = _fcNormalizeAnswer(card?.answer ?? card?.a ?? "");
  if (correct && a === correct) return true;

  const alts = card?.acceptableAnswers || card?.acceptable || card?.altAnswers;
  if (Array.isArray(alts) && alts.some((x) => _fcNormalizeAnswer(x) === a)) return true;

  return false;
}

function _fcGetDeckFromTask(task) {
  const cfg = task && typeof task === "object" ? (task.config || {}) : {};
  const deck =
    (Array.isArray(cfg.items) && cfg.items.length > 0
      ? cfg.items
      : Array.isArray(task.cards) && task.cards.length > 0
      ? task.cards
      : Array.isArray(task.items) && task.items.length > 0
      ? task.items
      : []) || [];
  return deck;
}

function _fcGetSecondsPerCardFromTask(task) {
  const cfg = task && typeof task === "object" ? (task.config || {}) : {};
  const raw = cfg.secondsPerCard ?? task.secondsPerCard ?? 20;
  const n = Number(raw);
  return n > 0 ? n : 20;
}

function _fcGetPointsFromTask(task) {
  const cfg = task && typeof task === "object" ? (task.config || {}) : {};
  const pts = cfg.points && typeof cfg.points === "object" ? cfg.points : {};
  const correct = Number(pts.correct ?? cfg.pointsCorrect ?? task.pointsCorrect ?? 10);
  const firstBuzzBonus = Number(
    pts.firstBuzzBonus ?? cfg.pointsFirstBuzzBonus ?? task.pointsFirstBuzzBonus ?? 5
  );
  return {
    correct: Number.isFinite(correct) ? correct : 10,
    firstBuzzBonus: Number.isFinite(firstBuzzBonus) ? firstBuzzBonus : 5,
  };
}

// Record a Flashcards Race win as a normal submission so reports/analytics/transcripts pick it up.
function _fcRecordWinSubmission(room, teamId, taskIndex, cardIndex, answerText, award, card) {
  try {
    if (!room || !room.teams || !room.teams[teamId]) return false;

    const pts = Number(award) || 0;
    if (!Number.isFinite(pts) || pts < 0) return false;

    // Legacy per-team score field (some older UIs still read this)
    updateTeamScore(room, teamId, pts);

    const team = room.teams[teamId];
    const teamName = team?.teamName || `Team-${String(teamId).slice(-4)}`;

    if (!Array.isArray(room.submissions)) room.submissions = [];

    const q = card && typeof card === "object" ? String(card.question ?? card.prompt ?? "") : "";
    const expected = card && typeof card === "object" ? (card.answer ?? card.correctAnswer ?? "") : "";
    const acceptable = card && typeof card === "object" ? (card.acceptableAnswers ?? card.acceptable ?? null) : null;

    room.submissions.push({
      roomCode: room.code,
      teamId,
      teamName,
      playerId: null,
      taskIndex: typeof taskIndex === "number" ? taskIndex : -1,
      answer: {
        type: "flashcards-race",
        kind: "card-win",
        cardIndex: typeof cardIndex === "number" ? cardIndex : null,
        question: q,
        answer: String(answerText ?? ""),
        expected,
        acceptableAnswers: acceptable,
      },
      photoUrl: null,
      correct: true,
      points: pts,
      aiScore: {
        strategy: "objective-flashcards-race",
        totalScore: pts,
        maxPoints: pts,
        correct: true,
      },
      timeMs: null,
      submittedAt: Date.now(),
    });

    return true;
  } catch (e) {
    console.error("[flashcards-race] record win submission error:", e);
    return false;
  }
}

// Record a per-team summary submission (0 pts) when the race ends so transcripts show the outcome.
function _fcRecordSummarySubmission(room, teamId, taskIndex, summary) {
  try {
    if (!room || !room.teams || !room.teams[teamId]) return false;

    const team = room.teams[teamId];
    const teamName = team?.teamName || `Team-${String(teamId).slice(-4)}`;

    if (!Array.isArray(room.submissions)) room.submissions = [];

    room.submissions.push({
      roomCode: room.code,
      teamId,
      teamName,
      playerId: null,
      taskIndex: typeof taskIndex === "number" ? taskIndex : -1,
      answer: {
        type: "flashcards-race",
        kind: "race-summary",
        summary: summary && typeof summary === "object" ? summary : {},
      },
      photoUrl: null,
      correct: null,
      points: 0,
      aiScore: {
        strategy: "flashcards-race-summary",
        totalScore: 0,
        maxPoints: 0,
      },
      timeMs: null,
      submittedAt: Date.now(),
    });

    return true;
  } catch (e) {
    console.error("[flashcards-race] record summary submission error:", e);
    return false;
  }
}

function _fcFinalizeRace(io, room, reason = "end") {
  try {
    const r = room.flashcardsRace;
    if (!r) return;

    const scores = r.scores && typeof r.scores === "object" ? r.scores : {};
    const teamIds = Object.keys(room.teams || {});
    const winnerTeamId =
      teamIds.length > 0
        ? teamIds.reduce((best, id) => {
            const s = Number(scores[id] || 0);
            const b = Number(scores[best] || 0);
            return s > b ? id : best;
          }, teamIds[0])
        : null;

    const summary = {
      reason: String(reason || "end"),
      taskIndex: r.taskIndex,
      totalCards: Array.isArray(r.deck) ? r.deck.length : null,
      finalScores: scores,
      winnerTeamId,
      secondsPerCard: r.secondsPerCard ?? null,
      points: r.points ?? null,
    };

    // Persist one summary per team (0 pts) so transcripts show a coherent outcome even for teams with 0 wins.
    for (const id of teamIds) {
      _fcRecordSummarySubmission(room, id, r.taskIndex, summary);
    }

    // Unlock the next task for ALL teams (scan-gated), consistent with other race-style tasks.
    advanceTaskNow({
      io,
      session: room,
      roomCode: room.code,
      reason: `flashcards-race:${summary.reason}`,
      baseTaskIndex: r.taskIndex,
    });

    // Broadcast the updated room state so teacher + students see updated scores/submissions-derived totals.
    const state = buildRoomState(room);
    io.to(room.code).emit("room:state", state);
    io.to(room.code).emit("roomState", state);
  } catch (e) {
    console.error("[flashcards-race] finalize error:", e);
  }
}



function _fcClearTimer(room) {
  if (room?.flashcardsRace?.timer) {
    try {
      clearTimeout(room.flashcardsRace.timer);
    } catch {}
  }
  if (room?.flashcardsRace) room.flashcardsRace.timer = null;
}

function _fcBroadcastState(io, room, eventName, extra = {}) {
  const r = room?.flashcardsRace;
  const deck = r?.deck || [];
  const safeCard = deck[r?.cardIndex ?? 0] || null;

  io.to(room.code).emit(eventName, {
    taskIndex: r?.taskIndex ?? null,
    card: safeCard ? { question: safeCard.question ?? safeCard.q ?? "", answer: safeCard.answer ?? safeCard.a ?? "" } : null,
    cardIndex: r?.cardIndex ?? 0,
    totalCards: deck.length,
    secondsPerCard: r?.secondsPerCard ?? 20,
    startedAt: r?.cardStartedAt ?? r?.startedAt ?? Date.now(),
    scores: r?.scores || {},
    buzz: r?.currentBuzz || null,
    ...extra,
  });
}

function _fcAdvanceCard(io, room, reason = "next") {
  const r = room.flashcardsRace;
  const deck = r.deck || [];

  _fcClearTimer(room);

  r.currentBuzz = null;
  r.buzzedOutTeams = {};
  r.firstBuzzTeamId = null;

  r.cardIndex = (r.cardIndex ?? 0) + 1;

  if (r.cardIndex >= deck.length) {
    r.active = false;
    _fcBroadcastState(io, room, "flashcards-race:end", { reason, done: true });
    _fcFinalizeRace(io, room, reason);
    return;
  }

  r.cardStartedAt = Date.now();
  _fcBroadcastState(io, room, "flashcards-race:next", { reason, done: false });

  // Schedule server-side timeout to advance the card if nobody wins it in time.
  const ms = Math.max(3, Number(r.secondsPerCard || 20)) * 1000;
  r.timer = setTimeout(() => {
    const roomNow = rooms[room.code];
    if (!roomNow?.flashcardsRace) return;
    const rr = roomNow.flashcardsRace;
    if (!rr.active) return;
    if (rr.taskIndex !== r.taskIndex) return;

    // Advance due to timeout
    _fcBroadcastState(io, roomNow, "flashcards-race:timeout", { reason: "timeout" });
    _fcAdvanceCard(io, roomNow, "timeout");
  }, ms);
}

function _fcEnsureRaceState(io, room, task, taskIndex) {
  const deck = _fcGetDeckFromTask(task);
  const secondsPerCard = _fcGetSecondsPerCardFromTask(task);

  if (!room.flashcardsRace || room.flashcardsRace.taskIndex !== taskIndex) {
    room.flashcardsRace = {
      active: deck.length > 0,
      taskIndex,
      deck,
      secondsPerCard,
      startedAt: Date.now(),
      cardStartedAt: Date.now(),
      cardIndex: 0,
      scores: {},
      points: _fcGetPointsFromTask(task),
      currentBuzz: null,
      buzzedOutTeams: {},
      firstBuzzTeamId: null,
      timer: null,
    };
  } else {
    // Keep scores between re-sends, but update deck/settings.
    room.flashcardsRace.deck = deck;
    room.flashcardsRace.secondsPerCard = secondsPerCard;
    room.flashcardsRace.points = _fcGetPointsFromTask(task);
    if (typeof room.flashcardsRace.cardIndex !== "number") room.flashcardsRace.cardIndex = 0;
    if (!room.flashcardsRace.scores) room.flashcardsRace.scores = {};
  }

  // Start / restart timer
  room.flashcardsRace.cardStartedAt = Date.now();
  _fcClearTimer(room);

  const ms = Math.max(3, Number(secondsPerCard || 20)) * 1000;
  room.flashcardsRace.timer = setTimeout(() => {
    const roomNow = rooms[room.code];
    if (!roomNow?.flashcardsRace) return;
    const rr = roomNow.flashcardsRace;
    if (!rr.active) return;
    if (rr.taskIndex !== taskIndex) return;

    _fcBroadcastState(io, roomNow, "flashcards-race:timeout", { reason: "timeout" });
    _fcAdvanceCard(io, roomNow, "timeout");
  }, ms);
}

// ====================================================================
//  SOCKET.IO – EVENT HANDLERS
// ====================================================================
io.on("connection", (socket) => {
  console.log(
    "[SOCKET] New connection",
    socket.id,
    "origin:",
    socket.handshake.headers.origin,
    "referer:",
    socket.handshake.headers.referer
  );

socket.on("submit:answer", (payload, ack) => {
  handleStudentSubmit(payload, ack);
});

// --------------------------------------------------------------------
// Flashcards Race (inter-team) events
// --------------------------------------------------------------------
socket.on("flashcards-race:buzz", (payload = {}, ack) => {
  try {
    const roomCode = String(payload.roomCode || payload.code || "").trim();
    const taskIndex = Number(payload.taskIndex);
    const teamId = String(payload.teamId || payload.teamSessionId || payload.team || "").trim();
    const playerIndex = Number(payload.playerIndex ?? 0);
    const playerName = String(payload.playerName || "").trim();

    const room = rooms[roomCode];
    if (!room || !room.flashcardsRace) {
      ack && ack({ ok: false, error: "Race not ready." });
      return;
    }

    const r = room.flashcardsRace;
    if (Number.isFinite(taskIndex) && r.taskIndex !== taskIndex) {
      ack && ack({ ok: false, error: "Race index mismatch." });
      return;
    }

    if (!r.active) {
      ack && ack({ ok: false, error: "Race not active." });
      return;
    }

    // If someone already has the buzz, deny.
    if (r.currentBuzz && r.currentBuzz.teamId) {
      ack && ack({ ok: false, error: "Already buzzed.", currentBuzz: r.currentBuzz });
      return;
    }

    // Team may have already buzzed out on this card.
    if (teamId && r.buzzedOutTeams && r.buzzedOutTeams[teamId]) {
      ack && ack({ ok: false, error: "Team already missed this card." });
      return;
    }

    // Record first buzz of card for bonus logic
    if (!r.firstBuzzTeamId && teamId) r.firstBuzzTeamId = teamId;

    r.currentBuzz = {
      teamId: teamId || null,
      playerIndex: Number.isFinite(playerIndex) ? playerIndex : 0,
      playerName: playerName || null,
      at: Date.now(),
    };

    _fcBroadcastState(io, room, "flashcards-race:buzzed", { buzz: r.currentBuzz });

    ack && ack({ ok: true, buzz: r.currentBuzz });
  } catch (e) {
    console.error("[flashcards-race:buzz] error:", e);
    ack && ack({ ok: false, error: "Server error." });
  }
});

socket.on("flashcards-race:answer", (payload = {}, ack) => {
  try {
    const roomCode = String(payload.roomCode || payload.code || "").trim();
    const taskIndex = Number(payload.taskIndex);
    const teamId = String(payload.teamId || payload.teamSessionId || payload.team || "").trim();
    const answerText = payload.answer ?? payload.text ?? payload.value ?? "";

    const room = rooms[roomCode];
    if (!room || !room.flashcardsRace) {
      ack && ack({ ok: false, error: "Race not ready." });
      return;
    }

    const r = room.flashcardsRace;
    if (Number.isFinite(taskIndex) && r.taskIndex !== taskIndex) {
      ack && ack({ ok: false, error: "Race index mismatch." });
      return;
    }

    if (!r.active) {
      ack && ack({ ok: false, error: "Race not active." });
      return;
    }

    if (!r.currentBuzz || (r.currentBuzz.teamId && teamId !== r.currentBuzz.teamId)) {
      ack && ack({ ok: false, error: "Not your buzz." });
      return;
    }

    const deck = Array.isArray(r.deck) ? r.deck : [];
    const card = deck[r.cardIndex] || null;

    if (!card) {
      ack && ack({ ok: false, error: "No active card." });
      return;
    }

    const correct = _fcCardMatchesAnswer(card, answerText);
    const serverPts = (r.points && typeof r.points === "object") ? r.points : _fcGetPointsFromTask({});

    if (correct) {
      // Award points
      const pointsBase = serverPts.correct || 10;
      const bonus =
        r.firstBuzzTeamId && teamId && r.firstBuzzTeamId === teamId ? serverPts.firstBuzzBonus || 5 : 0;

      const award = pointsBase + bonus;

      if (!r.scores) r.scores = {};
      r.scores[teamId || "unknown"] = Number(r.scores[teamId || "unknown"] || 0) + award;

      // Persist this win for reporting/analytics/transcripts
      _fcRecordWinSubmission(room, String(teamId || "unknown"), r.taskIndex, r.cardIndex, answerText, award, card);

      _fcBroadcastState(io, room, "flashcards-race:winner", {
        teamId: teamId || null,
        award,
        correct: true,
        answer: String(answerText ?? ""),
        cardIndex: r.cardIndex,
      });

      ack && ack({ ok: true, correct: true, award, scores: r.scores });

      // Advance
      _fcAdvanceCard(io, room, "winner");
      return;
    }

    // Wrong answer: mark team as buzzed-out for this card and clear buzz
    if (!r.buzzedOutTeams) r.buzzedOutTeams = {};
    if (teamId) r.buzzedOutTeams[teamId] = true;

    const wrongTeam = teamId || null;
    r.currentBuzz = null;

    _fcBroadcastState(io, room, "flashcards-race:wrong", {
      teamId: wrongTeam,
      correct: false,
      answer: String(answerText ?? ""),
      cardIndex: r.cardIndex,
    });

    ack && ack({ ok: true, correct: false });

  } catch (e) {
    console.error("[flashcards-race:answer] error:", e);
    ack && ack({ ok: false, error: "Server error." });
  }
});

// Optional: allow a teacher/admin to force-advance (or a client when timer UI hits 0)
socket.on("flashcards-race:advance", (payload = {}, ack) => {
  try {
    const roomCode = String(payload.roomCode || payload.code || "").trim();
    const taskIndex = Number(payload.taskIndex);
    const room = rooms[roomCode];
    if (!room || !room.flashcardsRace) {
      ack && ack({ ok: false, error: "Race not ready." });
      return;
    }
    const r = room.flashcardsRace;
    if (Number.isFinite(taskIndex) && r.taskIndex !== taskIndex) {
      ack && ack({ ok: false, error: "Race index mismatch." });
      return;
    }
    _fcAdvanceCard(io, room, String(payload.reason || "advance"));
    ack && ack({ ok: true });
  } catch (e) {
    console.error("[flashcards-race:advance] error:", e);
    ack && ack({ ok: false, error: "Server error." });
  }
});


// ----------------------------------------------------
// Hangman Duel realtime sync (intra-team)
// Events from student-app HangmanDuelTask:
// - "hangman-set-style" { roomCode, teamId, style }
// - "hangman-place-letter" { roomCode, teamId, letter, blankIndex }
// - "hangman-clear-slot" { roomCode, teamId, blankIndex }
// - "hangman-guess-word" { roomCode, teamId, guess }
// (We also accept "hangman-guess-letter" as an alias for place-letter.)
// Server emits:
// - "hangman-update" to teamId room
// ----------------------------------------------------
function _getHangmanActiveTask(room) {
  const idx = Number(room?.taskIndex ?? 0);
  const t = room?.taskset?.tasks?.[idx] || null;
  if (!t) return null;
  // Normalize task type field
  const type = String(t.type || t.taskType || t.task_type || t.id || "").toLowerCase();
  if (type !== "hangman-duel" && type !== "hangman" && type !== "hangman_duel") return null;
  return t;
}

function _getStationIndexForTeam(room, teamId) {
  const stId = room?.teams?.[teamId]?.currentStationId || room?.teams?.[teamId]?.stationId || null;
  const m = typeof stId === "string" ? stId.match(/station-(\d+)/i) : null;
  const n = m ? Number(m[1]) : NaN;
  if (Number.isFinite(n) && n >= 1 && n <= 8) return n - 1;
  // Fallback: try stations map
  const stations = room?.stations || {};
  for (const k of Object.keys(stations)) {
    if (stations[k]?.assignedTeamId === teamId) {
      const mm = String(k).match(/station-(\d+)/i);
      const nn = mm ? Number(mm[1]) : NaN;
      if (Number.isFinite(nn) && nn >= 1 && nn <= 8) return nn - 1;
    }
  }
  return 0;
}

function _pickHangmanWordForTeam(room, teamId) {
  const task = _getHangmanActiveTask(room);
  const cfg = task?.config || {};
  const wordsByStation = Array.isArray(cfg.wordsByStation) ? cfg.wordsByStation : Array.isArray(cfg.words) ? cfg.words : [];
  const stIdx = _getStationIndexForTeam(room, teamId);
  const entry = wordsByStation[stIdx] || wordsByStation[0] || null;
  const rawWord =
    (entry && typeof entry === "object" ? entry.word : entry) ||
    cfg.word ||
    task.word ||
    "";
  const word = String(rawWord || "").trim();
  const hint = entry && typeof entry === "object" ? entry.hint : cfg.hint || task.hint || "";
  return { word, hint };
}

function _ensureHangmanRoomState(room) {
  if (!room.hangmanDuel || typeof room.hangmanDuel !== "object") {
    room.hangmanDuel = { byTeam: {} };
  }
  if (!room.hangmanDuel.byTeam || typeof room.hangmanDuel.byTeam !== "object") {
    room.hangmanDuel.byTeam = {};
  }
  return room.hangmanDuel;
}

function _ensureHangmanTeamState(room, teamId) {
  const h = _ensureHangmanRoomState(room);
  if (!h.byTeam[teamId]) {
    const { word, hint } = _pickHangmanWordForTeam(room, teamId);
    const clean = String(word || "").toUpperCase();
    const letters = clean.split("").map((ch) => (/[A-Z]/.test(ch) ? ch : ch)); // keep spaces/punct visible
    const blanks = letters.map((ch) => (/[A-Z]/.test(ch) ? "_" : ch));
    const playerCount = Array.isArray(room?.teams?.[teamId]?.members) ? room.teams[teamId].members.length : 1;

    h.byTeam[teamId] = {
      word: clean,
      hint: hint ? String(hint) : "",
      blanks,
      wrongGuesses: 0,
      usedLetters: [],
      style: "snowman",
      currentTurn: 0,
      eliminated: new Array(Math.max(1, Math.min(4, playerCount))).fill(false),
      createdAt: Date.now(),
    };
  }
  return h.byTeam[teamId];
}

function _broadcastHangman(io, room, teamId, patch = {}) {
  // Broadcast only to this team (socket joined teamId room on join)
  io.to(String(teamId)).emit("hangman-update", patch);
}

function _advanceHangmanTurn(state) {
  const n = Array.isArray(state.eliminated) ? state.eliminated.length : 1;
  if (n <= 1) return 0;
  let next = (Number(state.currentTurn) + 1) % n;
  let guard = 0;
  while (guard < n && state.eliminated?.[next]) {
    next = (next + 1) % n;
    guard++;
  }
  state.currentTurn = next;
  return next;
}

function _isHangmanSolved(state) {
  return Array.isArray(state.blanks) && state.blanks.length > 0 && state.blanks.every((x) => x !== "_" && x !== "");
}

function _hangmanApplyGuessLetter(state, letter) {
  const L = String(letter || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!L) return { changed: false, correct: false };
  if (state.usedLetters.includes(L)) return { changed: false, correct: false };

  state.usedLetters.push(L);

  const word = String(state.word || "");
  let any = false;
  const nextBlanks = state.blanks.slice();
  for (let i = 0; i < word.length; i++) {
    if (word[i] === L) {
      nextBlanks[i] = L;
      any = true;
    }
  }

  if (any) {
    state.blanks = nextBlanks;
    return { changed: true, correct: true };
  } else {
    state.wrongGuesses = Number(state.wrongGuesses || 0) + 1;
    return { changed: true, correct: false };
  }
}

socket.on("hangman-set-style", (payload = {}, ack) => {
  try {
    const roomCode = String(payload.roomCode || payload.code || socket.data?.roomCode || "").trim().toUpperCase();
    const teamId = String(payload.teamId || socket.data?.teamId || "").trim();
    const style = String(payload.style || "").trim();

    const room = rooms[roomCode];
    if (!room || !room.taskset) return ack && ack({ ok: false, error: "Room not ready." });
    if (!teamId) return ack && ack({ ok: false, error: "Missing teamId." });

    const st = _ensureHangmanTeamState(room, teamId);
    if (style) st.style = style;

    _broadcastHangman(io, room, teamId, { style: st.style });
    ack && ack({ ok: true });
  } catch (e) {
    console.error("[hangman-set-style] error:", e);
    ack && ack({ ok: false, error: "Server error." });
  }
});

socket.on("hangman-clear-slot", (payload = {}, ack) => {
  try {
    const roomCode = String(payload.roomCode || payload.code || socket.data?.roomCode || "").trim().toUpperCase();
    const teamId = String(payload.teamId || socket.data?.teamId || "").trim();
    const blankIndex = Number(payload.blankIndex);

    const room = rooms[roomCode];
    if (!room || !room.taskset) return ack && ack({ ok: false, error: "Room not ready." });
    if (!teamId) return ack && ack({ ok: false, error: "Missing teamId." });

    const st = _ensureHangmanTeamState(room, teamId);
    if (Number.isFinite(blankIndex) && blankIndex >= 0 && blankIndex < st.blanks.length) {
      // Only clear if it is not a revealed letter (leave underscores/visible punctuation alone)
      const wordCh = String(st.word || "")[blankIndex] || "";
      if (/[A-Z]/.test(wordCh)) {
        // Clearing a slot just puts back "_", but does not remove used letter history
        st.blanks[blankIndex] = "_";
      }
    }

    _broadcastHangman(io, room, teamId, { blanks: st.blanks });
    ack && ack({ ok: true });
  } catch (e) {
    console.error("[hangman-clear-slot] error:", e);
    ack && ack({ ok: false, error: "Server error." });
  }
});


function _handleHangmanPlaceLetter(payload = {}, ack, io, rooms) {
  const roomCode = String(payload.roomCode || payload.code || socket.data?.roomCode || "").trim().toUpperCase();
  const teamId = String(payload.teamId || socket.data?.teamId || "").trim();
  const letter = payload.letter ?? payload.value ?? payload.text ?? "";

  const room = rooms[roomCode];
  if (!room || !room.taskset) {
    ack && ack({ ok: false, error: "Room not ready." });
    return;
  }
  if (!teamId) {
    ack && ack({ ok: false, error: "Missing teamId." });
    return;
  }

  const st = _ensureHangmanTeamState(room, teamId);
  const res = _hangmanApplyGuessLetter(st, letter);

  _advanceHangmanTurn(st);

  const feedback = res.changed
    ? res.correct
      ? { ok: true, correct: true, message: "Correct!" }
      : { ok: true, correct: false, message: "Nope!" }
    : { ok: true, correct: false, message: "Already tried." };

  const patch = {
    blanks: st.blanks,
    wrongGuesses: st.wrongGuesses,
    currentTurn: st.currentTurn,
    eliminated: st.eliminated,
    style: st.style,
    feedback,
  };

  _broadcastHangman(io, room, teamId, patch);
  ack && ack({ ok: true, ...feedback });
}

// Alias: some clients may emit hangman-guess-letter
socket.on("hangman-guess-letter", (payload = {}, ack) => {
  try {
    _handleHangmanPlaceLetter(payload, ack, io, rooms);
  } catch (e) {
    console.error("[hangman-guess-letter] error:", e);
    ack && ack({ ok: false, error: "Server error." });
  }
});

socket.on("hangman-place-letter", (payload = {}, ack) => {
  try {
    _handleHangmanPlaceLetter(payload, ack, io, rooms);
  } catch (e) {
    console.error("[hangman-place-letter] error:", e);
    ack && ack({ ok: false, error: "Server error." });
  }
});

socket.on("hangman-guess-word", (payload = {}, ack) => {
  try {
    const roomCode = String(payload.roomCode || payload.code || socket.data?.roomCode || "").trim().toUpperCase();
    const teamId = String(payload.teamId || socket.data?.teamId || "").trim();
    const guess = String(payload.guess || payload.word || payload.value || "").trim().toUpperCase();

    const room = rooms[roomCode];
    if (!room || !room.taskset) return ack && ack({ ok: false, error: "Room not ready." });
    if (!teamId) return ack && ack({ ok: false, error: "Missing teamId." });

    const st = _ensureHangmanTeamState(room, teamId);
    const target = String(st.word || "").trim().toUpperCase();

    let feedback = null;

    if (guess && target && guess === target) {
      // Fill blanks
      st.blanks = target.split("").map((ch) => (/[A-Z]/.test(ch) ? ch : ch));
      feedback = { ok: true, correct: true, message: "Full word correct!" };
    } else {
      // Wrong full-word guess: eliminate current player (if multiplayer) and advance
      const n = Array.isArray(st.eliminated) ? st.eliminated.length : 1;
      if (n > 1) {
        const cur = Number(st.currentTurn) || 0;
        if (cur >= 0 && cur < n) st.eliminated[cur] = true;
      }
      feedback = { ok: true, correct: false, message: "Wrong full-word guess. Eliminated this round." };
      _advanceHangmanTurn(st);
    }

    const patch = {
      blanks: st.blanks,
      wrongGuesses: st.wrongGuesses,
      currentTurn: st.currentTurn,
      eliminated: st.eliminated,
      style: st.style,
      feedback,
    };

    _broadcastHangman(io, room, teamId, patch);
    ack && ack({ ok: true, ...feedback });
  } catch (e) {
    console.error("[hangman-guess-word] error:", e);
    ack && ack({ ok: false, error: "Server error." });
  }
});

socket.on("task:force-advance", ({ roomCode }) => {
  const session = getSessionByRoomCode(roomCode); // <-- use YOUR existing getter
  if (!session) return;

  // If a 15s timer is pending, cancel it and advance immediately
  cancelScheduledNextTask(session);
  advanceTaskNow({ io, session, roomCode, reason: "teacher-force" });
});

  // ----------------------------------------------------
  // Bonus points (TreasureRunner warm-up, etc.)
  // Student emits: "score:add" with { roomCode, teamId, delta, reason, meta }
  // We record a bonus submission so roomState.scores (derived from submissions)
  // updates immediately for StudentApp + LiveSession.
  // ----------------------------------------------------
  socket.on("score:add", (payload = {}, ack) => {
    try {
      const { roomCode, teamId, delta, reason, meta } = payload || {};
      const code = (roomCode || socket.data?.roomCode || "").toUpperCase();
      const room = rooms[code];

      const effectiveTeamId = teamId || socket.data?.teamId;

      if (!code || !room || !effectiveTeamId || !room.teams?.[effectiveTeamId]) {
        if (typeof ack === "function") ack({ ok: false, error: "Invalid room/team" });
        return;
      }

      const pts = Number(delta);
      if (!Number.isFinite(pts) || pts === 0) {
        if (typeof ack === "function") ack({ ok: false, error: "Invalid delta" });
        return;
      }

      const ok = addBonusSubmission(
        room,
        String(effectiveTeamId),
        pts,
        typeof reason === "string" ? reason.slice(0, 100) : "bonus",
        meta && typeof meta === "object" ? meta : {}
      );

      if (ok) {
        const state = buildRoomState(room);
        io.to(code).emit("room:state", state);
        io.to(code).emit("roomState", state);
      }

      if (typeof ack === "function") ack({ ok: !!ok });
    } catch (err) {
      console.error("score:add failed:", err);
      if (typeof ack === "function") ack({ ok: false, error: "Server error" });
    }
  });

  // Optional: TreasureRunner completion event (no scoring implied here; scoring should use score:add)
  socket.on("treasure:finish", (payload = {}, ack) => {
    try {
      const { roomCode, teamId, pointsEarned, placement } = payload || {};
      const code = (roomCode || socket.data?.roomCode || "").toUpperCase();
      const room = rooms[code];
      const effectiveTeamId = teamId || socket.data?.teamId;

      if (!code || !room || !effectiveTeamId) {
        if (typeof ack === "function") ack({ ok: false });
        return;
      }

      io.to(code).emit("treasure:finish", {
        roomCode: code,
        teamId: String(effectiveTeamId),
        teamName: room.teams?.[effectiveTeamId]?.teamName || null,
        pointsEarned: Number(pointsEarned) || 0,
        placement: placement ?? null,
        finishedAt: Date.now(),
      });

      if (typeof ack === "function") ack({ ok: true });
    } catch (err) {
      console.error("treasure:finish failed:", err);
      if (typeof ack === "function") ack({ ok: false });
    }
  });

  // ----------------------------------------------------
  // Post-taskset feedback (between last task and trophy screen)
  // Student emits: "feedback:submit" with { roomCode, teamId, rating, ... }
  // ----------------------------------------------------
  socket.on("feedback:submit", (payload = {}, ack) => {
    try {
      const { roomCode, teamId } = payload || {};
      const code = (roomCode || socket.data?.roomCode || "").toUpperCase();
      const room = rooms[code];

      const effectiveTeamId = teamId || socket.data?.teamId;

      if (!code || !room || !effectiveTeamId) {
        if (typeof ack === "function") ack({ ok: false, error: "Invalid room/team" });
        return;
      }

      if (!room.feedback || typeof room.feedback !== "object") {
        room.feedback = {};
      }

      const safe = {
        submittedAt: Date.now(),
        rating: Number(payload.rating) || null,

        // Backward/forward compatible field names:
        // - older clients: highlights/improvements/favoriteTask
        // - newer MultiPlayerFeedbackTask: note/improve/favorite (+ optional learned)
        highlights:
          typeof payload.highlights === "string"
            ? payload.highlights.slice(0, 500)
            : typeof payload.note === "string"
            ? payload.note.slice(0, 500)
            : "",
        improvements:
          typeof payload.improvements === "string"
            ? payload.improvements.slice(0, 500)
            : typeof payload.improve === "string"
            ? payload.improve.slice(0, 500)
            : "",
        favoriteTask:
          typeof payload.favoriteTask === "string"
            ? payload.favoriteTask.slice(0, 200)
            : typeof payload.favorite === "string"
            ? payload.favorite.slice(0, 200)
            : "",

        learned:
          typeof payload.learned === "string"
            ? payload.learned.slice(0, 500)
            : typeof payload.whatILearned === "string"
            ? payload.whatILearned.slice(0, 500)
            : "",
      };

      room.feedback[String(effectiveTeamId)] = safe;

      io.to(code).emit("feedback:update", {
        roomCode: code,
        teamId: String(effectiveTeamId),
        teamName: room.teams?.[effectiveTeamId]?.teamName || null,
        ...safe,
      });

      if (typeof ack === "function") ack({ ok: true });
    } catch (err) {
      console.error("feedback:submit failed:", err);
      if (typeof ack === "function") ack({ ok: false, error: "Server error" });
    }
  });

// LOG EVERY EVENT THIS SOCKET EMITS
  socket.onAny((event, ...args) => {
    console.log(
      `[SOCKET ${socket.id}] event:`,
      event,
      "payload keys:",
      args[0] && typeof args[0] === "object"
        ? Object.keys(args[0])
        : typeof args[0]
    );
  });

  // Teacher creates room
  socket.on("teacher:createRoom", async ({ roomCode, teacherInstanceId }, callback) => {
    const code = roomCode?.toUpperCase();
    if (!code) return;

    const instId = normalizeTeacherInstanceId(teacherInstanceId, socket.id);

    // ✅ Ensure this LiveSession instance only owns ONE room at a time
    pruneTeacherRoomsByInstance(instId, code);

    if (rooms[code]) {
      rooms[code].teacherSocketId = socket.id;
      socket.join(code);

      const state = buildRoomState(rooms[code]);

      // Emit both event names for compatibility
      socket.emit("room:state", state);
      socket.emit("roomState", state);
      io.to(code).emit("room:state", state);
      io.to(code).emit("roomState", state);

      // Keep-alive pulse
      rooms[code].teacherSocketId = socket.id;
        rooms[code].lastTeacherSeenAt = Date.now();
        rooms[code].expiresAt = Date.now() + 1000 * 60 * 60;

        socket.data.role = "teacher";
        socket.data.roomCode = code;

      if (typeof callback === "function") callback({ ok: true, roomCode: code, room: state });
        return;
      }

    console.log(`Teacher created room ${code}`);
    const room = await createRoom(code, socket.id);
    rooms[code] = room;
    rooms[code].teacherInstanceId = instId;
    socket.data.teacherInstanceId = instId;

    console.log(`Room ${code} is now READY for students`);
    socket.join(code);

    // Broadcast initial empty state so LiveSession renders correctly
    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

    // When the teacher creates/claims a room, stamp a heartbeat
    rooms[code].teacherSocketId = socket.id;
    rooms[code].teacherInstanceId = instId;
    socket.data.teacherInstanceId = instId;

    rooms[code].lastTeacherSeenAt = Date.now();
    rooms[code].expiresAt = Date.now() + 1000 * 60 * 60; // 1 hour
    socket.data.role = "teacher";
    socket.data.roomCode = code;
  
    if (typeof callback === "function") callback({ ok: true, roomCode: code, room: state });

  });

  // teacher keepalive event
  socket.on("teacher:keepalive", ({ roomCode, teacherInstanceId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const instId = normalizeTeacherInstanceId(teacherInstanceId, socket.id);

    // ✅ Safety net: if this instance ever had other rooms, kill them now
    pruneTeacherRoomsByInstance(instId, code);

    // keep room alive + reconnect-safe ownership
    room.teacherSocketId = socket.id;
    room.lastTeacherSeenAt = Date.now();
    room.expiresAt = Date.now() + 1000 * 60 * 60; // rolling 1-hour expiry

    // IMPORTANT: do NOT mutate room.isActive here

    socket.join(code);
    socket.data.role = "teacher";
    socket.data.roomCode = code;
  });

  // ----------------------------------------------------
  // Student joins a room (persistent student:join-room)
  // ----------------------------------------------------
  const handleStudentJoinRoom = async (payload = {}, ack) => {
    try {
      const { roomCode, teamName, members, displayName, maxTeamSize } = payload || {};
      const code = (roomCode || "").toUpperCase().trim();
      const cleanName = (teamName || "").trim();

      const memberList = Array.isArray(members)
        ? members
            .filter((m) => typeof m === "string")
            .map((m) => m.trim())
            .filter((m) => m.length > 0)
        : [];

      // Team name is OPTIONAL now. If not provided, the server will auto-assign
      // students into teams on a first-come, first-served basis.
      if (!code) {
        if (typeof ack === "function") {
          ack({ ok: false, error: "Room code is required." });
        }
        return;
      }

      // At least one member name is required so the teacher sees who joined.
      const hasAtLeastOneMember = memberList.length > 0 || (displayName && String(displayName).trim().length > 0);
      if (!hasAtLeastOneMember) {
        if (typeof ack === "function") {
          ack({ ok: false, error: "Please enter at least one student name." });
        }
        return;
      }

      const room = rooms[code];
      if (!room) {
        if (typeof ack === "function") {
          ack({
            ok: false,
            error: "Room not found. Is your teacher in the room?",
          });
        }
        return;
      }

      // ------------------------------------------------------------
      // Auto-team assignment (first-come, first-served)
      // - If teamName is provided, we keep it
      // - If teamName is blank, we assign the student to the first team
      //   that has room, otherwise we create a new Team N
      // - Default max team size is 8 (can be overridden per payload)
      // ------------------------------------------------------------
      const MAX_TEAM_SIZE = Number.isFinite(Number(maxTeamSize)) ? Math.max(1, Number(maxTeamSize)) : 8;

      // Always include displayName (if given) in the member list
      const dn = String(displayName || "").trim();
      if (dn && !memberList.includes(dn)) memberList.push(dn);

      // Ensure room.teams exists
      if (!room.teams) room.teams = {};

      // Track creation time so we can keep a stable first-come order
      for (const t of Object.values(room.teams)) {
        if (!t.createdAt) t.createdAt = new Date().toISOString();
      }

      const usedTeamNames = new Set(Object.values(room.teams).map((t) => String(t?.teamName || "").trim()).filter(Boolean));

      function pickNextAutoTeamName() {
        let n = 1;
        while (usedTeamNames.has(`Team ${n}`)) n += 1;
        return `Team ${n}`;
      }

      function resolveTeamName() {
        const provided = String(cleanName || "").trim();
        if (provided) return provided;

        // Fill existing teams in creation order until they reach MAX_TEAM_SIZE
        const orderedTeams = Object.values(room.teams).slice().sort((a, b) => {
          const ta = Date.parse(a?.createdAt || 0) || 0;
          const tb = Date.parse(b?.createdAt || 0) || 0;
          return ta - tb;
        });

        for (const t of orderedTeams) {
          const count = Array.isArray(t?.members) ? t.members.length : 0;
          if (count < MAX_TEAM_SIZE) return String(t.teamName || "").trim();
        }

        return pickNextAutoTeamName();
      }

      const resolvedTeamName = resolveTeamName();

      // Try to re-use an existing TeamSession for this room + team name,
      // so refreshes don't create duplicates.
      let teamDoc = await TeamSession.findOne({
        roomCode: code,
        teamName: resolvedTeamName,
      });

      if (!teamDoc) {
        teamDoc = new TeamSession({
          roomCode: code,
          teamName: resolvedTeamName,
          members: memberList,
          status: "online",
          lastSeenAt: new Date(),
        });
        await teamDoc.save();
      } else {
        const prev = Array.isArray(teamDoc.members) ? teamDoc.members : [];
        teamDoc.members = Array.from(new Set([...prev, ...memberList]));
        teamDoc.status = "online";
        teamDoc.lastSeenAt = new Date();
        await teamDoc.save();
      }

      const teamId = String(teamDoc._id);

      // Ensure in-memory team object is present & updated
      if (!room.teams[teamId]) {
        room.teams[teamId] = {
          teamId,
          teamName: resolvedTeamName,
          members: memberList,
          createdAt: new Date().toISOString(),
          score: 0,
          status: "online",
          currentStationId: null,
          lastScannedStationId: null,
          taskIndex: -1,
        };
        room.teams[teamId].connected = true;
        room.teams[teamId].stale = false;
        room.teams[teamId].lastSeenAt = new Date();
      } else {
        room.teams[teamId].teamName = resolvedTeamName;
        const prevMembers = Array.isArray(room.teams[teamId].members) ? room.teams[teamId].members : [];
        room.teams[teamId].members = Array.from(new Set([...prevMembers, ...memberList]));
        room.teams[teamId].status = "online";
        room.teams[teamId].connected = true;
        room.teams[teamId].stale = false;
        room.teams[teamId].lastSeenAt = new Date();
      }

      // Ensure published team assignment is always in currentStationId
      if (!room.teams[teamId].currentStationId) {
        room.teams[teamId].currentStationId =
        room.teams[teamId].stationId ||
        room.teams[teamId].station ||   // <-- if your published teams use this
        null;
      }

      // Cancel any offline cleanup timeout if it exists
      if (room.teams[teamId].offlineTimeout) {
        clearTimeout(room.teams[teamId].offlineTimeout);
        delete room.teams[teamId].offlineTimeout;
      }

      // 🔹 NEW: give this team a starting station so scanning is the first step
      // If the team already has a station, KEEP IT (refresh/rejoin). Only assign if missing.
      if (!room.teams[teamId].currentStationId && room.stations && Object.keys(room.stations).length > 0) {
        reassignStationForTeam(room, teamId);
      }

      // If taskset running, DO NOT push task immediately.
      // Instead, queue it so the NEXT SCAN delivers it.
      // ✅ Only send a task if the session has STARTED
      if (
        room.isActive === true &&
        room.taskset &&
        Array.isArray(room.taskset.tasks) &&
        room.taskset.tasks.length > 0
      ) {
        const idx =
          typeof room.taskIndex === "number" && room.taskIndex >= 0
            ? room.taskIndex
            : typeof room.teams?.[teamId]?.taskIndex === "number" && room.teams[teamId].taskIndex >= 0
            ? room.teams[teamId].taskIndex
            : 0;

        sendTaskToTeam(room, teamId, idx); //revisit this: re-join scan should not cause next task
      }

      socket.data.roomCode = code;
      socket.data.teamId = teamId;
      socket.data.teamName = resolvedTeamName;

      socket.join(code);
      socket.join(teamId);

      const state = buildRoomState(room);
      io.to(code).emit("room:state", state);
      io.to(code).emit("roomState", state);

      // Notify teacher that a team has joined (for LiveSession join sound)
      io.to(code).emit("team:joined", {
        teamId,
        teamName: resolvedTeamName,
        members: memberList,
      });

      if (typeof ack === "function") {
        ack({
          ok: true,
          teamId,
          teamName: resolvedTeamName,
          teamSessionId: teamId,
          assignedStationId: room?.teams?.[teamId]?.currentStationId || room?.teams?.[teamId]?.stationId || null,
          assignedColor: normalizeStationId(room?.teams?.[teamId]?.currentStationId || room?.teams?.[teamId]?.stationId || null)?.color || null,
          roomState: state,
        });
      }
    } catch (err) {
      console.error("student:join-room error:", err);
      if (typeof ack === "function") {
        ack({ ok: false, error: "Join failed on server." });
      }
    }
  };

  socket.on("student:join-room", handleStudentJoinRoom);
  socket.on("student-join-room", handleStudentJoinRoom);


  // ----------------------------------------------------
  // Student auto-resume (resume-team-session)
  // ----------------------------------------------------
  socket.on("resume-team-session", async (payload = {}, ack) => {
    try {
      const { roomCode, teamSessionId } = payload || {};
      const code = (roomCode || "").toUpperCase().trim();
      const teamId = String(teamSessionId || "").trim();

      if (!code || !teamId) {
        if (typeof ack === "function") {
          ack({
            success: false,
            error: "Room and team session are required.",
          });
        }
        return;
      }

      const room = rooms[code];
      if (!room || !room.teams || !room.teams[teamId]) {
        if (typeof ack === "function") {
          ack({
            success: false,
            error:
              "Session not found. Ask your teacher to let you re-join the room.",
          });
        }
        return;
      }

      const team = room.teams[teamId];

      // Mark as online + cancel any pending offline timeout
      team.status = "online";
      team.connected = true;
      team.stale = false;
      team.lastSeenAt = new Date();
      
      if (team.offlineTimeout) {
        clearTimeout(team.offlineTimeout);
        delete team.offlineTimeout;
      }

      // Keep DB in sync if we can
      try {
        const dbTeam = await TeamSession.findById(teamId);
        if (dbTeam) {
          dbTeam.status = "online";
          dbTeam.lastSeenAt = new Date();
          await dbTeam.save();
        }
      } catch (err) {
        console.warn("resume-team-session: DB update failed:", err);
      }

      // Re-join socket rooms + tag socket
      socket.join(code);
      socket.join(teamId);
      // ✅ If a taskset is already running, send the current task to this (re)joining team
      if (room.taskset && Array.isArray(room.taskset.tasks) && room.taskset.tasks.length > 0) {
        const idx =
          typeof room.taskIndex === "number" && room.taskIndex >= 0
            ? room.taskIndex
            : typeof room.teams?.[teamId]?.taskIndex === "number"
            ? room.teams[teamId].taskIndex
            : 0;

        sendTaskToTeam(room, teamId, idx);
      }

      socket.data.roomCode = code;
      socket.data.teamId = teamId;
      socket.data.teamName = team.teamName;

      const state = buildRoomState(room);

      if (typeof ack === "function") {
        ack({
          success: true,
          teamId,
          assignedStationId: room?.teams?.[teamId]?.currentStationId || room?.teams?.[teamId]?.stationId || null,
          assignedColor: normalizeStationId(room?.teams?.[teamId]?.currentStationId || room?.teams?.[teamId]?.stationId || null)?.color || null,
          roomState: state,
        });
      }

      io.to(code).emit("room:state", state);
      io.to(code).emit("roomState", state);
    } catch (err) {
      console.error("resume-team-session error:", err);
      if (typeof ack === "function") {
        ack({
          success: false,
          error: "Server error while resuming session.",
        });
      }
    }
  });

  // Student scans station – unified handler for legacy + new flow
  const normalizeRoomCode = (c) => (c || "").trim().toUpperCase();

  // If you already have these elsewhere, delete these two helpers here.
  const normalizeLocationSlug = (s) =>
    (s || "")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");

  function normalizeStationId(input) {
    const raw = (input || "").toString().trim();
    const lower = raw.toLowerCase();

    // 1) station-<number> anywhere in the string
    const m = lower.match(/station-(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      const color = Number.isFinite(n) && n >= 1 ? COLORS[n - 1] || null : null;
      return { id: `station-${n}`, number: n, color };
    }

    // 2) color anywhere in the string (including URLs like .../red or .../202/red)
    // Match whole word colors separated by /, ?, #, &, =, or end of string
    const colorRegex = new RegExp(`(?:^|[\\/\\?#&=])(${COLORS.join("|")})(?:$|[\\/\\?#&=])`, "i");
    const cm = lower.match(colorRegex);
    if (cm) {
      return { id: null, number: null, color: cm[1].toLowerCase() };
    }

    // 3) plain color string (fallback)
    if (COLORS.includes(lower)) {
      return { id: null, number: null, color: lower };
    }

    return { id: null, number: null, color: null };
  }

  function buildReviewPayload({ task, answer, correct, aiScore }) {
    const type = task?.taskType;
      // MC / TF (single-question)
      if (type === "multiple-choice" || type === "true-false") {
        const correctAnswer = task?.correctAnswer ?? null;
        return { correctAnswer };
      }

      // Multi-question objective packs (MC / TF only)
      if (
        Array.isArray(task?.items) &&
        task.items.length > 0 &&
        (
          task.taskType === "multiple-choice" ||
          task.taskType === "true-false" ||
          task.taskType === "multi-choice" ||
          task.taskType === "multi-true-false"
        )
      ) {
        // Only include answers that actually exist
        const correctAnswers = task.items.map((it) =>
          it?.correctAnswer ?? null
        );

        // Guard: if none of the items define correctAnswer, bail
        const hasAnyCorrect = correctAnswers.some((v) => v !== null);
        if (!hasAnyCorrect) return null;

        return { correctAnswers };
      }

        // VENNSORT
        if (type === "vennsort") {
          const cfg = task?.config || task || {};
          return {
            categories: cfg?.categories || null,
            correctAnswer: task?.correctAnswer ?? cfg?.correctAnswer ?? null,
            studentPlacements: answer?.placements ?? answer ?? null,
          };
        }

      // SORT (server currently receives pct score, but it still knows the key)
      if (type === "sort") {
        // Prefer ids; fall back to text if no ids exist
        const correctMap = {};
        (task?.items || []).forEach((it, idx) => {
          const key = it?.id != null ? String(it.id) : String(idx);
          if (it?.correctBucketId != null) correctMap[key] = String(it.correctBucketId);
          else if (it?.correctBucket != null) correctMap[key] = String(it.correctBucket);
        });

        // studentMap can be included if your front-end submits placements.
        const studentMap = answer?.placements || answer?.studentMap || null;

        return { correctMap, studentMap };
      }

      // SEQUENCE
      if (type === "sequence") {
        const correctOrder =
          Array.isArray(task?.correctOrder) ? task.correctOrder :
          Array.isArray(task?.order) ? task.order :
          null;

        const studentOrder = answer?.order || answer?.sequence || answer || null;

        return { correctOrder, studentOrder };
      }

      // DIFF DETECTIVE
      if (type === "diff-detective") {
        return {
          correctSpots: task?.spots || task?.correctSpots || null,
          studentSpots: answer?.spots || answer?.taps || null,
          matchedIds: aiScore?.matchedIds || null,
        };
      }

      // MATCHING (objective)
      if (type === "matching") {
        const cfg = task?.config || task || {};
        return {
          correctMatches: cfg?.correctMatches || task?.correctMatches || null,
          leftItems: cfg?.leftItems || task?.leftItems || null,
          rightItems: cfg?.rightItems || task?.rightItems || null,
        };
      }

      // TRUE/FALSE TIC-TAC-TOE
      if (type === "true-false-tictactoe") {
        // only if your task carries correct answers for each cell/statement
        return {
          correctAnswers: task?.correctAnswers || null,
          studentAnswers: answer?.answers || null,
        };
      }

      // SPEED DRAW
      if (type === "speed-draw") {
        return {
          word: task?.word || task?.prompt || null,
          guessedBy: answer?.guessedBy || answer?.winnerId || null,
          guesses: answer?.guesses || answer?.guessLog || null,
          timeMs: answer?.timeMs || null,
        };
      }

      // PHOTO (evidence)
      if (type === "photo") {
        const photoUrl =
          answer?.photoUrl ||
          answer?.url ||
          answer?.mediaUrl ||
          (Array.isArray(answer?.photos) ? answer.photos[0] : null) ||
          (Array.isArray(answer?.data?.photos) ? answer.data.photos[0] : null) ||
          null;

        return {
          prompt: task?.prompt || task?.title || null,
          photoUrl,
        };
      }

      // PHOTO JOURNAL (photo + caption)
      if (type === "photo-journal") {
        const photoUrl =
          answer?.photoUrl ||
          answer?.url ||
          answer?.mediaUrl ||
          (Array.isArray(answer?.photos) ? answer.photos[0] : null) ||
          (Array.isArray(answer?.data?.photos) ? answer.data.photos[0] : null) ||
          null;

        const caption =
          answer?.caption ||
          answer?.text ||
          answer?.answerText ||
          answer?.reflection ||
          answer?.explanation ||
          null;

        return {
          prompt: task?.prompt || task?.title || null,
          photoUrl,
          caption,
        };
      }

      // HIDENSEEK (photo + significance)
      if (type === "hidenseek") {
        const photoUrl =
          answer?.photoUrl ||
          answer?.url ||
          answer?.mediaUrl ||
          (Array.isArray(answer?.photos) ? answer.photos[0] : null) ||
          (Array.isArray(answer?.data?.photos) ? answer.data.photos[0] : null) ||
          null;

        const significance =
          answer?.significance ||
          answer?.why ||
          answer?.explanation ||
          answer?.text ||
          answer?.answerText ||
          null;

        return {
          pageReference:
            task?.pageReference ||
            task?.config?.pageReference ||
            task?.locationReference ||
            null,
          prompt: task?.prompt || task?.title || null,
          photoUrl,
          significance,
        };
      }

      // MULTI-PLAYER FEEDBACK (closer)
      if (type === "multi-player-feedback") {
        return {
          ratings: answer?.ratings || answer?.emojiRatings || null,
          comment: answer?.comment || answer?.feedback || null,
          learned: answer?.learned || answer?.whatILearned || null,
        };
      }

      // PRONUNCIATION (AI)
      if (type === "pronunciation") {
        return {
          phrase: task?.phrase || task?.prompt || null,
          transcript: answer?.transcript || answer?.text || null,
          aiFeedback: aiScore?.feedback || aiScore?.rationale || null,
          score: aiScore?.score ?? aiScore?.totalScore ?? null,
        };
      }

      
      // AI DEBATE JUDGE (AI)
      if (type === "ai-debate-judge") {
        return {
          prompt: task?.prompt || task?.title || null,
          side: answer?.side || answer?.data?.side || null,
          position: answer?.position || answer?.role || answer?.data?.position || null,
          transcript: answer?.transcript || answer?.recognizedText || answer?.text || null,
          recordingUrl:
            answer?.recordingUrl ||
            answer?.audioUrl ||
            answer?.mediaUrl ||
            answer?.fileUrl ||
            null,
          aiVerdict:
            aiScore?.verdict ||
            aiScore?.feedback ||
            aiScore?.rationale ||
            null,
          score: aiScore?.score ?? aiScore?.totalScore ?? null,
          timingPenalty: aiScore?.details?.timingPenalty ?? null,
          elapsedSeconds: aiScore?.details?.elapsedSeconds ?? null,
          winner: aiScore?.winner || aiScore?.details?.winner || null,
        };
      }

// SPEECH RECOGNITION (AI)
      if (type === "speech-recognition") {
        return {
          prompt: task?.prompt || task?.question || null,
          transcript: answer?.transcript || answer?.text || null,
          aiFeedback: aiScore?.feedback || aiScore?.rationale || null,
          score: aiScore?.score ?? aiScore?.totalScore ?? null,
        };
      }

      // SHORT ANSWER (AI)
      if (type === "short-answer") {
        return {
          aiSuggestedAnswer: aiScore?.suggestedAnswer || aiScore?.modelAnswer || null,
          aiFeedback: aiScore?.feedback || aiScore?.rationale || null,
          score: aiScore?.score ?? aiScore?.totalScore ?? null,
          maxScore: aiScore?.maxPoints ?? task?.points ?? null,
        };
      }

      return null;
    }

  const handleStationScan = (payload = {}, ack) => {
    try {
      const { roomCode, teamId, stationId, locationSlug } = payload || {};
      const code = normalizeRoomCode(roomCode);

      // Log AFTER variables exist
      console.log("[scan recv]", {
        rawRoomCode: roomCode,
        code,
        teamId,
        stationId,
        locationSlug,
        hasRoom: !!rooms[code],
        hasTeam: !!rooms?.[code]?.teams?.[teamId],
      });

      // 1) Session validity
      const room = rooms[code];
      const team = room?.teams?.[teamId];
      if (!code || !teamId || !room || !team) {
        console.error("Invalid scan (room/team missing):", { code, teamId });
        if (typeof ack === "function") ack({ ok: false, error: "Invalid session" });
        return;
      }

      // 2) Station correctness
      const expectedStation =
        team.currentStationId || team.stationId || team.station || null;
      const expected = normalizeStationId(expectedStation);
      const scanned = normalizeStationId(stationId);

      // If the team has no expected station yet, accept the scan as the initial assignment
      if (!expectedStation) {
        const norm = normalizeStationId(stationId);
        const canonicalId = norm?.id || stationId;

        team.currentStationId = canonicalId;
        team.lastScannedStationId = canonicalId;
      
        // (optional) also store color for convenience
        team.assignedColor = scanned?.color || null;

        if (typeof ack === "function") {
          ack({
            ok: true,
            initialAssignment: true,
            stationId,
            assignedStationId: stationId,
            assignedColor: scanned?.color || null,
          });
        }

        // Also push state so StudentApp gets assignedColor immediately
        io.to(code).emit("room:state", buildRoomState(room)); // or whatever you already use
        return;
      }

      const stationMatches =
        (expected.id && scanned.id && expected.id === scanned.id) ||
        (expected.color && scanned.color && expected.color === scanned.color);

      
if (!stationMatches) {
        console.error("Wrong station:", {
          expectedStation,
          expected,
          scannedStation: stationId,
          scanned,
        });

        const scannedLabel =
          (scanned?.color ? String(scanned.color).toUpperCase() : null) ||
          (scanned?.id ? String(scanned.id).toUpperCase() : null) ||
          (stationId ? String(stationId).toUpperCase() : "UNKNOWN");

        const expectedLabel =
          (expected?.color ? String(expected.color).toUpperCase() : null) ||
          (expected?.id ? String(expected.id).toUpperCase() : null) ||
          (expectedStation ? String(expectedStation).toUpperCase() : "YOUR STATION");

        const expectedLocationSlugOrLabel =
          team.locationSlug || room.locationCode || "Classroom";
        const expectedColorName = expected?.color || expectedLabel || "YOUR STATION";
        const goTo = formatGoTo(room, expectedLocationSlugOrLabel, expectedColorName);

        if (typeof ack === "function") {
          ack({
            ok: false,
            error: `Go to ${goTo}`,
            scannedStationId: scanned?.id || stationId || null,
            scannedColor: scanned?.color || null,
            expectedStationId: expected?.id || expectedStation || null,
            expectedColor: expected?.color || null,
          });
        }
        return;
      }

      // 3) Location correctness (multi-room only)
      const isMultiRoom =
        Array.isArray(room.selectedRooms) && room.selectedRooms.length > 1;

      if (isMultiRoom) {
        const classroomSlug = normalizeLocationSlug(room.locationCode || "Classroom");

        // Non-classroom locations are whatever teacher selected, excluding classroom
        const nonClassroom = new Set(
          (room.selectedRooms || [])
            .map((r) => normalizeLocationSlug(r))
            .filter((r) => r && r !== classroomSlug)
        );

        // If scan is NOT one of the non-classroom locations, treat it as Classroom
        let scannedLoc = normalizeLocationSlug(locationSlug);
        if (!nonClassroom.has(scannedLoc)) {
          scannedLoc = classroomSlug;
        }

        // Expected location: if team has none, default to Classroom
        const expectedLoc = normalizeLocationSlug(team.locationSlug || room.locationCode || "Classroom");

        // ✅ Only enforce mismatch if expected is a non-classroom location
        if (nonClassroom.has(expectedLoc) && scannedLoc !== expectedLoc) {
          if (typeof ack === "function") {
            ack({
              ok: false,
              error: `Go to ${expectedLoc.toUpperCase()} ${String(expected.color || "").toUpperCase()}`.trim(),
            });
          }
          return;
        }
      }


      // ✅ Mark scan accepted
      team.lastScannedStationId = expectedStation || stationId || null;

      // If this team has a queued task, deliver it now
      let deliveredTask = false;

      // If this team has a queued task, deliver it now
      if (room.taskset && Array.isArray(room.taskset.tasks)) {
        const queuedIndex =
          typeof team.nextTaskIndex === "number" && team.nextTaskIndex >= 0
            ? team.nextTaskIndex
            : -1;

        if (queuedIndex >= 0) {
          sendTaskToTeam(room, teamId, queuedIndex);
          delete team.nextTaskIndex;
          deliveredTask = true;
        }
      }

      const waitingForLaunch = !room.isActive; // taskset not launched yet

      if (typeof ack === "function") {
        ack({
          ok: true,
          message: "Correct station!",
          deliveredTask,
          waitingForLaunch,
        });
      }

      // Optional: Scan-and-confirm bonus points
      let currentTask = {};
      if (room.taskset && Array.isArray(room.taskset.tasks)) {
        const idx =
          typeof team.taskIndex === "number" && team.taskIndex >= 0
            ? team.taskIndex
            : typeof room.taskIndex === "number" && room.taskIndex >= 0
            ? room.taskIndex
            : -1;
        currentTask = idx >= 0 ? room.taskset.tasks[idx] || {} : {};
      }

      if (currentTask.taskType === "scan-and-confirm") {
        updateTeamScore(room, teamId, currentTask.points || 10);
      }

    } catch (err) {
      console.error("handleStationScan error:", err);
      if (typeof ack === "function") ack({ ok: false, error: "Server scan error" });
    }
  };

socket.on("station:scan", handleStationScan);

  // ==== BRAINSTORM BATTLE SOCKET EVENTS ====
  // Simple, durable model:
  //  - each brainstorm task has a taskKey
  //  - we collect ideas per team
  //  - broadcast a lightweight scoreboard to all teams
  function getBrainstormBucket(room, taskKey) {
    if (!room.brainstormBattles) {
      room.brainstormBattles = {};
    }
    if (!room.brainstormBattles[taskKey]) {
      room.brainstormBattles[taskKey] = {
        taskKey,
        startedAt: Date.now(),
        ideasByTeam: {},
      };
    }
    return room.brainstormBattles[taskKey];
  }

  function broadcastBrainstormUpdate(code, room, taskKey) {
    const bucket = room.brainstormBattles?.[taskKey];
    if (!bucket) return;

    const teamsPayload = {};
    Object.entries(bucket.ideasByTeam || {}).forEach(([teamId, ideas]) => {
      const team = (room.teams || {})[teamId];
      const label = team?.teamName || `Team-${String(teamId).slice(-4)}`;
      teamsPayload[teamId] = {
        teamId,
        teamName: label,
        ideaCount: ideas.length,
      };
    });

    io.to(code).emit("brainstorm:update", {
      taskKey,
      teams: teamsPayload,
    });

    // Also refresh global roomState so LiveSession can show counts
    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);
  }

  // Teacher can explicitly start a brainstorm battle for a given task
  socket.on("brainstorm:start", (payload = {}) => {
    const { roomCode, taskIndex } = payload;
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.taskset) return;

    const idx =
      typeof taskIndex === "number" && taskIndex >= 0
        ? taskIndex
        : room.taskIndex >= 0
        ? room.taskIndex
        : 0;

    const task = room.taskset.tasks[idx];
    if (!task || task.taskType !== "brainstorm-battle") return;

    const taskKey =
      task._id?.toString?.() || `${room.taskset._id || "set"}:${idx}`;

    const bucket = getBrainstormBucket(room, taskKey);
    bucket.startedAt = Date.now();
    bucket.ideasByTeam = {};

    broadcastBrainstormUpdate(code, room, taskKey);
  });

  // Student sends an idea (called directly from BrainstormBattleTask)
  socket.on("brainstorm:idea", (payload = {}) => {
    try {
      const code = (payload.roomCode || socket.data?.roomCode || "").toUpperCase();
      const room = rooms[code];
      if (!room) return;

      const teamId = payload.teamId || socket.data?.teamId;
      if (!teamId || !room.teams?.[teamId]) return;

      const taskIndex =
        typeof payload.taskIndex === "number" && payload.taskIndex >= 0
          ? payload.taskIndex
          : room.teams[teamId].taskIndex ?? room.taskIndex ?? 0;

      const task = room.taskset?.tasks?.[taskIndex];
      if (!task || task.taskType !== "brainstorm-battle") return;

      const rawIdea =
        typeof payload.ideaText === "string"
          ? payload.ideaText
          : typeof payload.idea === "string"
          ? payload.idea
          : "";
      const idea = rawIdea.trim();
      if (!idea) return;

      const taskKey =
        task._id?.toString?.() || `${room.taskset._id || "set"}:${taskIndex}`;

      const bucket = getBrainstormBucket(room, taskKey);
      if (!bucket.ideasByTeam[teamId]) {
        bucket.ideasByTeam[teamId] = [];
      }

      // Simple de-duplication (case-insensitive)
      const lowered = idea.toLowerCase();
      const existing = bucket.ideasByTeam[teamId].map((x) => x.toLowerCase());
      if (!existing.includes(lowered)) {
        bucket.ideasByTeam[teamId].push(idea);
      }

      broadcastBrainstormUpdate(code, room, taskKey);
    } catch (err) {
      console.error("Error in brainstorm:idea:", err);
    }
  });

  // Optional: Teacher can reset the battle for that task
  socket.on("brainstorm:reset", (payload = {}) => {
    const { roomCode, taskIndex } = payload;
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.taskset || !room.brainstormBattles) return;

    const idx =
      typeof taskIndex === "number" && taskIndex >= 0
        ? taskIndex
        : room.taskIndex >= 0
        ? room.taskIndex
        : 0;

    const task = room.taskset.tasks[idx];
    if (!task || task.taskType !== "brainstorm-battle") return;

    const taskKey =
      task._id?.toString?.() || `${room.taskset._id || "set"}:${idx}`;

    if (room.brainstormBattles[taskKey]) {
      delete room.brainstormBattles[taskKey];
    }

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);
  });


  // ===========================================================
  // Mood Check-in (vibe setter; no scoring / no timer)
  // Student emits: "submit-mood-checkin" with { roomCode, teamId, moods[], excitement }
  // We store it so HostView/LiveSession can optionally display it.
  // ===========================================================
  socket.on("submit-mood-checkin", (payload = {}, ack) => {
    try {
      const { roomCode, teamId, moods, excitement } = payload || {};
      const code = (roomCode || "").toUpperCase();
      const room = rooms[code];
      if (!room) {
        if (typeof ack === "function") ack({ ok: false, error: "Room not found" });
        return;
      }

      const effectiveTeamId = teamId || socket.data.teamId;
      if (!effectiveTeamId) {
        if (typeof ack === "function") ack({ ok: false, error: "Missing teamId" });
        return;
      }

      if (!room.moodCheckins || typeof room.moodCheckins !== "object") {
        room.moodCheckins = {};
      }

      const safeMoods = Array.isArray(moods)
        ? moods.map((n) => (Number.isInteger(n) && n >= 0 && n <= 4 ? n : null))
        : [];

      room.moodCheckins[String(effectiveTeamId)] = {
        moods: safeMoods,
        excitement: typeof excitement === "string" ? excitement.trim().slice(0, 500) : "",
        submittedAt: Date.now(),
      };

      // broadcast lightweight update (safe for UIs that don't listen)
      io.to(code).emit("mood-checkin:update", {
        teamId: String(effectiveTeamId),
        moods: safeMoods,
        excitement: typeof excitement === "string" ? excitement.trim().slice(0, 500) : "",
      });

      // keep room state in sync for any dashboards
      const state = buildRoomState(room);
      io.to(code).emit("room:state", state);
      io.to(code).emit("roomState", state);

      if (typeof ack === "function") ack({ ok: true });
    } catch (err) {
      console.error("submit-mood-checkin failed:", err);
      if (typeof ack === "function") ack({ ok: false, error: "Server error" });
    }
  });
  const handleStudentSubmit = async (payload, ack) => {
    const { roomCode, teamId, taskIndex, timeMs } = payload || {};
    let { answer } = payload || {};

    // ✅ Normalize TaskRunner-style wrapped answers:
    // TaskRunner often sends: answer = { type: <taskType>, answer: <string|object> }
    // and multi-question tasks may send JSON strings like:
    //   { kind: "multi-short-answer", answers: [...] }
    //   { kind: "multi-true-false",  answers: [...] }
    const unwrapRunnerAnswer = (val) => {
      if (
        val &&
        typeof val === "object" &&
        Object.prototype.hasOwnProperty.call(val, "answer") &&
        Object.prototype.hasOwnProperty.call(val, "type") &&
        typeof val.type === "string"
      ) {
        return val.answer;
      }
      return val;
    };

    answer = unwrapRunnerAnswer(answer);

    // If answer is a JSON string for multi-question packs, parse it.
    if (typeof answer === "string") {
      const s = answer.trim();
      if (s.startsWith("{") && s.endsWith("}")) {
        try {
          const parsed = JSON.parse(s);
          if (parsed && typeof parsed === "object") {
            answer = parsed;
          }
        } catch {
          // ignore JSON parse failures
        }
      }
    }

    // Normalize legacy multi-pack shapes into the scoring engine shape.
    // Our central scorer expects: { type: "multi-choice"|"multi-short", answers: [{ itemId, value, baseIndex? }] }
    if (answer && typeof answer === "object" && Array.isArray(answer.answers) && typeof answer.kind === "string") {
      if (answer.kind === "multi-short-answer") {
        const vals = Array.isArray(answer.answers) ? answer.answers : [];
        answer = {
          type: "multi-short",
          answers: vals.map((v, i) => ({ itemId: String(i), value: v })),
        };
      } else if (answer.kind === "multi-true-false") {
        const vals = Array.isArray(answer.answers) ? answer.answers : [];
        answer = {
          type: "multi-choice",
          answers: vals.map((v, i) => ({ itemId: String(i), value: v })),
        };
      }
    }

    // ✅  Normalize multi-pack answers sent as JSON strings from StudentApp/TaskRunner
    if (typeof answer === "string") {
      try {
        const parsed = JSON.parse(answer);

        if (
          parsed &&
          typeof parsed === "object" &&
          Array.isArray(parsed.answers) &&
          parsed.answers.length > 0
        ) {
          const kind = parsed.kind || parsed.type;

          if (kind === "multi-mc" || kind === "multi-choice") {
            answer = { type: "multi-choice", answers: parsed.answers };
          } else if (kind === "multi-short" || kind === "multi-sa") {
            answer = { type: "multi-short", answers: parsed.answers };
          } else if (parsed.type === "multi-choice" || parsed.type === "multi-short") {
            answer = parsed;
          }
        }
      } catch (err) {
        // Not JSON; keep as plain string answer
      }
    }

const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.taskset) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Room or taskset not found" });
      }
      return;
    }

    const effectiveTeamId = teamId || socket.data.teamId;
    const team = room.teams[effectiveTeamId] || {};

    // Use explicit taskIndex if provided, otherwise this team's current index
    const idx =
      typeof taskIndex === "number" && taskIndex >= 0
        ? taskIndex
        : typeof team.taskIndex === "number" && team.taskIndex >= 0
        ? team.taskIndex
        : room.taskIndex;

    const task = room.taskset.tasks[idx];
    if (!task) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Task not found" });
      }
      return;
    }

    const teamName =
      team.teamName || `Team-${String(effectiveTeamId).slice(-4)}`;

    const meta = TASK_TYPE_META?.[task.taskType] || {};
    const isObjective = meta.objectiveScoring === true;
    const basePoints = task.points ?? 10;

    // Detect multi-question pack answers from TaskRunner
    const isMultiPack =
      answer &&
      typeof answer === "object" &&
      Array.isArray(answer.answers) &&
      answer.answers.length > 0 &&
      (answer.type === "multi-choice" ||
        answer.type === "multi-short" ||
        answer.type === "multi-true-false" ||
        answer.kind === "multi-short-answer" ||
        answer.kind === "multi-true-false");

    // Build answerText for transcripts/logging
    const answerText = (() => {
      if (isMultiPack) {
        try {
          return answer.answers
            .map((a, i) => {
              const label = a?.prompt || `Q${i + 1}`;
              const val =
                a?.value != null ? String(a.value).trim() : "(no answer)";
              return `${i + 1}) ${label}: ${val}`;
            })
            .join(" | ");
        } catch {
          return JSON.stringify(answer);
        }
      }

      if (typeof answer === "string") return answer;

      if (answer && typeof answer === "object") {
        const textLike =
          answer.explanation ??
          answer.caption ??
          answer.text ??
          answer.response ??
          answer.answerText ??
          answer.notes ??
          null;

        if (typeof textLike === "string" && textLike.trim().length > 0) {
          return textLike;
        }

        try {
          return JSON.stringify(answer);
        } catch {
          return "[object]";
        }
      }

      if (answer != null) return String(answer);
      return "";
    })();

    // Submission object passed into aiScoring (for non-multi cases)
    const submissionForScoring = {
      answer,
      answerText,
    };

    let aiScore = null;
    let correct = null;
    let pointsEarned = 0;

    // ----------------------------
    // 1) Multi-question packs
    // ----------------------------
    if (isMultiPack && Array.isArray(task.items) && task.items.length > 0) {
      const items = task.items;
      const byId = new Map();
      items.forEach((it, i) => {
        const key = it.id != null ? String(it.id) : String(i);
        byId.set(key, { item: it, index: i });
      });

      let correctCount = 0;
      let evaluatedCount = 0;

      for (const entry of answer.answers) {
        if (!entry) continue;
        const rawId = entry.itemId != null ? String(entry.itemId) : null;
        const mapKey = rawId ?? String(evaluatedCount);
        const target = byId.get(mapKey);
        if (!target) {
          evaluatedCount += 1;
          continue;
        }

        const { item } = target;
        const givenValue = entry.value;
        const givenBaseIndex =
          typeof entry.baseIndex === "number" ? entry.baseIndex : null;

        let isCorrectItem = null;

        // Multi-choice items: compare index (preferred) or text
        if (answer.type === "multi-choice") {
          const itemCorrect = item.correctAnswer;
          const baseOptions = Array.isArray(item.options)
            ? item.options
            : Array.isArray(item.choices)
            ? item.choices
            : task.taskType === "true-false"
            ? ["True", "False"]
            : [];

          if (typeof itemCorrect === "number" && baseOptions.length > 0) {
            // compare indices
            if (
              givenBaseIndex != null &&
              givenBaseIndex >= 0 &&
              givenBaseIndex < baseOptions.length
            ) {
              isCorrectItem = givenBaseIndex === itemCorrect;
            } else if (givenValue != null) {
              const idxBase = baseOptions.findIndex(
                (opt) => String(opt).trim() === String(givenValue).trim()
              );
              isCorrectItem = idxBase === itemCorrect;
            }
          } else if (typeof itemCorrect === "string" && givenValue != null) {
            isCorrectItem =
              String(givenValue).trim().toLowerCase() ===
              itemCorrect.trim().toLowerCase();
          }
        }
        // Short-answer items: compare string to reference
        else if (answer.type === "multi-short") {
          const itemCorrect =
            typeof item.correctAnswer === "string"
              ? item.correctAnswer.trim()
              : null;
          if (itemCorrect && givenValue != null) {
            isCorrectItem =
              String(givenValue).trim().toLowerCase() ===
              itemCorrect.toLowerCase();
          }
        }

        if (isCorrectItem === true) {
          correctCount += 1;
        }
        evaluatedCount += 1;
      }

      const totalItems = items.length;
      const usedItems = evaluatedCount || totalItems;
      const fraction =
        usedItems > 0 ? Math.max(0, Math.min(1, correctCount / usedItems)) : 0;

      pointsEarned = Math.round(basePoints * fraction);

      // correct flag: only "true" if perfect, "false" if all wrong, null for partial
      if (fraction === 1) {
        correct = true;
      } else if (fraction === 0) {
        correct = false;
      } else {
        correct = null;
      }

      aiScore = {
        totalScore: pointsEarned,
        maxPoints: basePoints,
        correctCount,
        totalItems,
        evaluatedItems: usedItems,
        fractionCorrect: fraction,
        strategy: "rule-based-multi-item",
      };
    }

    // ----------------------------
    // 2) Non-multi tasks → Matching (objective)
    // ----------------------------
    const isVennSort = task.taskType === "vennsort" || task.taskType === "venn-sort";

    // ----------------------------
    // 2a) Non-multi objective tasks (MC / TF / Short Answer)
    // ----------------------------
    const normalizeTF = (v) => {
      if (typeof v === "boolean") return v ? "true" : "false";
      if (typeof v === "number") return v === 0 ? "true" : v === 1 ? "false" : String(v);
      const s = String(v ?? "").trim().toLowerCase();
      if (["true", "t", "yes", "y", "1"].includes(s)) return "true";
      if (["false", "f", "no", "n", "0"].includes(s)) return "false";
      return s;
    };

    const normalizeText = (v) =>
      String(v ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

    const awardObjective = (isCorrect) => {
      correct = isCorrect;
      pointsEarned = isCorrect ? basePoints : 0;
      aiScore = {
        strategy: "objective",
        maxPoints: basePoints,
        totalScore: pointsEarned,
        correct: isCorrect,
      };
    };

    // Non-multi TRUE_FALSE
    if (!isMultiPack && task.taskType === "true-false") {
      const given = normalizeTF(answerText ?? answer);
      const expected = (() => {
        const ca = task.correctAnswer ?? (task.payload && task.payload.correctAnswer);
        // Correct answer might be 0/1, boolean, or "true"/"false"
        const exp = normalizeTF(ca);
        // Some generators use 0=True, 1=False; normalizeTF already maps 0->true,1->false
        return exp;
      })();
      if (given === "true" || given === "false") {
        awardObjective(given === expected);
      }
    }

    // Non-multi MULTIPLE_CHOICE
    if (!isMultiPack && task.taskType === "multiple-choice" && pointsEarned === 0 && correct === null) {
      const options = Array.isArray(task.options)
        ? task.options
        : Array.isArray(task.choices)
        ? task.choices
        : [];
      const ca = task.correctAnswer ?? (task.payload && task.payload.correctAnswer);
      const expectedIndex =
        typeof ca === "number"
          ? ca
          : typeof ca === "string" && /^\d+$/.test(ca.trim())
          ? Number(ca.trim())
          : null;

      // Answer may be index, numeric string, or option text.
      const givenRaw = answerText ?? answer;
      const givenIndex =
        typeof givenRaw === "number"
          ? givenRaw
          : typeof givenRaw === "string" && /^\d+$/.test(givenRaw.trim())
          ? Number(givenRaw.trim())
          : null;

      if (typeof expectedIndex === "number" && typeof givenIndex === "number") {
        awardObjective(givenIndex === expectedIndex);
      } else if (typeof expectedIndex === "number" && typeof givenRaw === "string") {
        const expectedText = options[expectedIndex] != null ? String(options[expectedIndex]) : "";
        awardObjective(normalizeText(givenRaw) === normalizeText(expectedText));
      } else if (typeof ca === "string" && typeof givenRaw === "string") {
        awardObjective(normalizeText(givenRaw) === normalizeText(ca));
      }
    }

    // Non-multi SHORT_ANSWER (objective with AI assist when mismatch)
    if (!isMultiPack && task.taskType === "short-answer" && pointsEarned === 0 && correct === null) {
      const given = normalizeText(answerText ?? answer);
      const expected = task.correctAnswer ?? (task.payload && task.payload.correctAnswer);
      const acceptable =
        Array.isArray(task.acceptableAnswers)
          ? task.acceptableAnswers
          : task.payload && Array.isArray(task.payload.acceptableAnswers)
          ? task.payload.acceptableAnswers
          : null;

      const candidates = [];
      if (typeof expected === "string" && expected.trim()) candidates.push(expected);
      if (Array.isArray(expected)) expected.forEach((x) => candidates.push(x));
      if (Array.isArray(acceptable)) acceptable.forEach((x) => candidates.push(x));

      const match = candidates
        .map((c) => normalizeText(c))
        .filter(Boolean)
        .some((c) => c === given);

      if (match) {
        awardObjective(true);
      } else if (given.length > 0) {
        // AI assist: allow partial credit for close answers / reject nonsense.
        try {
          aiScore = await generateAIScore({
            task: {
              ...task,
              objectiveHint: candidates.filter(Boolean).slice(0, 8),
            },
            rubric: task.aiRubric || null,
            submission: {
              ...submissionForScoring,
              objectiveHint: candidates.filter(Boolean).slice(0, 8),
            },
          });

          const aiNumericScore =
            aiScore && typeof aiScore.score === "number"
              ? aiScore.score
              : aiScore && typeof aiScore.totalScore === "number"
              ? aiScore.totalScore
              : null;

          if (typeof aiNumericScore === "number") {
            pointsEarned = Math.max(0, Math.min(basePoints, aiNumericScore));
            correct = pointsEarned === basePoints ? true : pointsEarned === 0 ? false : null;
            if (aiScore && aiScore.maxPoints == null) aiScore.maxPoints = basePoints;
            if (aiScore && aiScore.totalScore == null) aiScore.totalScore = pointsEarned;
          }
        } catch (e) {
          // If AI scoring fails, just mark incorrect.
          awardObjective(false);
        }
      }
    }


// Guess Who (yes/no deduction) – custom scoring: points scale by time + guess count
if (!isMultiPack && task.taskType === "guess-who") {
  const normalizeText = (v) =>
    String(v ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const correctAnswer =
    task.secretConcept ??
    task.secret ??
    task.concept ??
    task.answer ??
    task.correctAnswer ??
    (task.payload && (task.payload.secretConcept || task.payload.correctAnswer)) ??
    "";

  const submitted = normalizeText(answerText || answer);
  const expected = normalizeText(correctAnswer);

  // Establish per-team game state
  const taskKey = `${room.code}:guess-who:${idx}`;
  if (!room.guessWhoGames) room.guessWhoGames = {};
  if (!room.guessWhoGames[taskKey]) {
    room.guessWhoGames[taskKey] = {
      taskKey,
      taskIndex: idx,
      timeLimitSeconds:
        Number(task.timeLimitSeconds) > 0 ? Number(task.timeLimitSeconds) : 60,
      maxGuesses: Number(task.maxGuesses) > 0 ? Number(task.maxGuesses) : 10,
      startedAtByTeam: {},
      guessesByTeam: {},
      revealedByTeam: {},
    };
  }
  const game = room.guessWhoGames[taskKey];

  if (!game.startedAtByTeam[effectiveTeamId]) {
    // If the client didn't emit reveal (edge case), start timer on first guess
    game.startedAtByTeam[effectiveTeamId] = Date.now();
  }
  const startedAt = game.startedAtByTeam[effectiveTeamId];
  const elapsedSec = Math.max(0, (Date.now() - startedAt) / 1000);

  const prevGuesses = typeof game.guessesByTeam[effectiveTeamId] === "number" ? game.guessesByTeam[effectiveTeamId] : 0;
  const guessNum = prevGuesses + 1;
  game.guessesByTeam[effectiveTeamId] = guessNum;

  const isCorrect = expected.length > 0 && submitted.length > 0 && submitted === expected;

  // Scoring: start with time-based score then apply per-guess penalty
  const limit = Number(game.timeLimitSeconds) > 0 ? Number(game.timeLimitSeconds) : 60;
  const maxGuesses = Number(game.maxGuesses) > 0 ? Number(game.maxGuesses) : 10;

  let timeFactor = 1;
  if (limit > 0) timeFactor = Math.max(0, Math.min(1, 1 - elapsedSec / limit));

  // More points for quicker identification; keep at least 1 for a correct answer
  const timeScore = Math.round(basePoints * timeFactor);

  // Penalize extra guesses (first guess is "free" in this model)
  const guessPenalty = Math.max(0, guessNum - 1);

  let numericScore = 0;
  if (isCorrect) {
    numericScore = Math.max(1, timeScore - guessPenalty);
  } else {
    // Wrong guess: 0 points
    numericScore = 0;
  }

  // If they exceed max guesses, force 0 unless they already got it correct on/before max
  const maxReached = guessNum >= maxGuesses;
  if (!isCorrect && guessNum > maxGuesses) numericScore = 0;

  aiScore = {
    strategy: "guess-who-rule-based",
    correct: !!isCorrect,
    numericScore,
    elapsedSec: Math.round(elapsedSec * 10) / 10,
    guessesUsed: guessNum,
    maxGuesses,
    timeLimitSeconds: limit,
    maxReached,
    expected: correctAnswer || null,
  };

  correct = !!isCorrect;

  // Let the client update its UI (guess count, timer start, etc.)
  io.to(effectiveTeamId).emit("guess-who:state", {
    taskKey,
    taskIndex: idx,
    startedAt,
    guessesUsed: guessNum,
    maxGuesses,
    timeLimitSeconds: limit,
    lastGuessCorrect: !!isCorrect,
  });
}

    if (!isMultiPack && task.taskType === "matching") {
      const scored = scoreMatchingTask(task, answer, basePoints);
      aiScore = scored.aiScore;
      correct = scored.correct;
      pointsEarned = scored.pointsEarned;
    }
    // ✅ NEW: VENNSORT (objective)
    if (!isMultiPack && isVennSort) {
      const scored = scoreVennSortTask(task, answer, basePoints);
      aiScore = scored.aiScore;
      correct = scored.correct;
      pointsEarned = scored.pointsEarned;
    }

    if (!isMultiPack && !isObjective && !aiScore) {
      // “Evidence tasks” are ones that don’t expect text and don’t have options,
      // e.g. photo, make-and-snap, body-break, etc.
      const isEvidenceTask =
        !!meta && meta.expectsText === false && meta.hasOptions === false;

      // Did the team actually submit *something*?
      const hasEvidence =
        answer != null &&
        (typeof answer === "string"
          ? answer.trim().length > 0
          : typeof answer === "object"
          ? Object.keys(answer).length > 0
          : true);

      // Some tasks should *never* auto-score (AI or rule-based). Example: NarrationSynthesize.
      // These are participation / peer-evaluation tasks. Award points on evidence.
      const noAutoScoring = meta?.noAutoScoring === true;

      if (noAutoScoring) {
        const submittedAt = Date.now();
        correct = null;
        pointsEarned = hasEvidence ? basePoints : 0;
        aiScore = {
          strategy: "participation-no-auto-scoring",
          maxPoints: basePoints,
          totalScore: pointsEarned,
        };
        // We'll use submittedAt again below, so keep it in scope:
        var submittedAtNonMulti = submittedAt;
      } else {
        try {
          aiScore = await generateAIScore({
            task,
            rubric: task.aiRubric || null,
            submission: submissionForScoring,
          });
        } catch (e) {
          console.error("AI / rule-based scoring failed:", e);
        }

        const submittedAt = Date.now();

        const aiNumericScore =
          aiScore && typeof aiScore.score === "number"
            ? aiScore.score
            : aiScore && typeof aiScore.totalScore === "number"
            ? aiScore.totalScore
            : null;

        correct = (() => {
          // Prefer AI / central scorer when available (AI or rule-based)
          if (aiNumericScore != null) {
            return aiNumericScore > 0;
          }
          // Fallback: legacy behaviour for simple correctAnswer tasks
          if (task.correctAnswer == null) return null;
          return String(answer).trim() === String(task.correctAnswer).trim();
        })();

        // 🔹 Special: SORT tasks send a percentage score from the front-end
        if (
          task.taskType === "sort" &&
          answer &&
          typeof answer === "object" &&
          typeof answer.score === "number"
        ) {
          const pct = Math.max(0, Math.min(100, answer.score));
          pointsEarned = Math.round((pct / 100) * basePoints);
        } else if (aiNumericScore != null) {
          // Use the central scorer's numeric score (may be partial credit)
          pointsEarned = aiNumericScore;
        } else if (correct === true) {
          // Normal case: exact match says it's correct → full points
          pointsEarned = basePoints;
        } else if (correct === null && isEvidenceTask && hasEvidence) {
          // Evidence tasks with "something" submitted get full credit.
          pointsEarned = basePoints;
        } else {
          pointsEarned = 0;
        }

        // We'll use submittedAt again below, so keep it in scope:
        var submittedAtNonMulti = submittedAt;
      }
    }

    // If we’re in the multi-pack path, we still need a timestamp
    const submittedAt = isMultiPack ? Date.now() : submittedAtNonMulti;

    // ==== Diff Detective race mechanics (first correct team wins bonus) ====
    if (
      task.taskType === "diff-detective" &&
      room.diffDetectiveRace &&
      room.diffDetectiveRace.taskIndex === idx &&
      room.diffDetectiveRace.active
    ) {
      const race = room.diffDetectiveRace;

      if (!race.completedTeams) {
        race.completedTeams = new Set();
      }

      if (!race.completedTeams.has(effectiveTeamId)) {
        race.completedTeams.add(effectiveTeamId);

        const timeFromStart =
          typeof race.startedAt === "number"
            ? submittedAt - race.startedAt
            : null;

        // First *correct* finisher becomes the winner
        if (correct === true && !race.winnerTeamId) {
          race.winnerTeamId = effectiveTeamId;

          const bonusPoints = 5; // tweak as you like

          // Add race bonus on top of normal points for this submission
          pointsEarned += bonusPoints;

          // Broadcast a winner event to teacher + all teams
          io.to(code).emit("diff-detective-race-winner", {
            roomCode: code,
            taskIndex: idx,
            teamId: effectiveTeamId,
            teamName,
            timeMs: timeFromStart,
            bonusPoints,
          });
        }

        // Optional: broadcast that this team has finished, even if not winner
        io.to(code).emit("diff-detective-race-finish", {
          roomCode: code,
          taskIndex: idx,
          teamId: effectiveTeamId,
          teamName,
          timeMs: timeFromStart,
          rank: race.completedTeams.size,
          correct,
        });
      }
    }

      const extractedPhotoUrl =
        answer?.photoUrl ||
        answer?.imageUrl ||
        answer?.fileUrl ||
        answer?.mediaUrl ||
        answer?.data?.photoUrl ||
        answer?.data?.imageUrl ||
        answer?.data?.fileUrl ||
        answer?.data?.mediaUrl ||
        (Array.isArray(answer?.photos) ? answer.photos[0] : null) ||
        (Array.isArray(answer?.data?.photos) ? answer.data.photos[0] : null) ||
        null;

    room.submissions.push({
      roomCode: code,
      teamId: effectiveTeamId,
      teamName,
      playerId: socket.data.playerId || null,
      taskIndex: idx,
      answer,
      photoUrl: extractedPhotoUrl,
      correct,
      points: pointsEarned,
      aiScore,
      timeMs: timeMs ?? null,
      submittedAt,
    });

    // After every graded submission, advance THIS team to the next station so they must rescan.
    reassignStationForTeam(room, effectiveTeamId);

    // Maybe award a random treat for this submission
    const isQuick =
      !!room.taskset &&
      room.taskset.name === "Quick task" &&
      Array.isArray(room.taskset.tasks) &&
      room.taskset.tasks.length === 1;

    if (!isQuick) {
      maybeAwardTreat(code, room, effectiveTeamId);
    }

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

    // Determine if this is a "quick taskset"
    const isQuickTaskset =
      !!room.taskset &&
      room.taskset.name === "Quick task" &&
      Array.isArray(room.taskset.tasks) &&
      room.taskset.tasks.length === 1;

    // Per-team progression
    if (room.taskset && Array.isArray(room.taskset.tasks)) {
      const currentIndex =
        typeof taskIndex === "number" && taskIndex >= 0
          ? taskIndex
          : typeof team.taskIndex === "number" && team.taskIndex >= 0
          ? team.taskIndex
          : idx;

      const nextIndex = currentIndex + 1;

      if (isQuickTaskset) {
        // One-off quick task: let sendTaskToTeam handle "session complete".
        sendTaskToTeam(room, effectiveTeamId, nextIndex);
      } else {
        // For normal tasksets, remember the next index and let the
        // next colour scan trigger delivery of the new task.
        if (!room.teams[effectiveTeamId]) {
          room.teams[effectiveTeamId] = {};
        }
        room.teams[effectiveTeamId].nextTaskIndex = nextIndex;
      }
    }

    const review = buildReviewPayload({ task, answer, correct, aiScore });

    const submissionSummary = {
      roomCode: code,
      teamId: effectiveTeamId,
      teamName,
      taskIndex: idx,
      answerText,
      correct,
      points: pointsEarned,
      timeMs: timeMs ?? null,
      submittedAt,
      aiScore, // <-- carries multi-pack or AI info, including PhotoJournal feedback
    };
    io.to(code).emit("taskSubmission", { ...submissionSummary, review });

    socket.emit("task:received");
    if (typeof ack === "function") {
      ack({
        ok: true,
        taskIndex: idx,
        points: pointsEarned,
        correct,
        review,
        aiScore,
      });
    }

    // ✅ Always acknowledge submissions so StudentApp can show overlays immediately
    if (typeof ack === "function") {
      ack({
        ok: true,
        roomCode: code,
        teamId: effectiveTeamId,
        taskIndex: idx,
        correct,
        points: pointsEarned,
        maxPoints: Number.isFinite(task?.points) ? Number(task.points) : 10,
        aiScore,
        review,
      });
    }

  };

  socket.on("student:submitAnswer", (payload, ack) => {
    handleStudentSubmit(payload, ack);
  });

  socket.on("task:requestNext", ({ roomCode, teamId } = {}, ack) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.taskset || !room.teams) {
      if (typeof ack === "function") ack({ ok: false, error: "Room not ready" });
      return;
    }

    const team = room.teams[teamId];
    if (!team) {
      if (typeof ack === "function") ack({ ok: false, error: "Team not found" });
      return;
    }

    if (!room.isActive) {
      if (typeof ack === "function") ack({ ok: false, waitingForLaunch: true });
      return;
    }

    // Canonical: consume unlocked index if present; otherwise re-send current; otherwise start at 0
    let idx;
    if (typeof team.nextTaskIndex === "number" && team.nextTaskIndex >= 0) {
      idx = Math.floor(team.nextTaskIndex);
      delete team.nextTaskIndex;
    } else if (typeof team.taskIndex === "number" && team.taskIndex >= 0) {
      idx = Math.floor(team.taskIndex); // idempotent
    } else {
      idx = 0;
    }

    sendTaskToTeam(room, teamId, idx);

    if (typeof ack === "function") ack({ ok: true, taskIndex: idx });
  });

// Guess Who (yes/no deduction) – start timer on first reveal (hold-to-reveal on client)
socket.on("guess-who:reveal", (payload = {}, ack) => {
  try {
    const { roomCode, teamId, taskIndex } = payload || {};
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !teamId) {
      if (typeof ack === "function") ack({ ok: false, error: "Room or team not found" });
      return;
    }

    const idx = Number.isFinite(Number(taskIndex)) ? Number(taskIndex) : room.teams?.[teamId]?.taskIndex ?? 0;
    const taskKey = `${room.code}:guess-who:${idx}`;

    if (!room.guessWhoGames) room.guessWhoGames = {};
    if (!room.guessWhoGames[taskKey]) {
      // Fallback init in case sendTaskToTeam didn't run (e.g., resume edge cases)
      const tasks = Array.isArray(room.taskset?.tasks) ? room.taskset.tasks : [];
      const task = tasks[idx] || {};
      room.guessWhoGames[taskKey] = {
        taskKey,
        taskIndex: idx,
        timeLimitSeconds:
          Number(task.timeLimitSeconds) > 0 ? Number(task.timeLimitSeconds) : 60,
        maxGuesses: Number(task.maxGuesses) > 0 ? Number(task.maxGuesses) : 10,
        startedAtByTeam: {},
        guessesByTeam: {},
        revealedByTeam: {},
      };
    }

    const game = room.guessWhoGames[taskKey];
    if (!game.startedAtByTeam[teamId]) {
      game.startedAtByTeam[teamId] = Date.now();
    }
    game.revealedByTeam[teamId] = true;
    if (typeof game.guessesByTeam[teamId] !== "number") game.guessesByTeam[teamId] = 0;

    // Notify only this team (teacher can still see via submissions/host view if desired)
    io.to(teamId).emit("guess-who:state", {
      taskKey,
      taskIndex: idx,
      startedAt: game.startedAtByTeam[teamId],
      guessesUsed: game.guessesByTeam[teamId],
      maxGuesses: game.maxGuesses,
      timeLimitSeconds: game.timeLimitSeconds,
    });

    if (typeof ack === "function") {
      ack({
        ok: true,
        taskKey,
        startedAt: game.startedAtByTeam[teamId],
        guessesUsed: game.guessesByTeam[teamId],
        maxGuesses: game.maxGuesses,
        timeLimitSeconds: game.timeLimitSeconds,
      });
    }
  } catch (e) {
    console.error("[guess-who:reveal] error", e);
    if (typeof ack === "function") ack({ ok: false, error: "Server error" });
  }
});


  socket.on("task:submit", (payload, ack) => {
    handleStudentSubmit(payload, ack);
  });

  // Backwards-compatible submit event names
  socket.on("submit-answer", (payload, ack) => {
    handleStudentSubmit(payload, ack);
  });
// ------------------------------
  // Teacher load taskset + location selections
  // ------------------------------
  async function handleTeacherLoadTaskset(payload = {}) {
    try {
      const {
        roomCode,
        tasksetId,
        selectedRooms,
        reportOwnerId,
        reportOwnerName,
        reportOwnerEmail,
        runByPresenterId,
        runByPresenterName,
        runByPresenterEmail,
        sharedToken,
      } = payload || {};
    const code = (roomCode || "").toUpperCase();

      if (!code || !tasksetId) {
        console.warn("handleTeacherLoadTaskset: missing roomCode or tasksetId");
        return;
      }

      const room = rooms[code];
      if (!room) {
        console.warn("handleTeacherLoadTaskset: room not found for", code);
        return;
      }

      // Multi-room scavenger hunt support
      if (Array.isArray(selectedRooms) && selectedRooms.length > 0) {
        room.selectedRooms = selectedRooms;
        console.log(
          `Room ${code} → Multi-room scavenger hunt:`,
          selectedRooms
        );
      } else {
        room.selectedRooms = null;
      }


      // Shared-link attribution (optional)
      if (reportOwnerId || reportOwnerName || reportOwnerEmail) {
        room.reportOwnerId = String(reportOwnerId || "").trim();
        room.reportOwnerName = String(reportOwnerName || "").trim();
        room.reportOwnerEmail = String(reportOwnerEmail || "").trim();
      }
      if (runByPresenterId || runByPresenterName || runByPresenterEmail) {
        room.runByPresenterId = String(runByPresenterId || "").trim();
        room.runByPresenterName = String(runByPresenterName || "").trim();
        room.runByPresenterEmail = String(runByPresenterEmail || "").trim();
      }
      if (sharedToken) room.sharedToken = String(sharedToken || "").trim();

      const tasksetDoc = await TaskSet.findById(tasksetId).lean();
      if (!tasksetDoc) {
        console.warn("handleTeacherLoadTaskset: TaskSet not found", tasksetId);
        socket.emit("taskset:error", { message: "Task Set not found" });
        return;
      }

      const tasks = Array.isArray(tasksetDoc.tasks) ? tasksetDoc.tasks : [];

      console.log(
        `handleTeacherLoadTaskset: loaded taskset ${tasksetId} for room ${code} with ${tasks.length} tasks`
      );

      // Attach full taskset to room
      room.taskset = {
        ...tasksetDoc,
        tasks,
      };
      room.taskIndex = -1;
      room.isActive = false;
      room.startedAt = null;

      // Let LiveSession & others refresh their state if needed
      const state = buildRoomState(room);
      io.to(code).emit("room:state", state);
      io.to(code).emit("roomState", state);

      // Notify the teacher client that the taskset is ready
      socket.emit("tasksetLoaded", {
        roomCode: code,
        tasksetId: String(tasksetDoc._id),
        name:
          tasksetDoc.name ||
          tasksetDoc.title ||
          tasksetDoc.tasksetName ||
          "Untitled set",
        numTasks: tasks.length,
        subject: tasksetDoc.subject || "",
        gradeLevel: tasksetDoc.gradeLevel || "",
      });
    } catch (err) {
      console.error("Error in handleTeacherLoadTaskset:", err);
      socket.emit("taskset:error", {
        message: "Failed to load task set.",
      });
    }
  }

  socket.on("teacher:loadTaskset", (payload) => {
    handleTeacherLoadTaskset(payload || {});
  });

  socket.on("loadTaskset", (payload) => {
    handleTeacherLoadTaskset(payload || {});
  });

  socket.on("teacher:startSession", (payload = {}) => {
    const { roomCode, selectedRooms: selectedRoomsRaw } = payload || {};
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    room.startedAt = Date.now();
    room.isActive = true;
    room.taskIndex = -1;
    room.lastTeacherSeenAt = Date.now();
    room.expiresAt = Date.now() + 1000 * 60 * 60;
    const selectedRooms = Array.isArray(selectedRoomsRaw)
      ? selectedRoomsRaw.map((s) => (s || "").toString().trim()).filter(Boolean)
      : [];
    room.enforceLocation = selectedRooms.length > 1;

    room.selectedRooms = selectedRooms;
    
    io.to(code).emit("session:started");
  });

  // OLD global next-task handler (kept as optional override button)
  function handleTeacherNextTask({ roomCode }) {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room || !room.taskset) return;

    room.taskIndex += 1;
    const index = room.taskIndex;

    if (index >= room.taskset.tasks.length) {
      io.to(code).emit("session:complete");
      return;
    }

    const task = room.taskset.tasks[index];

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

    io.to(code).emit("task:launch", {
      index,
      task,
      timeLimitSeconds: task.timeLimitSeconds ?? 0,
    });
  }

  //socket.on("teacher:nextTask", (payload) => {
  //  handleTeacherNextTask(payload || {});
  //});

  // 🚨 IMPORTANT: shared helper to start a taskset for all teams
  function startTasksetForRoom(roomCode) {
    const code = (roomCode || "").trim().toUpperCase();
    const room = rooms[code];

    if (!room || !room.taskset) {
      console.warn("startTasksetForRoom: no room or taskset for", code);
      return;
    }

    const tasks = Array.isArray(room.taskset.tasks)
      ? room.taskset.tasks
      : [];

    if (tasks.length === 0) {
      console.warn("startTasksetForRoom: taskset has no tasks for", code);
      return;
    }

    room.isActive = true;
    room.startedAt = Date.now();
    // Keep-alive bump so late joiners still see/find this room for at least an hour.
    room.lastTeacherSeenAt = Date.now();
    room.expiresAt = Date.now() + 1000 * 60 * 60;

    // Lightning round — only once per room
    if (!room.lightningInterval) {
      room.lightningInterval = setInterval(() => {
        const prompts = [
          "word about power",
          "animal that flies",
          "type of energy",
          "something that floats",
          "a loud sound",
          "a cold place",
          "a fast vehicle",
          "something green",
        ];
        const randomPrompt =
          prompts[Math.floor(Math.random() * prompts.length)];
        const randomTeam = getRandomTeam(code);

        io.to(code).emit("lightning-round", {
          prompt: randomPrompt,
          teamName: randomTeam?.teamName || "Someone",
        });
      }, 30000 + Math.random() * 10000); // 30–40 seconds
    }

    // Reset per-team progress
    Object.values(room.teams || {}).forEach((team) => {
      team.taskIndex = -1;
    });

    // Send task 0 to every joined team
    Object.keys(room.teams || {}).forEach((teamId) => {
      sendTaskToTeam(room, teamId, 0);
    });

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);
  }

  // Legacy entry point used by older clients
  socket.on("launchTaskset", ({ roomCode }) => {
    startTasksetForRoom(roomCode);
  });

  // Used by the new LiveSession green "Launch from taskset" button
  socket.on("teacher:launchNextTask", ({ roomCode }) => {
    startTasksetForRoom(roomCode);
  });

  // Quick ad-hoc task – one-off, BUT still uses an ephemeral taskset
  // so that handleStudentSubmit + scoring logic work.
  socket.on(
    "teacherLaunchTask",
    async (payload = {}) => {
      try {
        const { roomCode, task, prompt, correctAnswer, selectedRooms } = payload;
        const code = (roomCode || "").toUpperCase();
        if (!code) return;

        // Decide where the prompt is coming from
        const basePrompt =
          (task &&
            typeof task.prompt === "string" &&
            task.prompt.trim()) ||
          (typeof prompt === "string" && prompt.trim()) ||
          "";

        if (!basePrompt) return;

        let room = rooms[code];
        if (!room) {
          room = rooms[code] = await createRoom(code, socket.id);
        }

        // ✅ Multi-room support for quick tasks too
        if (Array.isArray(selectedRooms) && selectedRooms.length > 0) {
          room.selectedRooms = selectedRooms;
        } else {
          room.selectedRooms = null;
        }

        // Preserve as much info as LiveSession gave us as possible
        const quickTask = {
          taskType: (task && task.taskType) || "short-answer",
          prompt: basePrompt,
          correctAnswer:
            (task && task.correctAnswer) ||
            (typeof correctAnswer === "string" ? correctAnswer : null),
          options:
            task &&
            Array.isArray(task.options) &&
            task.options.length > 0
              ? task.options
              : undefined,
          // NEW: carry multi-question pack items into the quick task
          items:
            task &&
            Array.isArray(task.items) &&
            task.items.length > 0
              ? task.items
              : undefined,
          // NEW: carry Brain Spark Notes bullets into quick task payload
          bullets:
            task &&
            Array.isArray(task.bullets) &&
            task.bullets.length > 0
              ? task.bullets
              : undefined,
          points:
            task && typeof task.points === "number" ? task.points : 10,
          subject: (task && task.subject) || "Ad-hoc",
          gradeLevel: (task && task.gradeLevel) || "",
          clue:
            task && typeof task.clue === "string" ? task.clue : undefined,
          timeLimitSeconds:
            task && typeof task.timeLimitSeconds === "number"
              ? task.timeLimitSeconds
              : 0,
          quickTask: true,
        };

        // Tiny, ephemeral taskset so AI scoring + analytics all work
        room.taskset = {
          name: "Quick task",
          subject: quickTask.subject,
          gradeLevel: quickTask.gradeLevel,
          tasks: [quickTask],
          isQuickTaskset: true,
        };

        // Leave room.taskIndex "out of the way" – student sends taskIndex=0
        room.taskIndex = -1;

        io.to(code).emit("task:launch", {
          index: 0,
          task: quickTask,
          timeLimitSeconds: quickTask.timeLimitSeconds || 0,
        });
      } catch (err) {
        console.error("Error in teacherLaunchTask:", err);
      }
    }
  );

  // --------------------------
  // Teacher: random treats config
  // --------------------------
  socket.on("teacher:updateTreatsConfig", (payload = {}) => {
    const { roomCode, enabled, totalTreats } = payload;
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    ensureTreatsConfig(room);

    if (typeof enabled === "boolean") {
      room.treatsConfig.enabled = enabled;
    }
    if (typeof totalTreats === "number" && !Number.isNaN(totalTreats)) {
      const clean = Math.max(0, Math.floor(totalTreats));
      room.treatsConfig.total = clean;
      if (room.treatsConfig.given > clean) {
        room.treatsConfig.given = clean;
      }
    }

    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);
  });

  // --------------------------
  // Teacher: noise-control config
  // --------------------------
  socket.on("teacher:updateNoiseControl", (payload = {}) => {
    const { roomCode, enabled, threshold } = payload;
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    ensureNoiseControl(room);

    if (typeof enabled === "boolean") {
      room.noiseControl.enabled = enabled;
    }
    if (typeof threshold === "number" && !Number.isNaN(threshold)) {
      room.noiseControl.threshold = Math.max(
        0,
        Math.min(100, Math.floor(threshold))
      );
    }

    updateNoiseDerivedState(code, room);
  });

  // --------------------------
  // Noise samples from student/teacher devices
  // --------------------------
  socket.on("noise:sample", (payload = {}) => {
    const { roomCode, level } = payload;
    const code = (roomCode || socket.data?.roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    ensureNoiseControl(room);

    const numeric =
      typeof level === "number" ? level : Number(level) || 0;
    const clamped = Math.max(0, Math.min(100, numeric));

    if (typeof room.noiseLevel !== "number") {
      room.noiseLevel = clamped;
    } else {
      // Exponential moving average to smooth spikes
      room.noiseLevel = room.noiseLevel * 0.8 + clamped * 0.2;
    }

    updateNoiseDerivedState(code, room);
  });

  // Speed-draw race game
  socket.on("start-speed-draw", ({ roomCode, task }) => {
    raceWinner[roomCode] = null;
    io.to(roomCode).emit("speed-draw-question", task);
  });

  socket.on("speed-draw-answer", ({ roomCode, index, correct }) => {
    if (correct && !raceWinner[roomCode]) {
      raceWinner[roomCode] = socket.data.teamName;
      io.to(roomCode).emit("speed-draw-winner", {
        winner: socket.data.teamName,
      });
      updateTeamScore(roomCode, socket.data.teamId, 25);
    }
  });

  // Store per-team clues during session (global teamClues already declared)
  // Quick launch socket for generic tasks
  socket.on("start-task", ({ roomCode, taskId, taskType, taskData }) => {
    const session = getSessionByRoomCode(roomCode);
    if (!session) return;

    // Broadcast to all students in room
    io.to(roomCode).emit("new-task", {
      taskId,
      taskType,
      ...taskData,
    });

    console.log(`Task launched in ${roomCode}:`, taskType);
  });

  // Teacher ends session + email reports
  // Teacher ends session + generate immutable report snapshot + email teacher
// (Reports are stored in SessionReport; Session stays lightweight)
socket.on(
  "teacher:endSessionAndEmail",
  async ({
    roomCode,
    ownerId, // Option A: teacher identity comes from auth/profile on frontend
    teacherEmail, // optional override
    assessmentCategories,
    includeIndividualReports,
    schoolName,
    perspectives,
    className,
    gradeLevel,
    planTierUsed,
  } = {}) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) {
      socket.emit("transcript:error", { message: "Room not found" });
      return;
    }

    const safeOwnerId = String((ownerId || room.reportOwnerId || "").trim());

    // If ownerId isn't provided, try to infer from the connected teacher profile (best-effort)
    // NOTE: This is intentionally conservative to avoid mismatching owners.
    if (!safeOwnerId) {
      console.warn("teacher:endSessionAndEmail missing ownerId (Option A expects it).");
    }

    // 1) Build transcript + stats
    const transcript = buildTranscript(room);
    const perParticipant = computePerParticipantStats(room, transcript);

    // 2) Pull any photo/recording submissions (anything with photoUrl/mediaUrl)
    const mediaSubmissions = (Array.isArray(room.submissions) ? room.submissions : [])
      .filter((s) => !!(s && (s.photoUrl || s?.answer?.mediaUrl || s?.answer?.fileUrl || s?.answer?.recordingUrl)))
      .map((s) => {
        const url =
          s.photoUrl ||
          s?.answer?.recordingUrl ||
          s?.answer?.mediaUrl ||
          s?.answer?.fileUrl ||
          "";
        const task = room?.taskset?.tasks?.[s.taskIndex] || {};
        const taskType = task?.taskType || "unknown";
        const teamName = s.teamName || room?.teams?.[s.teamId]?.teamName || `Team-${String(s.teamId).slice(-4)}`;
        const label = `${taskType} - ${teamName} - Task ${Number.isFinite(s.taskIndex) ? (s.taskIndex + 1) : ""}`.trim();
        return {
          teamId: String(s.teamId || ""),
          teamName,
          taskIndex: s.taskIndex ?? null,
          taskType,
          label,
          url,
          submittedAt: s.submittedAt || null,
        };
      });

    // 3) Generate AI summary (overview + engagement)
    const summary = await generateSessionSummaries({
      roomCode: code,
      transcript,
      perParticipant,
      assessmentCategories,
      perspectives,
      className,
      gradeLevel,
      planTierUsed,
    });

    // 4) Compose parent note (safe, plain text; AI summary may also include one)
    const safeClass = (className || room?.taskset?.name || "class").toString().trim() || "class";
    const safeGrade = (gradeLevel || room?.taskset?.gradeLevel || "").toString().trim();
    const concepts =
      (summary && (summary.conceptsCovered || summary.concepts || summary.topics)) ||
      (room?.taskset?.subject ? [room.taskset.subject] : []);
    const conceptsText = Array.isArray(concepts) ? concepts.filter(Boolean).slice(0, 4).join(", ") : String(concepts || "");
    const activities =
      (summary && (summary.activities || summary.activityHighlights)) ||
      (room?.taskset?.tasks || []).slice(0, 3).map((t) => t?.title || t?.taskType).filter(Boolean);

    const activitiesText = Array.isArray(activities) ? activities.filter(Boolean).slice(0, 4).join(", ") : String(activities || "");

    const engagementText =
      (summary && (summary.engagementLevel || summary.engagement)) ||
      "good";
    const proficiencyText =
      (summary && (summary.overallProficiency || summary.proficiency)) ||
      "a developing level of proficiency";

    const parentNote =
      `Today in ${safeClass}${safeGrade ? ` (Grade ${safeGrade})` : ""}, we completed a Curriculate activity wherein students were actively involved in exploring/reviewing ${conceptsText || "key concepts"}. ` +
      `They completed activities such as ${activitiesText || "interactive team challenges"}. ` +
      `The level of engagement was ${engagementText}. ` +
      `Overall, students achieved ${proficiencyText}.`;

    // 5) Persist immutable report snapshot
    let reportDoc = null;
    try {
      if (safeOwnerId) {
        reportDoc = await SessionReport.create({
          ownerId: safeOwnerId,
          roomCode: code,
          className: safeClass,
          gradeLevel: safeGrade,
          planTierUsed: String(planTierUsed || "").trim(),
          sharedToken: room.sharedToken || "",
          sharedFromTeacherId: room.reportOwnerId || safeOwnerId || "",
          sharedFromTeacherName: room.reportOwnerName || "",
          sharedFromTeacherEmail: room.reportOwnerEmail || "",
          runByPresenterId: room.runByPresenterId || "",
          runByPresenterName: room.runByPresenterName || "",
          runByPresenterEmail: room.runByPresenterEmail || "",
          headline: (summary && (summary.headline || summary.title)) || `Curriculate Report — ${code}`,
          overviewEmail: (summary && (summary.emailOverview || summary.overview || "")) || "",
          parentNote,
          summary,
          transcript,
          noiseSummary: computeNoiseSummary(room?.noiseSamples || [], room?.noiseControl || {}),
          noiseSamples: Array.isArray(room?.noiseSamples) ? room.noiseSamples : [],
          perParticipant,
          mediaSubmissions,
          assessmentCategories: Array.isArray(assessmentCategories) ? assessmentCategories : [],
          includeIndividualReports: !!includeIndividualReports,
        });
      }
    } catch (e) {
      console.error("Failed to persist SessionReport:", e);
    }

    // 6) Determine teacher email (override -> profile -> payload)
    let toEmail = (teacherEmail || "").toString().trim();
    try {
      if (!toEmail && safeOwnerId) {
        const profile = await TeacherProfile.findOne({ ownerId: safeOwnerId }).lean();
        if (profile?.email) toEmail = String(profile.email).trim();
      }
    } catch (e) {
      console.warn("TeacherProfile email lookup failed:", e);
    }

    // 7) Send email (includes report teaser; emailer may attach PDF)
    try {
      await sendTranscriptEmail({
        to: toEmail,
        roomCode: code,
        schoolName,
        summary,
        transcript,
        perParticipant,
        assessmentCategories,
        includeIndividualReports,
        // New: include parent note + media list for the email template if supported
        parentNote,
        mediaSubmissions,
        // New: include reportId so email can point teacher to Reports page
        reportId: reportDoc?._id ? String(reportDoc._id) : null,
        planTierUsed,
      });

      // Notify teacher UI that the report is ready
      if (reportDoc?._id) {
        io.to(code).emit("report:ready", {
          roomCode: code,
          reportId: String(reportDoc._id),
        });
      }

      socket.emit("transcript:sent", {
        ok: true,
        email: toEmail || teacherEmail || "",
        reportId: reportDoc?._id ? String(reportDoc._id) : null,
      });
    } catch (e) {
      console.error("Transcript emailing failed:", e);
      socket.emit("transcript:error", {
        message: "Failed to send transcript email",
      });
    }
  }
);


  // ──────────────────────────────────────────────────────────────
  // Collaboration task: Random pairing + bonus for quality replies
  // Current team model: room.teams = { [teamId]: { teamName, members, ... } }
  // Uses teamId socket rooms (socket.join(teamId) already happens on join)
  // ──────────────────────────────────────────────────────────────

  // In-room pairing store keyed by taskId (or "default")
  function getOrCreateCollabState(room, taskId = "default") {
    if (!room._collab) room._collab = {};
    if (!room._collab[taskId]) {
      room._collab[taskId] = {
        // teamId -> partnerTeamId
        partnerByTeamId: {},
        // teamId -> mainAnswer
        mainByTeamId: {},
        createdAt: Date.now(),
      };
    }
    return room._collab[taskId];
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  socket.on("start-collaboration-task", ({ roomCode, taskId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const teamIds = Object.keys(room.teams || {});
    if (teamIds.length < 2) {
      socket.emit("error", { message: "Need at least 2 teams for collaboration" });
      return;
    }

    const state = getOrCreateCollabState(room, taskId || "default");
    state.partnerByTeamId = {};
    state.mainByTeamId = {};

    const shuffled = shuffle(teamIds);

    // Pair adjacent; if odd, last pairs with first
    for (let i = 0; i < shuffled.length; i += 2) {
      const a = shuffled[i];
      const b = shuffled[i + 1] || shuffled[0];
      state.partnerByTeamId[a] = b;
      state.partnerByTeamId[b] = a;
    }

    // Notify each team of partner (emit to teamId room)
    for (const teamId of teamIds) {
      const partnerId = state.partnerByTeamId[teamId];
      const partnerName =
        room.teams?.[partnerId]?.teamName || `Team-${String(partnerId).slice(-4)}`;

      io.to(teamId).emit("collaboration-paired", {
        taskId,
        partnerTeamId: partnerId,
        partnerTeam: partnerName,
      });
    }

    // Refresh teacher state view (optional)
    const rs = buildRoomState(room);
    io.to(code).emit("room:state", rs);
    io.to(code).emit("roomState", rs);
  });

  socket.on("collaboration-main-submit", ({ roomCode, taskId, teamId, mainAnswer }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const myTeamId = teamId || socket.data?.teamId;
    if (!myTeamId || !room.teams?.[myTeamId]) return;

    const state = getOrCreateCollabState(room, taskId || "default");
    const partnerId = state.partnerByTeamId?.[myTeamId] || null;

    state.mainByTeamId[myTeamId] = typeof mainAnswer === "string" ? mainAnswer : "";

    // Send main answer to partner (if paired)
    if (partnerId && room.teams?.[partnerId]) {
      const myName = room.teams?.[myTeamId]?.teamName || `Team-${String(myTeamId).slice(-4)}`;
      io.to(partnerId).emit("collaboration-partner-answer", {
        taskId,
        partnerTeamId: myTeamId,
        partnerName: myName,
        partnerAnswer: mainAnswer,
      });
    }

    // If you later want to store these as submissions, do it here.
  });

  socket.on("collaboration-reply", async ({ roomCode, taskId, teamId, reply }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const myTeamId = teamId || socket.data?.teamId;
    if (!myTeamId || !room.teams?.[myTeamId]) return;

    const text = typeof reply === "string" ? reply.trim() : "";
    if (!text) return;

    // AI score 0–5 for reply quality
    let bonus = null;
    try {
      bonus = await generateAIScore({
        task: {
          taskType: "collaboration-bonus",
          prompt: "Score this peer reply 0-5: thoughtful, specific, kind, and helpful.",
          points: 5,
        },
        rubric: {
          totalPoints: 5,
          criteria: [
            {
              id: "quality",
              label: "Reply quality",
              maxPoints: 5,
              description: "Reward replies that are thoughtful, specific, kind, and helpful to their partner.",
            },
          ],
        },
        submission: { answerText: text },
      });
    } catch (e) {
      console.warn("collaboration-reply AI scoring failed:", e);
    }

    const bonusPoints =
      (bonus && typeof bonus.score === "number"
        ? bonus.score
        : typeof bonus?.totalScore === "number"
        ? bonus.totalScore
        : 0) || 0;

    // Award the AI-derived bonus points (0–5)
    if (bonusPoints > 0) updateTeamScore(room, myTeamId, bonusPoints);

    // Tell the replying team their bonus
    io.to(myTeamId).emit("collaboration-bonus", {
      taskId,
      bonus: bonusPoints,
    });

    // Optional: refresh room state for teacher dashboards
    const rs = buildRoomState(room);
    io.to(code).emit("room:state", rs);
    io.to(code).emit("roomState", rs);
  });

  // ─────────────────────────────────────────────
  // Mystery Clue Cards — Memory Bonus (teamId-based)
  // ─────────────────────────────────────────────
  socket.on("mystery-clues-start", ({ roomCode, taskId, teamId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const tid = teamId || socket.data?.teamId;
    if (!tid) return;

    if (taskId && !String(taskId).includes("final")) {
      const clues = ["Apple", "Cat", "Rocket", "Pizza", "Ghost", "Lightning"]
        .sort(() => Math.random() - 0.5)
        .slice(0, 2 + Math.floor(Math.random() * 2)); // 2–3 clues

      teamClues.set(tid, clues);

      io.to(tid).emit("mystery-clues-reveal", {
        taskId,
        clues,
        duration: 8000,
      });
    }
  });

  socket.on("start-final-mystery-challenge", ({ roomCode, teamId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    // If teacher triggers this, broadcast to everyone with per-team clueCount
    const teamIds = Object.keys(room.teams || {});
    for (const tid of teamIds) {
      const clueCount = teamClues.get(tid)?.length || 3;
      io.to(tid).emit("mystery-clues-final", {
        type: "mystery-clues",
        isFinal: true,
        clueCount,
      });
    }
  });

  socket.on("mystery-clues-submit", ({ roomCode, teamId, selected }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const tid = teamId || socket.data?.teamId;
    if (!tid) return;

    const correctClues = teamClues.get(tid) || [];
    const isPerfect = arraysDeepEqual(
      [...(selected || [])].sort(),
      [...correctClues].sort()
    );

    if (isPerfect) {
      updateTeamScore(room, tid, 10);
      io.to(tid).emit("bonus-awarded", {
        points: 10,
        reason: "Perfect Memory!",
      });
    }

    io.to(tid).emit("mystery-clues-result", { correct: isPerfect });

    const rs = buildRoomState(room);
    io.to(code).emit("room:state", rs);
    io.to(code).emit("roomState", rs);
  });

  // ─────────────────────────────────────────────
  // True/False Tic-Tac-Toe (teamId-based game state)
  // ─────────────────────────────────────────────
  function getOrCreateTicTacToe(room, key = "default") {
    if (!room._tictactoe) room._tictactoe = {};
    if (!room._tictactoe[key]) {
      room._tictactoe[key] = {
        board: Array(9).fill(null),
        roles: { X: null, O: null }, // role -> teamId
        createdAt: Date.now(),
        key,
      };
    }
    return room._tictactoe[key];
  }

  socket.on("start-true-false-tictactoe", ({ roomCode, task, taskId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const teamIds = Object.keys(room.teams || {});
    if (teamIds.length < 2) return;

    const [a, b] = shuffle(teamIds).slice(0, 2);
    const statements = task?.statements || [];

    const key = taskId || "default";
    const state = getOrCreateTicTacToe(room, key);
    state.board = Array(9).fill(null);
    state.roles = { X: a, O: b };

    const aName = room.teams[a]?.teamName || `Team-${String(a).slice(-4)}`;
    const bName = room.teams[b]?.teamName || `Team-${String(b).slice(-4)}`;

    io.to(a).emit("tictactoe-start", {
      type: "true-false-tictactoe",
      taskId: key,
      teamRole: "X",
      opponent: bName,
      statements,
      board: state.board,
    });

    io.to(b).emit("tictactoe-start", {
      type: "true-false-tictactoe",
      taskId: key,
      teamRole: "O",
      opponent: aName,
      statements,
      board: state.board,
    });
  });

  socket.on("tictactoe-move", ({ roomCode, taskId, index, teamRole }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const key = taskId || "default";
    const state = getOrCreateTicTacToe(room, key);

    const idx = typeof index === "number" ? index : -1;
    if (idx < 0 || idx >= 9) return;

    // Update board server-side (prevents weird overwrites)
    if (state.board[idx] == null) state.board[idx] = teamRole;

    io.to(code).emit("tictactoe-update", {
      taskId: key,
      index: idx,
      symbol: teamRole,
      board: state.board,
    });
  });

  socket.on("tictactoe-winner", ({ roomCode, taskId, winnerRole }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const key = taskId || "default";
    const state = getOrCreateTicTacToe(room, key);

    const winnerTeamId = state.roles?.[winnerRole] || null;
    if (winnerTeamId && room.teams?.[winnerTeamId]) {
      updateTeamScore(room, winnerTeamId, 10);
      const winnerName =
        room.teams[winnerTeamId]?.teamName || `Team-${String(winnerTeamId).slice(-4)}`;

      io.to(code).emit("bonus-awarded", {
        teamId: winnerTeamId,
        team: winnerName,
        points: 10,
        reason: "Tic-Tac-Toe Win!",
      });

      const rs = buildRoomState(room);
      io.to(code).emit("room:state", rs);
      io.to(code).emit("roomState", rs);
    }
  });

  // ─────────────────────────────────────────────
  // Live debate (teamId-based)
  // ─────────────────────────────────────────────
  socket.on("start-live-debate", ({ roomCode, postulate, taskId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const teamIds = Object.keys(room.teams || {});
    if (teamIds.length === 0) return;

    const half = Math.ceil(teamIds.length / 2);
    const ordered = shuffle(teamIds);

    ordered.forEach((teamId, i) => {
      const side = i < half ? "for" : "against";
      const team = room.teams[teamId];
      io.to(teamId).emit("debate-start", {
        type: "live-debate",
        taskId: taskId || "default",
        postulate,
        mySide: side,
        myTeamId: teamId,
        myTeamName: team?.teamName || `Team-${String(teamId).slice(-4)}`,
        teamMembers: Array.isArray(team?.members) && team.members.length > 0
          ? team.members
          : ["Member 1", "Member 2", "Member 3"],
        responses: [],
      });
    });
  });

  socket.on("debate-response", async (data = {}) => {
    const code = (data.roomCode || "").toUpperCase();
    if (!code) return;

    // broadcast to whole room; clients can filter by taskId if needed
    io.to(code).emit("debate-new-response", data);
    // Future: when all teams have 3 responses → judge via AI
  });
  // ─────────────────────────────────────────────
  // Disconnect / offline cleanup (team sockets)
  // Add this AFTER debate-response (or near the bottom of connection handler)
  // ─────────────────────────────────────────────
  socket.on("disconnect", async (reason) => {
    try {
      // ✅ Teacher disconnect: stop broadcasting rooms from this LiveSession instance
      if (socket.data?.role === "teacher") {
        const instId = normalizeTeacherInstanceId(socket.data?.teacherInstanceId, socket.id);
        pruneTeacherRoomsByInstance(instId, null);
        return;
      }

      const code = (socket.data?.roomCode || "").toUpperCase();
      const teamId = socket.data?.teamId;

      // If this socket wasn't a team, ignore
      if (!code || !teamId) return;

      const room = rooms[code];
      if (!room || !room.teams?.[teamId]) return;

      const team = room.teams[teamId];

      // Mark offline (soft) immediately
      team.status = "offline";
      team.lastSeenAt = new Date();
      team.connected = false;

      // Persist offline state (best effort)
      try {
        const dbTeam = await TeamSession.findById(teamId);
        if (dbTeam) {
          dbTeam.status = "offline";
          dbTeam.lastSeenAt = new Date();
          await dbTeam.save();
        }
      } catch (e) {
        console.warn("disconnect: DB update failed:", e);
      }

      // Notify teacher + room UIs right away
      io.to(code).emit("team:offline", {
        teamId,
        teamName: team.teamName || `Team-${String(teamId).slice(-4)}`,
        reason,
      });

      const stateNow = buildRoomState(room);
      io.to(code).emit("room:state", stateNow);
      io.to(code).emit("roomState", stateNow);

      // If already scheduled, don't double-schedule
      if (team.offlineTimeout) clearTimeout(team.offlineTimeout);

      // Schedule hard cleanup (remove team) after OFFLINE_TIMEOUT_MS
      team.offlineTimeout = setTimeout(async () => {
        try {
          const r = rooms[code];
          if (!r?.teams?.[teamId]) return;

          const t = r.teams[teamId];

          // If they came back online, skip cleanup
          if (t.status === "online" || t.connected === true) return;

          // GOLD STANDARD: keep identity + DB record. Just mark stale/offline.
          t.status = "offline";
          t.connected = false;
          t.lastSeenAt = new Date();
          t.stale = true; // optional flag for UI/teacher

          // Optional: free station so the room doesn’t get “blocked” by offline teams
          const stationId = t.currentStationId;
          if (stationId && r.stations?.[stationId]?.assignedTeamId === teamId) {
            r.stations[stationId].assignedTeamId = null;
            // you may keep t.currentStationId as-is for continuity,
            // or clear it if you prefer forcing a fresh assignment on return:
            // t.currentStationId = null;
          }

          // Persist offline status (DO NOT DELETE)
          try {
            const dbTeam = await TeamSession.findById(teamId);
            if (dbTeam) {
              dbTeam.status = "offline";
              dbTeam.lastSeenAt = new Date();
              await dbTeam.save();
            }
          } catch (e) {
            console.warn("offline timeout: DB update failed:", e);
          }

          // Broadcast updated state
          const state = buildRoomState(r);
          io.to(code).emit("room:state", state);
          io.to(code).emit("roomState", state);

          io.to(code).emit("team:offline-timeout", {
            teamId,
            reason: "offline-timeout",
          });
        } catch (e) {
          console.error("offline timeout handler failed:", e);
        }
      }, OFFLINE_TIMEOUT_MS);
    } catch (err) {
      console.error("disconnect handler error:", err);
    }
  });
});

// ====================================================================
//  REST ROUTES – Profile, TaskSets, AI, Analytics
// ====================================================================

app.get("/db-check", async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({ ok: true, db: "reachable" });
  } catch (err) {
    console.error("DB check failed:", err);
    res.status(500).json({ ok: false, error: "DB unreachable" });
  }
});

async function getOrCreateProfileForUser({ ownerId, email } = {}) {
  if (!ownerId) throw new Error("Missing ownerId");

  let profile = await TeacherProfile.findOne({ ownerId });

  if (!profile) {
    profile = new TeacherProfile({
      ownerId,
      email: email || "",
    });
    await profile.save();
    return profile;
  }

  if (email && !profile.email) {
    profile.email = email;
    await profile.save();
  }

  return profile;
}

// ====================================================================
//  DEMO TASKSET (persisted in Mongo; regenerated only when asked)
// ====================================================================

const DEMO_ADMIN_KEY = String(process.env.DEMO_ADMIN_KEY || "").trim();
const DEMO_GRADE_LEVEL = process.env.DEMO_GRADE_LEVEL || "7";
const DEMO_SUBJECT = process.env.DEMO_SUBJECT || "General";

// Optional: extra vocab for the model (comma-separated)
const DEMO_VOCAB = (process.env.DEMO_VOCAB || "teamwork, integrity, perseverance")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Build from taskTypes meta so you don't maintain v=== lists by hand
// Derived from TaskTypes meta so you don't maintain lists by hand.
// Demo eligibility is explicit via demoEligible (fallback to legacy aiEligible during transition).
const DEMO_TASK_TYPES = Object.keys(TASK_TYPE_META).filter((t) => {
  const m = TASK_TYPE_META[t] || {};
  const demoOk = m.demoEligible === true || m.aiEligible === true; // back-compat
  return m.enabled !== false && m.implemented !== false && m.generatorEligible !== false && demoOk;
});

// Optional: fixed word bank used by the generator
const DEMO_WORD_BANK = [
  "latitude",
  "longitude",
  "equator",
  "hemisphere",
  "climate",
  "continent",
  "scale",
  "population",
  "migration",
  "resources",
  "economy",
  "culture",
  "learning",
  "teamwork",
  "integrity",
  "perseverance",
];

function buildDemoBody(extra = {}) {
  return {
    source: "demo",              // ✅ makes isDemoRequest true
    uniqueTaskTypes: true,       // ✅ ensures "one per type" path
    gradeLevel: DEMO_GRADE_LEVEL,
    subject: DEMO_SUBJECT,
    difficulty: "medium",
    aiWordBank: DEMO_WORD_BANK,
    vocab: DEMO_VOCAB,
    taskTypes: DEMO_TASK_TYPES,
    numberOfTasks: DEMO_TASK_TYPES.length,
    ...extra,
  };
}

// A stable signature that changes when you add/remove task types or word bank items.
// (So you can choose to auto-regenerate when the app evolves.)
function buildDemoSignature() {
  return JSON.stringify({
    gradeLevel: DEMO_GRADE_LEVEL,
    subject: DEMO_SUBJECT,
    taskTypes: DEMO_TASK_TYPES,
    aiWordBank: DEMO_WORD_BANK,
    vocab: DEMO_VOCAB,
  });
}

function requireDemoAdmin(req, res) {
  const key = String(req.headers["x-demo-admin-key"] || "").trim();
  if (!DEMO_ADMIN_KEY || key !== DEMO_ADMIN_KEY) {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return true;
  }
  return false;
}

// Run an Express handler and capture res.json payload
async function runJsonHandler(handler, reqLike) {
  return new Promise((resolve, reject) => {
    const resLike = {
      _status: 200,
      status(code) {
        this._status = code;
        return this;
      },
      json(payload) {
        resolve({ status: this._status, payload });
      },
      send(payload) {
        resolve({ status: this._status, payload });
      },
      end() {
        resolve({ status: this._status, payload: null });
      },
      set() {
        return this;
      },
    };

    Promise.resolve(handler(reqLike, resLike)).catch(reject);
  });
}

function normalizeTaskset(payload) {
  if (!payload) return null;
  return (
    payload.taskset ||
    payload.taskSet ||
    payload.data?.taskset ||
    payload.result?.taskset ||
    null
  );
}

// --------------------------------------------------------------------
// Per-user Teacher Profile (auth required)
// --------------------------------------------------------------------
app.get("/api/profile/me", authRequired, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    const profile = await getOrCreateProfileForUser({ ownerId, email: req.user?.email });
    const plain = profile.toObject();
    plain.presenterTitle = plain.presenterTitle || plain.title || "";
    plain.title = plain.title || plain.presenterTitle || "";
    res.json(plain);
  } catch (err) {
    console.error("Profile fetch failed (/api/profile/me):", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

 app.get("/api/profile", authRequired, async (req, res) => {
   try {
     const ownerId = getOwnerId(req);
     if (!ownerId) return res.status(401).json({ ok: false, error: "Unauthorized" });

     const profile = await getOrCreateProfileForUser({
       ownerId,
       email: req.user?.email || "",
     });

     return res.json({
       ok: true,
       userId: ownerId,
       email: (req.user?.email || profile.email || "").toLowerCase(),
       name: req.user?.name || profile.presenterName || profile.displayName || "",
       isAdmin: !!(profile.isAdmin || req.user?.isAdmin),
       entryCode: profile.entryCode || "",     // IMPORTANT: your schema defaults to ""
       planTier: null,
      // ✅ Rooms for multi-room (fix: always return it)
      locationOptions: Array.isArray(profile.locationOptions)
        ? profile.locationOptions
        : ["Classroom"],
      // Optional passthrough
      treatsPerSession:
        typeof profile.treatsPerSession === "number"
          ? profile.treatsPerSession
          : undefined,
     });
   } catch (e) {
     console.error("GET /api/profile failed:", e);
     return res.status(500).json({ ok: false, error: "Server error" });
   }
 });

app.put("/api/profile/me", authRequired, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    const profile = await getOrCreateProfileForUser({ ownerId, email: req.user?.email });

    const body = { ...req.body };
    if (body.presenterTitle && !body.title) body.title = body.presenterTitle;
    if (body.title && !body.presenterTitle) body.presenterTitle = body.title;

    Object.assign(profile, body);
    await profile.save();

    const plain = profile.toObject();
    plain.presenterTitle = plain.presenterTitle || plain.title || "";
    plain.title = plain.title || plain.presenterTitle || "";
    res.json(plain);
  } catch (err) {
    console.error("Profile update failed (/api/profile/me):", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

app.put("/api/profile", authRequired, async (req, res) => {
   try {
     const userId = req.user?.id || req.user?._id || req.user?.userId;
     if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

     const profile = await TeacherProfile.findOne({ userId });
     if (!profile) return res.status(404).json({ ok: false, error: "Profile not found" });

    // --- MULTI-ROOM: persist teacher-defined room list ---
    if ("locationOptions" in (req.body || {})) {
      const raw = Array.isArray(req.body.locationOptions) ? req.body.locationOptions : [];
      const cleaned = Array.from(
        new Set(
          raw
            .map((s) => (s || "").toString().trim())
            .filter(Boolean)
        )
      );
      profile.locationOptions = cleaned.length ? cleaned : ["Classroom"];
    }

     await profile.save();
     return res.json(profile);
   } catch (err) {
     console.error("PUT /api/profile error:", err);
     return res.status(500).json({ ok: false, error: "Server error" });
   }
 });

app.post("/api/tasksets", async (req, res) => {
  try {
    const t = new TaskSet(req.body);
    await t.save();
    res.status(201).json(t);
  } catch (err) {
    console.error("POST /api/tasksets error:", err);
    res.status(500).json({ error: "Failed to create task set" });
  }
});

async function extractStudentWorkFromLink(url) {
  try {
    const u = new URL(url);

    if (u.hostname === "docs.google.com" || u.hostname === "www.docs.google.com") {
      const m = u.pathname.match(/^\/document\/d\/([a-zA-Z0-9_-]+)/);
      if (m) {
        const docId = m[1];
        const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;

        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);

        const r = await fetch(exportUrl, {
          redirect: "follow",
          headers: { "Accept": "text/plain,text/*;q=0.9,*/*;q=0.1" },
          signal: ctrl.signal,
        }).finally(() => clearTimeout(t));

        const body = await r.text();

        const looksLikeHtml = /^\s*<!doctype html>|^\s*<html/i.test(body);
        if (!r.ok || looksLikeHtml) {
          return {
            kind: "error",
            error:
              "Could not access that Google Doc. Make sure it’s shared as “Anyone with the link can view” (no sign-in).",
          };
        }

        const text = body.trim();
        if (!text) return { kind: "error", error: "Google Doc export returned empty text." };

        return { kind: "text", text };
      }
    }

    return { kind: "error", error: "Unsupported link type. Please paste the student work as text." };
  } catch {
    return { kind: "error", error: "Invalid link URL." };
  }
}

app.get("/grading/capture/:submissionId/:file", async (req, res) => {
  try {
    const { submissionId, file } = req.params;
    
    // Validate file param early (right here)
    if (!/^image-\d+\.jpg$/i.test(file)) {
      return res
        .status(200)
        .set("Content-Type", "text/html")
        .set("Cache-Control", "no-store")
        .send(gradingExpiredHtml());
    }

    const record = await GradingCapture.findOne({ submissionId }).lean();
    if (!record) {
      // expired or never existed
      return res
        .status(200)
        .set("Content-Type", "text/html")
        .set("Cache-Control", "no-store") // ✅ 2) no-store on expired html
        .send(gradingExpiredHtml());
    }

    const s3 = getS3Client();
    if (!s3) {
      // If S3 isn't configured, treat as expired UX-wise
      return res
        .status(200)
        .set("Content-Type", "text/html")
        .set("Cache-Control", "no-store") // ✅
        .send(gradingExpiredHtml());
    }

    const key = `grading/${submissionId}/${file}`;

    // Only allow keys recorded for this submission
    if (!record.keys.includes(key)) {
      return res
        .status(200)
        .set("Content-Type", "text/html")
        .set("Cache-Control", "no-store") // ✅
        .send(gradingExpiredHtml());
    }

    const getCmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    const signedUrl = await getSignedUrl(s3, getCmd, { expiresIn: 300 }); // 5 minutes

    // Redirect to signed URL (optional: prevent caching of redirect)
    return res
      .status(302)
      .set("Cache-Control", "no-store")
      .redirect(signedUrl);

  } catch (err) {
    console.error("grading capture error:", err);
    return res
      .status(200)
      .set("Content-Type", "text/html")
      .set("Cache-Control", "no-store") // ✅
      .send(gradingExpiredHtml());
  }
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function parseDataUrlImage(dataUrl) {
  const s = String(dataUrl || "");
  const m = s.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  const contentType = m[1];
  const b64 = m[2];
  const buf = Buffer.from(b64, "base64");
  return { contentType, buf };
}

function gradingExpiredHtml({ brand = "Curriculate" } = {}) {
  return `<!doctype html>
    <html>
    <head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width,initial-scale=1"/>
      <title>Link Expired • ${brand}</title>
      <style>
        body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; margin:0; background:#0b1220; color:#e5e7eb;}
        .wrap{max-width:760px; margin:0 auto; padding:36px 18px;}
        .card{background:#111a2e; border:1px solid rgba(255,255,255,.10); border-radius:16px; padding:22px;}
        h1{margin:0 0 10px; font-size:22px;}
        p{margin:0 0 12px; line-height:1.5; color:#cbd5e1;}
        .cta{display:inline-block; margin-top:12px; background:#2563eb; color:#fff; text-decoration:none; padding:10px 14px; border-radius:12px; font-weight:800;}
        .muted{font-size:13px; color:#94a3b8; margin-top:12px;}
        .pill{display:inline-block; background:rgba(37,99,235,.15); border:1px solid rgba(37,99,235,.35); color:#bfdbfe;
          padding:6px 10px; border-radius:999px; font-weight:700; font-size:12px; margin-bottom:10px;}
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="card">
          <div class="pill">This grading link has expired</div>
          <h1>Thanks for supporting learning.</h1>
          <p>This link was created to share a temporary snapshot of student work and automatically expires after a period of time.</p>
          <p><b>Parents:</b> Want faster feedback, clearer progress, and more engaging learning at school?</p>
          <p>Ask your child’s teacher: <b>“Are we using Curriculate yet?”</b></p>
          <a class="cta" href="https://www.curriculate.net">Learn about Curriculate</a>
          <div class="muted">Curriculate helps classrooms run interactive learning stations with meaningful assessment and reporting.</div>
        </div>
      </div>
    </body>
    </html>`;
    }

function voiceStyleSpec(voice = "warm") {
  const baseGuardrails = `
VOICE GUARDRAILS (always):
- Be kind, respectful, and teacher-appropriate.
- Never insult, shame, mock, or use harsh sarcasm.
- No "roasting" or mean humor. If humor is used, keep it light and supportive.
- Avoid slang that could be misunderstood by students/parents.
- Keep feedback practical and specific to visible evidence.

SCORING INTEGRITY (always):
- Voice affects tone AND leniency on borderline cases, but it does NOT allow ignoring clearly incorrect answers.
- Do not inflate marks beyond what the visible work supports; instead, emphasize progress, partial credit, and achievable next steps.
`.trim();

  const specs = {
    professional: `
VOICE: Professional
- Tone: neutral, calm, formal-but-friendly.
- Sentence length: medium.
- Style: clear, objective, minimal emotion.
- Teacher_comment: encouraging but measured.
`.trim(),

    warm: `
VOICE: Warm & encouraging
- Tone: positive, supportive, uplifting.
- Sentence length: short-to-medium.
- Style: celebrate wins first; gentle phrasing for corrections.
- Teacher_comment: affirm effort + one clear improvement + brief tip.
`.trim(),

    direct: `
VOICE: Direct & concise
- Tone: straightforward, no fluff.
- Sentence length: short.
- Style: prioritize clarity, quick actionable next step.
- Teacher_comment: 2 short sentences max unless absolutely needed.
`.trim(),

    coach: `
VOICE: Detailed coach
- Tone: supportive, instructional, growth-minded.
- Sentence length: medium.
- Style: include 1 concrete example of how to improve (based on the work).
- Teacher_comment: can use 3 sentences if it adds clarity.
`.trim(),

    gentle_firm: `
VOICE: Gentle but firm
- Tone: caring, steady, clear expectations.
- Sentence length: short-to-medium.
- Style: name what’s good; state what must improve; keep it respectful.
- Teacher_comment: avoid softness that hides the main issue.
`.trim(),

    witty_light: `
VOICE: Witty (light)
- Tone: friendly, light humor permitted.
- Sentence length: short-to-medium.
- Style: 0–1 playful phrase max; never distract from clarity.
- Teacher_comment: must remain respectful and useful.
`.trim(),

    standards: `
VOICE: Standards-based (rubric language)
- Tone: objective, criteria-aligned.
- Sentence length: medium.
- Style: use assessment language (e.g., "meets", "approaching", "exceeds") without sounding robotic.
- Teacher_comment: reference criteria briefly (clarity/accuracy/completeness) without overdoing it.
`.trim(),

    student_friendly: `
VOICE: Student-friendly (simple wording)
- Tone: clear, encouraging, accessible.
- Sentence length: short.
- Style: avoid advanced vocabulary; make next steps easy to follow.
- Teacher_comment: write as if the student will read it directly.
`.trim(),

    iep_supportive: `
VOICE: IEP-supportive (high encouragement, gentle marking)
- Tone: very encouraging, affirming, calm, confidence-building.
- Sentence length: short; simple wording.
- Style: spotlight what the student DID successfully first; describe gaps as "next steps" not "failures."
- Marking approach (leniency):
  - Prioritize evidence of understanding over mechanics, handwriting, spelling, or minor format issues.
  - Award generous partial credit when the student shows the right idea even if incomplete.
  - If an answer is ambiguous but plausibly correct and the work shows the concept, lean toward partial credit rather than zero.
  - Do not deduct for neatness/presentation unless it prevents reading the work.
  - Keep improvements small and achievable (1–2 bite-sized actions).
- Teacher_comment: 2–3 sentences:
  1) celebrate a specific win,
  2) one gentle next step,
  3) brief encouragement ("You’re getting there—keep going.").
`.trim(),
  };

  const chosen = specs[voice] || specs.warm;

  return `${baseGuardrails}\n\n${chosen}`.trim();
}

  function buildRubricInstructions({
    gradeBand = "6-8",
    rubricOverride = "",
    feedbackVoice = "warm",
    feedbackVoiceMode = "default",
  } = {}) {
  const gradeExpectations = {
      "3-5": `
    GRADE LEVEL: 3–5
    - Simple sentences or point-form is fine.
    - Meeting expectations: 1–2 correct points per question is often sufficient.
    - Be encouraging; focus on understanding and completion. Mechanics are secondary.
    `.trim(),

      "6-8": `
    GRADE LEVEL: 6–8
    - Short-answer: 2–3 accurate, relevant points per question is sufficient.
    - Paragraph: clear claim + some explanation + an example when applicable.
    - Do not demand essay-level depth for short-answer. Tone: firm-kind, practical.
    `.trim(),

      "9-10": `
    GRADE LEVEL: 9–10
    - Expect clearer reasoning and more precision.
    - Short-answer: 3+ strong points or brief explanation per point.
    - Paragraph: clearer structure and some evidence when appropriate.
    `.trim(),

      "11+": `
    GRADE LEVEL: 11+
    - Expect well-developed explanations, evidence, precision, academic structure.
    - Short-answer still concise but more analytical and specific.
    `.trim(),
    };

    return `
    You are a teacher grading a specific student assignment based ONLY on the attached photos.

    WORLDVIEW LENS (gentle):
    When the task involves values, purpose, identity, morality, justice, meaning, or worldview-type reflection, respond from a respectful Christian perspective (grace + truth, human dignity). Do not preach; keep it classroom-appropriate and kind. For non-worldview questions, grade normally.

    ${gradeExpectations[gradeBand] || gradeExpectations["6-8"]}

    ${voiceStyleSpec(feedbackVoice)}

    VOICE APPLICATION (required):
    - Apply the selected VOICE to: strengths, improvements, teacher_comment, and every sections[].teacher_comment.
    - Keep structure the same; only change phrasing and tone.
    - Do not add extra fields.
    - Do not add jokes unless VOICE allows light humor (and even then, max 0–1 brief phrase).
    - If VOICE is "iep_supportive": be more generous with partial credit and reduce emphasis on mechanics, while still following denominators/sections and question directions.

    FEEDBACK LANGUAGE RULE (grade-band aligned):
    - For 3–5: Use simple, direct language. Short sentences. Avoid abstract vocabulary.
    - For 6–8: Use clear middle-school teacher tone. Practical, specific, not overly academic.
    - For 9–10: Use more precise academic language and clearer reasoning.
    - For 11+: Use mature, concise, academically appropriate phrasing.
    - Strengths, improvements, and teacher_comment must match the selected grade level tone.

    STUDENT NAME:
    - Always set student_name to null.
    - Do NOT personalize feedback.
    - Do NOT address the student by name in strengths, improvements, or teacher_comment.

    STEP 1 — DETECT RESPONSE FORMAT (required):
    Choose ONE:
    - "short-answer" (brief/point-form, a few lines each)
    - "paragraph" (multi-sentence explanations)
    - "mixed" (both)
    - "test" (multiple sections like matching, MC, short answer)
    Set response_format_detected accordingly and calibrate expectations to that format.

    TEACHER KEY / ANSWER KEY DETECTION (critical):
    Some images may be a teacher-provided marking guide, not student work.

    If any page contains cues such as:
    - "Answer Key", "Answers", "Solutions", "Solution", "Teacher Key", "Marking Guide", "Key", "Sample Answer", "Exemplar"
    - or it clearly shows correct answers written as a reference (not in student handwriting / not in a student response format)

    Then that page is a TEACHER KEY.

    Rules when a TEACHER KEY is present:
    - Do NOT treat that page as the student’s submission.
    - Use it as the authoritative basis for grading the student pages in this submission.
    - For each question/item you grade, compare the student response to the TEACHER KEY’s correct answer.
    - If the TEACHER KEY contradicts your general knowledge, the TEACHER KEY wins.
    - Do NOT deduct the student for not matching formatting/layout of the key; only correctness.
    - Never list TEACHER KEY text as “student evidence.” Evidence must come from the student page, while correctness comes from the key.
    - If a Teacher Key is present, do NOT create a separate "Teacher Key" section; it is not a student section and must not appear in sections[].

    STEP 2 — DETERMINE THE GRADING SCALE (critical):
    Use /10 ONLY when no explicit denominator is visible.
    “Explicit denominator” includes any visible point totals like “/20”, “/40”, “out of 25”, section totals like “Matching /10”, or rubric category points.
    - If NO explicit denominator is visible: set overall_out_of = 10 and use /10 fields.
    - If an explicit denominator IS visible (test sections or rubric categories): the final grade MUST use that denominator instead of /10.
    
    DENOMINATOR SOURCE RULE (critical):
    An "explicit denominator" may come from:
    - the student pages (visible totals), OR
    - a provided rubricOverride text, OR
    - extracted rubricText (even if the rubric is not visible in the current student images).

    If rubricOverride or rubricText specifies any total or section out_of values, you MUST use those denominators even if the current student images do not show them.
    
    DENOMINATOR PRIORITY (must follow):
    1) If a rubricOverride or rubricText is being used AND it contains denominators, those denominators control overall_out_of/sections out_of.
    2) Else if the student pages show denominators (total or section out_of), those control.
    3) Else overall_out_of = 10.

    STEP 3 — GRADE CONTENT (primary):
    Grade for: completeness, accuracy/understanding, clarity, effort, thoroughness appropriate to the grade level.
    All feedback must cite visible evidence from the student work (e.g., “In question 2…”, “Your chart…”).
    Do NOT invent issues.
    
    QUESTION-DIRECTIONS MARKING (mandatory):
    If a question includes marking directions (e.g., "1 mark for a closing sentence", "2 marks for evidence", "include 3 reasons", "label all parts", "show your work", "units required"),
    you MUST grade exactly according to those directions.

    Rules:
    - Treat stated marks/criteria inside the question as the marking scheme for that question.
    - If a required element is missing, reduce the score by the amount indicated (e.g., missing closing sentence = –1 mark).
    - If the directions specify multiple components, allocate marks component-by-component.
    - If the question gives a total but no explicit component breakdown, infer a fair split based on the directions (e.g., 3 required reasons = roughly 1 mark each).
    - Do not “make up” extra requirements beyond what the directions ask.

    Score calibration (content-only base score out of 10) — ONLY used when overall_out_of is 10:
    - 9–10: excellent understanding, accurate, thoughtful connections, strong organization for the format (minor mechanics do not prevent a 9–10)
    - 8–8.5: very good with minor clarity/mechanics gaps
    - 7–7.5: adequate with noticeable gaps or weak explanations
    - <7: incomplete, unclear, or inaccurate
    If the work shows strong understanding + accurate details + organized response for the format, the base score should not be below 8.

    COMPONENT-BASED QUESTION TOTAL (critical):
    If a single question specifies component marks (e.g., "1 mark for introduction, 4 marks for support, 1 mark for closing"),
    you MUST:

    1) Sum those components to determine the total for that question (e.g., 1+4+1 = 6).
    2) Allocate marks strictly by component (intro, support, closing, etc.).
    3) If any component is missing, deduct exactly that component’s value.
    4) Treat that summed total as the denominator for that question.
    5) Ensure section totals include the full component-based total for that question.

    You may NOT:
    - collapse component marks into a vague overall score,
    - invent a different denominator,
    - or ignore a stated component breakdown.

    TEST/QUIZ RULE (mandatory):
    If any page shows (a) named sections, (b) section score boxes, or (c) point totals for parts (e.g., ___/10, Matching /8, Part A /15),
    then response_format_detected MUST be "test" and you MUST create sections[] for each named section with visible out_of totals.
    - Create sections[] for each visible section.
    - Each section must include: name, score, out_of, and a ONE-sentence teacher_comment.
    - Set overall_out_of to the sum of section out_of totals.
    - Section out_of must reflect the true total of all question denominators within that section, including any component-based question totals.
    - Set overall_score to the sum of section scores.
    For test-style sections … include incorrect_items listing only incorrect questions.
    - Keep prompts short. Include student_answer and correct_answer for each incorrect item.
    - If all items are correct, return incorrect_items: null.
    If the test shows ANY section score boxes or named parts with out_of values, sections MUST be a non-empty array (not null).
    For math questions:
    - If numeric answer is correct but unit is missing when required, deduct 0.5 from that question.
    - Reflect this in the section score.
    - Do NOT treat this as a formatting deduction.
    True/False extraction rule: True/False questions appear as a question number followed by the letters T and F (e.g., 12. T F). The student indicates their choice by circling exactly one letter.
    - Your job is to read exactly which letter is circled and record it as "T" or "F".
    - Do not infer from context. Do not “correct” the student.
    - If you cannot clearly see which letter is circled, return "unclear" for that item.
    - The circled letter will have a pencil/pen circle around it; the other letter will not.
    - Ignore the non-circled letter completely.
    - Never swap T and F. Only report what is circled, even if it seems “wrong.”
    - Only count a letter as chosen if it is circled; do not treat darker ink, proximity, or smudges as a choice.
    For multiple choice and true/false:
    - Read the student mark carefully.
    - If the mark is ambiguous, say it is unclear.
    - Do NOT assume a choice.
    - Only report an answer as incorrect if the student’s selected letter clearly differs from the correct answer.
    - If student answer equals correct answer, do NOT list it as incorrect.
    When reporting incorrect_items:
    - Double-check that student_answer !== correct_answer before including it.
    - Never include items where they match.
    SECTION REPORTING RULE (must follow):
    - If the test provides named sections with out_of values (even if the teacher has not filled them in), you MUST:
      1) create one sections[] entry per named section,
      2) use the printed out_of for each section,
      3) score that section based only on the questions belonging to that section,
      4) set overall_out_of = sum of section out_of,
      5) set overall_score = sum of section scores.
    - If the test does NOT provide section totals, you may still create sections[] if the test is clearly divided (e.g., "Matching", "Multiple Choice"), but you must use only denominators that are explicitly visible.
    DO NOT revert to /10 if any section out_of values are visible anywhere (including score boxes). Visible denominators always control overall_out_of.

    RUBRIC OVERRIDE RULE:
    If a rubric override is provided and it specifies categories and point values:
    - Create sections[] that match the rubric categories and totals.
    - Use the rubric’s totals for out_of values.
    - Set overall_out_of to the rubric total (sum of section out_of, or stated total).
    - Set overall_score to the sum of section scores.
    - If the rubric conflicts with defaults, rubric wins.
    - For rubric-based sections, do NOT include incorrect_items; instead, cite specific evidence in teacher_comment for each section.
    - Never interpret unchecked boxes on a rubric sheet as missing work.
    
    RUBRIC DENOMINATOR REQUIREMENT:
    If you are using rubricOverride or rubricText, you MUST identify the total possible points.
    - If the rubric defines section totals, use them as section out_of and sum them.
    - If the rubric states a single total (e.g., "/25"), use that as overall_out_of.
    - If the rubric text does NOT contain any denominator at all, then and only then you may use /10.

    If a rubricOverride or extracted rubricText is provided:
    - You MUST grade strictly according to that rubric.
    - You MUST use its scoring scale and denominator.
    - If the rubric specifies a total (e.g., /20, /40, /50), set overall_out_of to that number.
    - Do NOT default to /10 unless the rubric explicitly uses /10.
    - Do NOT invent a new denominator.

    RUBRIC EXTRACTION REQUIREMENT (critical):
    When you extract rubricText, you MUST include denominators:
    - If you see a total like "/25" or "Total: 25", include a line: "Total: /25".
    - If you see category points (e.g., Ideas 10, Organization 5), include each as "Ideas: /10" etc.
    - If you cannot see any denominator, include: "Total: (not visible)" (do NOT invent one).

    SECTIONS REQUIREMENT (schema-critical):
    Every section object MUST include incorrect_items.
    - If the section is NOT a test-style section (rubric category, writing, etc.): incorrect_items MUST be null.
    - If the section IS test-style: incorrect_items is either an array of incorrect question objects OR null (if none wrong).

    Important fairness rule:
    Do not “search for deductions.” If the work is strong/excellent, the score must reflect that even if minor issues exist.

    STEP 4 — FORMATTING DEDUCTION (quiet, max –1 total):
    Formatting deduction rule:
    - Formatting may contribute at most ONE deduction item worth 1 point total.
    - Only deduct if a required formatting element is clearly missing.
    - Do NOT mention formatting in strengths, improvements, or teacher_comment.

    IEP formatting rule:
    - If VOICE is "iep_supportive":
      - Do NOT deduct for formatting unless the issue severely impacts readability (e.g., missing pages, unreadable layout).
      - Minor formatting issues (missing date, small spacing inconsistencies) must NOT trigger deduction.

    If a formatting deduction is applied:
    { "reason": "Formatting requirements missing (specific issue cited)", "points": 1 }

    Otherwise: no formatting deduction item.

    ---

    DEDUCTIONS STRUCTURE RULE:
    - deductions[] may include multiple items (e.g., formatting + spelling + grammar).
    - Formatting is capped at ONE item worth 1 point max.
    - Spelling/mechanics must be grouped into ONE item (not one-per-word).

    ---

    DEDUCTIONS (required, evidence-based):

    - Do not “search for deductions.” Only deduct when there is a clear, visible issue.
    - If you deduct points, you MUST enumerate the issues specifically (no vague phrases like “minor errors”).
    - Every deduction reason must cite concrete visible evidence (e.g., “Q4…”, “In your paragraph about…”, “In the chart…”).

    Spelling/mechanics:

    Spelling fairness rule (always):
    - Do NOT deduct for US vs Commonwealth spelling differences (e.g., color/colour, center/centre, organize/organise, behavior/behaviour, defense/defence, traveled/travelled).
    - These are considered correct variations.
    - Only count an item as a spelling error if it is incorrect in BOTH major conventions.
    - Do NOT deduct for proper nouns unless clearly incorrect.

    If VOICE is "iep_supportive":
    - Do NOT deduct for spelling, punctuation, capitalization, or minor grammar unless errors severely prevent understanding.
    - Prioritize content understanding over surface errors.
    - If errors severely prevent understanding, include at most ONE mechanics-related deduction item.

    Otherwise (non-IEP voices):
    - If there is more than 1 spelling error in the assignment, include ONE spelling/mechanics deduction item.
    - List up to 5 examples as: wrong → correct.
    - Typical max for spelling/mechanics is 1 point unless errors are frequent and clearly reduce clarity.
    - Grade-band sensitivity:
      - For 3–5: Only deduct for spelling if errors clearly interfere with meaning.
      - For 6–8: Deduct for repeated spelling errors that reflect lack of proofreading.
      - For 9–10 and 11+: Expect stronger mechanics; repeated spelling errors usually warrant deduction.

    Grammar/usage:

    If VOICE is "iep_supportive":
    - Do NOT deduct for minor grammar issues unless they severely reduce clarity.

    Otherwise:
    - If grammar errors meaningfully reduce clarity, include ONE deduction item describing the pattern (e.g., “sentence fragments”, “run-ons”).

    Tests/quizzes:
    - Wrong answers are reflected in section scores.
    - Do NOT also add “wrong answers” as separate deduction items unless there is a separate rubric rule.

    IMPORTANT:
    - Formatting deduction is separate from spelling/mechanics.
    - Total deductions must match the sum of deduction items.

    IMPROVEMENTS RULE (critical):
    Only suggest improvements that are demonstrably missing or weak in the student work shown.
    If an item is already present (labels, spacing, etc.), do not suggest it.

    HANDWRITING RULE:
    - If neat and legible: do not mention handwriting (unless praising notably neat/consistent presentation).
    - Only comment if readability is clearly impacted.

    ACADEMIC INTEGRITY:
    Only set ai_suspected_cheating or copying_suspected if there is a clear visible reason; otherwise null.

    OUTPUT (JSON only; EXACT fields):
    - response_format_detected ("short-answer"|"paragraph"|"mixed"|"test")
    - student_name (null)   // must always be null
    - overall_score (number)
    - overall_out_of (number)
    - sections (array of { name, score, out_of, teacher_comment, incorrect_items } OR null)

    - score_out_of_10 (number or null; ONLY when overall_out_of is 10)
    - final_score_out_of_10 (number or null; ONLY when overall_out_of is 10; must equal score_out_of_10 minus total deduction points)

    - deductions (array of { reason, points })
    - ai_suspected_cheating (string or null)
    - copying_suspected (string or null)

    - strengths (array of 2–4 specific content-focused bullets)
    - improvements (array of 1–3 specific content-focused bullets)
    - teacher_comment (2–3 sentences; sentence 1 praise specific, sentence 2 one clear improvement, optional sentence 3 brief tip)

    POINTS FIELD RULE:
    - In deductions[], points MUST be a positive number (e.g., 1, 0.5).
    - Total deductions are subtracted to compute final_score_out_of_10 (when overall_out_of is 10).

    FINAL CONSISTENCY RULES (required):
    - If overall_out_of !== 10: set score_out_of_10 = null and final_score_out_of_10 = null.
    - If overall_out_of === 10: set score_out_of_10 and final_score_out_of_10 as numbers and apply the deduction rule.
    - The overall_out_of value must match the total possible points defined in the rubric.
    `.trim();
    }

    function buildSessionSummaryInstructions({ feedbackVoice = "warm" } = {}) {
      return `
    You are helping a busy teacher write short, natural feedback for a class set of graded assignments.

    VOICE (required):
    - Match this tone: ${feedbackVoice}
    - Adjust warmth, directness, and sentence length accordingly.
    - Always remain kind, respectful, and classroom-appropriate.
    - No sarcasm, no shaming, no edgy humor.
    If voice is "student_conference":
    - Write brief jot points for a 1:1 teacher-student conference.
    - No long paragraphs. Use short bullets.
    - Include: Affirm (1–2), Clarify (1–2), Ask (2–4 questions), Coach (2–4 actions), Goal (1).
    - Be specific to this work.

    Given the following graded submissions (each with strengths, improvements, teacher comment, etc.):
    Write ONLY 3–7 short sentences total in ONE single paragraph.

    Structure:
    - First 1–3 sentences: describe the main things most students struggled with or lost marks on. Mention 1–2 clear patterns if they exist.
    - Next 1–3 sentences: describe what was done well overall (effort, understanding, clarity, creativity).

    Rules:
    - Do NOT use bullet points, numbered lists, headings, or section labels.
    - Do NOT mention individual scores, point breakdowns, or specific rubrics.
    - Do NOT suggest lesson plans, next steps, or re-check questions.
    - Write conversationally — like quick notes a teacher would paste into a report, email to parents, or say during class review.
    - Keep it encouraging and professional even when pointing out weaknesses.
    - If no strong patterns exist, write something balanced and brief.
    - Do NOT mention the words “evidence”, “JSON”, or “schema”.
    - Do NOT quote student answers; summarize patterns only.
    - Return exactly ONE paragraph with no extra commentary.

    Respond with the paragraph text only.
      `.trim();
    }
  
  function safeJsonParse(text) {
    if (text == null) return null;

    // If it’s already an object, return it
    if (typeof text === "object") return text;

    if (typeof text !== "string") return null;
    let s = text.trim();
    if (!s) return null;

    const tryParse = (str) => {
      try {
        return JSON.parse(str);
      } catch {
        return null;
      }
    };

    function bestEffortParseJsonObject(s) {
      if (typeof s !== "string") return null;
      const str = s.trim();
      if (!str) return null;

      const tryParse = (x) => {
        try { return JSON.parse(x); } catch { return null; }
      };

      // First attempt
      const direct = tryParse(str);
      if (direct) return direct;

      // If truncated, trim to last complete } and try again
      const lastBrace = str.lastIndexOf("}");
      if (lastBrace > 0) {
        const trimmed = str.slice(0, lastBrace + 1);
        const parsed2 = tryParse(trimmed);
        if (parsed2) return parsed2;
      }

      // As a final rescue: take biggest {...} block
      const start = str.indexOf("{");
      const end = str.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const block = str.slice(start, end + 1);
        const parsed3 = tryParse(block);
        if (parsed3) return parsed3;
      }

      return null;
    }

    function parseEscapedJsonString(raw) {
      if (typeof raw !== "string") return null;

      // raw is like: "{\"a\":1,\"b\":\"x\"}"
      // Step 1: try to parse it as JSON string -> returns inner string
      try {
        const inner = JSON.parse(`"${raw.replaceAll('"', '\\"')}"`);
        // That trick is unreliable across all cases; better do manual unescape:
      } catch {}

      const unescaped = raw
        .replace(/\\\\/g, "\\")
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t");

      return bestEffortParseJsonObject(unescaped);
    }

    const extractObjectBlock = (str) => {
      const start = str.indexOf("{");
      const end = str.lastIndexOf("}");
      if (start >= 0 && end > start) return str.slice(start, end + 1);
      return null;
    };

    // 1) direct
    const direct = tryParse(s);
    if (direct) return direct;

    // 2) if it’s a quoted JSON string (double-encoded), decode once then parse again
    // Example: "\"{ \\\"a\\\": 1 }\""
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      const unquoted = tryParse(s);
      if (typeof unquoted === "string") {
        const parsedAgain = tryParse(unquoted);
        if (parsedAgain) return parsedAgain;
        s = unquoted; // keep going with the inner string
      }
    }

    // 3) extract {...} and try
    const rescued = extractObjectBlock(s);
    if (rescued) {
      const parsed = tryParse(rescued);
      if (parsed) return parsed;
    }

    // 4) unescape common sequences and try (ALWAYS, no gating)
    const candidate = rescued || s;
    const unescaped = candidate
      .replace(/\\\\/g, "\\")
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r");

    // Try normal parse
    const parsed2 = tryParse(unescaped);
    if (parsed2) return parsed2;

    // Try trimming to last complete object brace (handles truncation)
    const lastBrace = unescaped.lastIndexOf("}");
    if (lastBrace > 0) {
      const trimmed = unescaped.slice(0, lastBrace + 1);
      const parsedTrim = tryParse(trimmed);
      if (parsedTrim) return parsedTrim;
    }

    // Try “largest {...} block”
    const rescued2 = extractObjectBlock(unescaped);
    if (rescued2) {
      const parsed3 = tryParse(rescued2);
      if (parsed3) return parsed3;

      const lastBrace2 = rescued2.lastIndexOf("}");
      if (lastBrace2 > 0) {
        const trimmed2 = rescued2.slice(0, lastBrace2 + 1);
        const parsed4 = tryParse(trimmed2);
        if (parsed4) return parsed4;
      }
    }

    return null;
  }

  // ------------------------------
  // Grading Usage (Analytics)
  // ------------------------------
  const GradingUsage = mongoose.models.GradingUsage || mongoose.model(
    "GradingUsage",
    new mongoose.Schema(
      {
        timestamp: { type: Date, default: Date.now },

        sessionId: { type: String, index: true },
        ip: String,

        location: {
          country: String,
          region: String,
          city: String,
        },

        subject: String,
        assessmentType: String,
        gradeLevel: String, // store band like "6-8" (or model inference)

        imageCount: Number,
        rubricOverrideUsed: Boolean,
        responseTimeMs: Number,

        refCode: String,
        userAgent: String,
      },
      { timestamps: false }
    )
  );

  app.post("/grading", async (req, res) => {
    console.log("GRADING BODY keys:", Object.keys(req.body || {}));
    console.log("images?", Array.isArray(req.body?.images) ? req.body.images.length : 0);
    console.log("workInput len:", String(req.body?.workInput || "").length);
    
    try {
      const startTime = Date.now();
      const { images, workInput, rubricOverride, gradeBand } = req.body || {};
      const ip =
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        null;

      const userAgent = req.headers["user-agent"] || null;
      const meta = req.body?.meta || {};
      const sessionId = meta.sessionId || null;
      const refCode = meta.refCode || null;

      const trimmed = String(workInput || "").trim();
      const looksLikeUrl = /^https?:\/\/\S+$/i.test(trimmed); // strict: whole field is a URL

      const assignmentLinks = [];
      let submittedTextEvidence = null;

      const hasImages = Array.isArray(images) && images.length > 0;
      const hasWorkInput = trimmed.length > 0;

      // Paste mode
      if (!hasImages && hasWorkInput) {
        if (looksLikeUrl) {
          assignmentLinks.push({
            kind: "source",
            label: "Submitted link",
            url: trimmed,
          });
        } else {
          // Option A: just a friendly note link (no URL)
          assignmentLinks.push({
            kind: "note",
            label: "No links (submitted as pasted text)",
            url: null,
          });

          // Option B (recommended): include the pasted text as evidence (truncate)
          submittedTextEvidence = trimmed.slice(0, 12000); // keep it reasonable
          // If you do Option B, you can instead show:
          assignmentLinks.push({
            kind: "text",
            label: `Submitted text (${Math.min(trimmed.length, 12000)} chars shown)`,
            url: null,
          });
        }
      }

      if (!hasImages && !hasWorkInput) {
        return res.status(400).json({ error: "No images or student work provided" });
      }

      const band = ["3-5", "6-8", "9-10", "11+"].includes(gradeBand) ? gradeBand : "6-8";
      const submissionId = crypto.randomUUID();

      // 1) The actual JSON Schema object (this is what OpenAI needs)
      const gradeResultSchema = {
        type: "object",
        additionalProperties: false,

        properties: {
          response_format_detected: {
            type: "string",
            enum: ["short-answer", "paragraph", "mixed", "test"],
          },
          inferred_subject: {
            type: "string",
            enum: ["Math", "English", "History", "Geography", "Science", "Bible", "Other"],
          },
          inferred_assessment_type: {
            type: "string",
            enum: ["Essay", "Test", "Quiz", "Homework", "Project", "Poster", "Worksheet", "Other"],
          },
          inferred_grade_level: {
            type: "string",
            enum: ["3-5", "6-8", "9-10", "11+", "Unknown"],
          },

          // --- Primary grading scale (always authoritative) ---
          overall_score: { type: "number", minimum: 0 },
          overall_out_of: { type: "number", minimum: 1 },

          // --- /10 compatibility (backend enforces when overall_out_of === 10) ---
          score_out_of_10: { type: ["number", "null"], minimum: 0, maximum: 10 },
          final_score_out_of_10: { type: ["number", "null"], minimum: 0, maximum: 10 },

          // --- Formatting deductions (max –1 total, enforced upstream) ---
          deductions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                reason: { type: "string", minLength: 1 },
                points: { type: "number" },
              },
              required: ["reason", "points"],
            },
          },

          // --- Test sections or rubric categories (backend enforces test=>array, else=>null) ---
          sections: {
            type: ["array", "null"],
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string", minLength: 1 },
                score: { type: "number", minimum: 0 },
                out_of: { type: "number", minimum: 1 },
                teacher_comment: { type: "string", maxLength: 450 },

                incorrect_items: {
                  type: ["array", "null"],
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      prompt: { type: "string", minLength: 1, maxLength: 140 },
                      student_answer: { type: "string", maxLength: 60 },
                      correct_answer: { type: "string", maxLength: 60 },
                    },
                    required: ["prompt", "student_answer", "correct_answer"],
                  },
                },
              },
              required: ["name", "score", "out_of", "teacher_comment", "incorrect_items"],
            },
          },

          // --- Student name extracted from the photo (never guessed) ---
          student_name: { type: ["string", "null"] },

          // --- Integrity flags (conservative use) ---
          ai_suspected_cheating: { type: ["string", "null"] },
          copying_suspected: { type: ["string", "null"] },

          rubricText: { type: ["string", "null"], maxLength: 2200 },
          rubricDetected: { type: "boolean" },
          rubricConfidence: { type: "number", minimum: 0, maximum: 1 },

          // --- Feedback ---
          strengths: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            items: { type: "string" },
          },
          improvements: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { type: "string" },
          },
          teacher_comment: { type: "string", minLength: 1 },
        },

        required: [
          "response_format_detected",

          "inferred_subject",
          "inferred_assessment_type",
          "inferred_grade_level",

          "overall_score",
          "overall_out_of",
          "score_out_of_10",
          "final_score_out_of_10",
          "deductions",
          "sections",
          "student_name",
          "ai_suspected_cheating",
          "copying_suspected",
          "rubricText",
          "rubricConfidence",
          "rubricDetected",
          "strengths",
          "improvements",
          "teacher_comment",
        ],
      };

      // 2) Optional wrapper if you like keeping it around locally
      const schema = {
        name: "grade_result",
        strict: true,
        schema: gradeResultSchema,
      };

      const feedbackVoice = req.body?.meta?.feedbackVoice || "warm";
      const feedbackVoiceMode = req.body?.meta?.feedbackVoiceMode || "default";

      const preferredNameRaw = String(req.body?.meta?.studentName || "").trim();
      const preferredFirstName = preferredNameRaw ? preferredNameRaw.split(/\s+/)[0] : "";

      const instructions = buildRubricInstructions({
        gradeBand: band,
        rubricOverride,
        feedbackVoice,
        feedbackVoiceMode,
      });

      const instructionsWithInference = `
        ${instructions}

        PERSONALIZATION:
        - If a student name is provided, address the student using FIRST NAME ONLY: ${preferredFirstName || "(none provided)"}.
        - Never use a last name.
        - If no name is provided, do not invent one.

        INFERENCE (required):
        - inferred_subject: one of [Math, English, History, Geography, Science, Bible, Other]
        - inferred_assessment_type: one of [Essay, Test, Quiz, Homework, Project, Poster, Worksheet, Other]
        - inferred_grade_level: one of [3-5, 6-8, 9-10, 11+, Unknown]

        Rules:
        - Do NOT guess wildly. If unsure, use Other / Unknown.
        - inferred_grade_level should usually match the provided grade band (${band}) unless the work clearly indicates otherwise.
        
        RUBRIC DETECTION (very important):

        You must determine whether any image contains a TEACHER GRADING RUBRIC TEMPLATE.

        A rubric template typically includes:
        - A grid or table of criteria with levels (e.g., Level 1–4, Excellent/Good/Satisfactory)
        - Point values or scoring bands
        - Checkboxes or empty scoring boxes
        - Criteria headings such as "Content", "Organization", "Mechanics", "Creativity", etc.
        - Descriptions of performance levels (not student answers)

        A rubric is NOT:
        - A completed student test
        - A worksheet with student answers
        - A checklist filled out by the student
        - A grading summary already written by the teacher

        If a teacher rubric template is clearly present:
        - Extract only the rubric criteria and scoring structure.
        - Do NOT include student writing.
        - Summarize it as concise bullet points (max 12 lines).
        - Preserve point values and levels if visible.
        - Set rubricDetected = true.
        - Set rubricConfidence between 0 and 1 (0.75+ if clearly a rubric).

        If no teacher rubric template is present:
        - rubricText = null
        - rubricDetected = false
        - rubricConfidence = 0

        If no images are provided, set rubricDetected=false, rubricText=null, rubricConfidence=0.
        
        Consistency rules:
        - If rubricDetected = false, rubricText must be null and rubricConfidence must be 0.
        - If rubricDetected = true, rubricText must be a non-empty string and rubricConfidence must be > 0.

      `.trim();

      let imageRefs = [];

      if (hasImages) {
        const s3 = getS3Client();
        if (!s3) {
          return res.status(400).json({
            error: "S3 is not configured (missing S3_BUCKET). Cannot save grading captures.",
          });
        }

        const keys = [];
        for (let i = 0; i < images.length; i++) {
          const parsed = parseDataUrlImage(images[i]);
          if (!parsed) return res.status(400).json({ error: `Image ${i + 1} is not a valid data URL.` });

          const key = `grading/${submissionId}/image-${i + 1}.jpg`;
          keys.push(key);

          await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: parsed.buf,
            ContentType: "image/jpeg",
            CacheControl: "private, max-age=0, no-store",
            Metadata: { submissionid: submissionId, kind: "grading-capture" },
          }));
        }

        await GradingCapture.create({ submissionId, keys, createdAt: new Date() });

        imageRefs = images.map((_, i) => ({
          index: i + 1,
          url: `https://www.curriculate.net/grading/capture/${submissionId}/image-${i + 1}.jpg`,
        }));
      }

      const userContent = [{ type: "input_text", text: instructionsWithInference }];
      if (hasImages) {
        userContent.push(...images.map((img) => ({ type: "input_image", image_url: img })));
      } else {
        if (looksLikeUrl) {
          // ✅ Option B: fetch + extract from link
          const extracted = await extractStudentWorkFromLink(trimmed);
          if (extracted.kind === "text") {
            userContent.push({
              type: "input_text",
              text: `STUDENT WORK (FROM LINK):\n${extracted.text.slice(0, 180000)}`,
            });
          } else if (extracted.kind === "images") {
            userContent.push(...extracted.images.map((d) => ({ type: "input_image", image_url: d })));
          } else {
            return res.status(400).json({ error: extracted.error || "Could not extract student work from link." });
          }
        } else {
          // ✅ treat as pasted student work
          userContent.push({
            type: "input_text",
            text: `STUDENT WORK (PASTED TEXT):\n${trimmed}`,
          });
        }
      }

      const response = await openai.responses.create({
        model: "gpt-5.2",
        input: [{ role: "user", content: userContent }],
        text: { format: { type: "json_schema", name: schema.name, strict: true, schema: schema.schema } },
        max_output_tokens: 2500
      });

      const grade = safeJsonParse(response.output_text);

      if (!grade) {
        const responseTimeMs = Date.now() - startTime;
        (async () => {
          try {
            await GradingUsage.create({
              timestamp: new Date(),
              sessionId,
              ip,
              location: null,
              subject: "Other",
              assessmentType: "Other",
              gradeLevel: band,
              imageCount: Array.isArray(images) ? images.length : 0,
              rubricOverrideUsed: Boolean(rubricOverride),
              responseTimeMs,
              refCode,
              userAgent,
            });
          } catch {}
        })();
        // Still return the raw payload, but DO NOT 502 (frontend shouldn't panic)
        return res.json({
          error: "Grading returned invalid JSON",
          raw: response.output_text || "",
          assignment_images: imageRefs,
          meta: { submissionId, gradeBand: band }
        });
      }

      function totalDeductionPoints(deductions) {
        const arr = Array.isArray(deductions) ? deductions : [];
        return arr.reduce((sum, d) => {
          const p = Number(d?.points);
          return sum + (Number.isFinite(p) ? Math.abs(p) : 0);
        }, 0);
      }

      function clampNum(n, min, max) {
        const x = Number(n);
        if (!Number.isFinite(x)) return null;
        return Math.max(min, Math.min(max, x));
      }

      function enforceDenominatorRules(g) {
        if (!g || typeof g !== "object") return g;

        // Clamp sections first (independent of overall_out_of)
        if (Array.isArray(g.sections)) {
          g.sections = g.sections.map((s) => {
            const o = Number(s?.out_of);
            if (!Number.isFinite(o) || o <= 0) return s;
            return { ...s, score: clampNum(s?.score, 0, o) ?? 0 };
          });
        }

        const outOf = Number(g.overall_out_of);
        
        // If model returned nonsense, fall back to /10 using existing fields
        if (!Number.isFinite(outOf) || outOf <= 0) {
          const base = Number(g.score_out_of_10);
          const ded = totalDeductionPoints(g.deductions);
          const final10 = Number.isFinite(base) ? Math.max(0, Math.min(10, base - ded)) : null;

          g.overall_out_of = 10;
          g.score_out_of_10 = Number.isFinite(base) ? base : (final10 ?? 0);
          g.final_score_out_of_10 = final10 ?? 0;
          g.overall_score = g.final_score_out_of_10;
          if (!g.sections) g.sections = null;
          return g;
        }

        g.overall_score = clampNum(g.overall_score, 0, outOf) ?? 0;

        if (outOf !== 10) {
          g.score_out_of_10 = null;
          g.final_score_out_of_10 = null;
          return g;
        }

        // RULE: If overall_out_of === 10, ensure /10 fields exist and are consistent with deductions
        const base = Number(g.score_out_of_10);
        const ded = totalDeductionPoints(g.deductions);

        // prefer provided base; else fall back to overall_score
        const base10 = Number.isFinite(base) ? base : Number(g.overall_score);
        const cleanBase10 = Number.isFinite(base10) ? Math.max(0, Math.min(10, base10)) : 0;

        const final10 = Math.max(0, Math.min(10, cleanBase10 - ded));

        g.score_out_of_10 = cleanBase10;
        g.final_score_out_of_10 = final10;

        // Keep overall aligned when /10 is the chosen denominator
        g.overall_out_of = 10;
        g.overall_score = final10;

        return g;
      }

      const enforced = enforceDenominatorRules(grade);

      // ---- Fire-and-forget analytics logging (never blocks grading) ----
      const responseTimeMs = Date.now() - startTime;

      const inferredSubject = enforced?.inferred_subject || "Other";
      const inferredAssessmentType = enforced?.inferred_assessment_type || "Other";
      const inferredGradeLevel = enforced?.inferred_grade_level || band || "Unknown";

      (async () => {
        try {
          let location = null;

          // Node 18+ has global fetch. If your runtime is older, skip geo.
          if (typeof fetch === "function" && ip) {
            try {
              const geoRes = await fetch(`https://ipapi.co/${ip}/json/`);
              const geo = await geoRes.json();
              location = {
                country: geo?.country_name || null,
                region: geo?.region || null,
                city: geo?.city || null,
              };
            } catch {
              location = null;
            }
          }

          await GradingUsage.create({
            timestamp: new Date(),

            sessionId,
            ip,
            location,

            subject: inferredSubject,
            assessmentType: inferredAssessmentType,
            gradeLevel: inferredGradeLevel,

            imageCount: Array.isArray(images) ? images.length : 0,
            rubricOverrideUsed: Boolean(rubricOverride),
            responseTimeMs,

            refCode,
            userAgent,
          });
        } catch (e) {
          console.error("GradingUsage log failed:", e?.message || e);
        }
      })();

      // ------------------------------
      // Evidence (link or pasted text)
      // ------------------------------
      const evidenceLinks = [];
      let submittedText = null;

      if (!hasImages && hasWorkInput) {
        if (looksLikeUrl) {
          evidenceLinks.push({ label: "Submitted link", url: trimmed });

          // Optional: also include extracted text as evidence (recommended)
          // If you already extracted it earlier, reuse it.
          // If not, you can re-extract here (but avoid double fetch if possible).
          // submittedText = extractedTextYouAlreadyFetched ?? null;
        } else {
          submittedText = trimmed; // pasted student text
        }
      }

      // Attach to the grade object so frontend can render it
      enforced.assignment_links = evidenceLinks;
      enforced.submitted_text = submittedText;

      // ---- Response stays unchanged ----
      return res.json({
        ...enforced,
        assignment_images: imageRefs,
        assignment_links: assignmentLinks,
        submitted_text: submittedTextEvidence, // can be null
        meta: { submissionId, gradeBand: band }
      });

    } catch (err) {
      console.error("🔥 /grading failed:", err?.message || err);
      return res.status(500).json({
        error: "Grading failed",
        details: err?.message || "unknown error"
      });
    }
  });

  // ====================================================================
  //  Grading Session Summary (concept-level trends across a copied session)
  //  POST /grading/session-summary
  // ====================================================================
  app.post("/grading/session-summary", async (req, res) => {
    try {
      const { gradeBand, evidence, rubricOverride, meta } = req.body || {};

      if (!Array.isArray(evidence) || evidence.length === 0) {
        return res.status(400).json({ error: "Missing evidence array" });
      }

      const band = ["3-5", "6-8", "9-10", "11+"].includes(gradeBand) ? gradeBand : "6-8";

      // ✅ Pull voice from meta (front-end can send it later; defaults are safe)
      const feedbackVoice = String(meta?.feedbackVoice || "warm");
      const feedbackVoiceMode = String(meta?.feedbackVoiceMode || "default");

      const voiceMap = {
        professional: "professional, measured, neutral",
        warm: "warm, encouraging, positive",
        direct: "direct, concise, minimal fluff",
        coach: "supportive, instructional, coaching tone",
        gentle_firm: "gentle but firm, clear expectations, respectful",
        witty_light: "light and friendly, subtle kind humor at most once",
        standards: "objective, criteria-aligned academic tone",
        student_friendly: "simple, student-friendly language",
      };
      const voiceDesc = voiceMap[feedbackVoice] || voiceMap.warm;

      const instructions = `
        ${session_summary_instructions}

        GRADE BAND: ${band}

        VOICE (apply to the paragraph):
        - feedbackVoice: ${voiceDesc}
        - feedbackVoiceMode: ${feedbackVoiceMode}
        - Match tone to the selected voice, but keep it professional and kind.
        - No sarcasm, no insults, no edgy humor.
        - Return exactly ONE paragraph (no line breaks).

        rubricOverride (optional context only):
        ${(rubricOverride || "").trim() || "(none)"}

        evidence (JSON):
        ${JSON.stringify(evidence).slice(0, 180000)}
        `.trim();

      const response = await openai.responses.create({
        model: "gpt-5.2",
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: instructions }],
          },
        ],
        max_output_tokens: 450,
      });

      const paragraph = String(response.output_text || "").trim();

      if (!paragraph) {
        return res.status(502).json({
          error: "Session summary returned empty text",
          raw: response.output_text || "",
        });
      }

      res.status(200).set("Content-Type", "text/plain").send(paragraph);
    } catch (err) {
      console.error("🔥 /grading/session-summary failed:", err?.message || err);
      return res.status(500).json({
        error: "Session summary failed",
        details: err?.message || "unknown error",
      });
    }
  });

// Verify TeacherApp entry code (auth required)
app.post("/api/teacher/verify-entry-code", authRequired, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ ok: false, error: "Missing user id" });

    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ ok: false, error: "Missing code" });

    const profile = await TeacherProfile.findOne({ ownerId });
    if (!profile) return res.status(403).json({ ok: false, error: "No profile" });

    const stored = String(profile.entryCode || "").trim().toUpperCase();
    if (!stored) return res.status(403).json({ ok: false, error: "No access code assigned to this account" });

    if (stored !== code) {
      return res.status(403).json({ ok: false, error: "Incorrect access code" });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("verify-entry-code failed:", err);
    return res.status(500).json({
      ok: false,
      error: "Server error",
      detail: process.env.NODE_ENV !== "production" ? String(err?.message || err) : undefined,
    });
  }
});

app.post("/api/teacher/claim-access-code", authRequired, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ ok: false, error: "Missing user id" });

    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ ok: false, error: "Missing code" });

    const access = await AccessCode.findOne({ code });
    if (!access) return res.status(404).json({ ok: false, error: "Code not found" });
    if (access.disabled) return res.status(403).json({ ok: false, error: "Code disabled" });

    const maxSeats = Math.max(1, Number(access.maxSeats || 1));
    const claimants = Array.isArray(access.claimants) ? access.claimants : [];
    const alreadyClaimedByThisUser = claimants.includes(ownerId);

    if (!alreadyClaimedByThisUser && claimants.length >= maxSeats) {
      return res.status(403).json({ ok: false, error: "Code already fully claimed" });
    }

    // 1) Attach entryCode ONLY if empty (prevents overwriting + prevents dup create issues)
    const profile = await TeacherProfile.findOneAndUpdate(
      { ownerId, $or: [{ entryCode: { $exists: false } }, { entryCode: "" }, { entryCode: null }] },
      {
        $set: {
          ownerId,
          email: String(req.user?.email || "").toLowerCase(),
          entryCode: code,
        },
      },
      { new: true, upsert: true }
    );

    // If profile existed but already had entryCode, the update returns null (because filter didn't match)
    if (!profile) {
      const existing = await TeacherProfile.findOne({ ownerId });
      return res.status(409).json({
        ok: false,
        error: `This account already has an access code (${existing?.entryCode || "set"}).`,
      });
    }

    // 2) Claim seat idempotently
    if (!alreadyClaimedByThisUser) {
      await AccessCode.updateOne({ _id: access._id }, { $addToSet: { claimants: ownerId } });
    }

    return res.json({
      ok: true,
      entryCode: profile.entryCode || "",
      planTier: access.planTier || "FREE",
    });
  } catch (err) {
    console.error("claim-access-code failed:", err);

    // Convert common dup-key into a friendly response
    const msg = String(err?.message || "");
    if (msg.includes("E11000") || msg.toLowerCase().includes("duplicate key")) {
      return res.status(409).json({ ok: false, error: "Profile already exists for this user." });
    }

    return res.status(500).json({
      ok: false,
      error: "Server error",
      // helpful while you're debugging (remove later if you want)
      detail: process.env.NODE_ENV !== "production" ? String(err?.message || err) : undefined,
    });
  }
});

app.get("/api/tasksets", async (req, res) => {
  try {
    const sets = await TaskSet.find().sort({ createdAt: -1 }).lean();
    res.json(sets);
  } catch (err) {
    console.error("GET /api/tasksets error:", err);

// ------------------------------
// Media: Presigned S3 Upload URLs
// ------------------------------
app.post("/api/media/presign", async (req, res) => {
  try {
    const s3 = getS3Client();
    if (!s3) {
      return res.status(400).json({ ok: false, error: "S3 is not configured (missing S3_BUCKET)." });
    }
    const { roomCode, teamId, taskType, contentType, purpose } = req.body || {};
    if (!roomCode || !teamId) {
      return res.status(400).json({ ok: false, error: "roomCode and teamId are required" });
    }
    if (!canTeamAccessRoom(roomCode, teamId)) {
      return res.status(403).json({ ok: false, error: "Invalid roomCode/teamId" });
    }
    const ct = String(contentType || "application/octet-stream");
    const ext = safeExtFromContentType(ct);
    const safeTask = String(taskType || "media").replace(/[^a-z0-9-_]/gi, "").toLowerCase() || "media";
    const safePurpose = String(purpose || "submission").replace(/[^a-z0-9-_]/gi, "").toLowerCase() || "submission";
    const id = crypto.randomUUID();
    const key = `sessions/${roomCode}/${teamId}/${safeTask}/${safePurpose}-${Date.now()}-${id}.${ext}`;

    const putCmd = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: ct,
      Metadata: {
        roomcode: String(roomCode),
        teamid: String(teamId),
        tasktype: String(taskType || ""),
        purpose: String(purpose || ""),
      },
    });

    const uploadUrl = await getSignedUrl(s3, putCmd, { expiresIn: S3_URL_EXPIRY_SECONDS });

    // Optional: signed GET for immediate preview (still private bucket)
    const getCmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    const signedGetUrl = await getSignedUrl(s3, getCmd, { expiresIn: S3_GET_URL_EXPIRY_SECONDS });

    return res.json({ ok: true, bucket: S3_BUCKET, key, uploadUrl, signedGetUrl });
  } catch (err) {
    console.error("/api/media/presign error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/media/signed-get", async (req, res) => {
  try {
    const s3 = getS3Client();
    if (!s3) {
      return res.status(400).json({ ok: false, error: "S3 is not configured (missing S3_BUCKET)." });
    }
    const { roomCode, teamId, key } = req.body || {};
    if (!roomCode || !teamId || !key) {
      return res.status(400).json({ ok: false, error: "roomCode, teamId, and key are required" });
    }
    if (!canTeamAccessRoom(roomCode, teamId)) {
      return res.status(403).json({ ok: false, error: "Invalid roomCode/teamId" });
    }
    // basic containment check: key should be within this room/team folder
    const prefix = `sessions/${roomCode}/${teamId}/`;
    if (!String(key).startsWith(prefix)) {
      return res.status(403).json({ ok: false, error: "Key not allowed" });
    }
    const getCmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    const signedGetUrl = await getSignedUrl(s3, getCmd, { expiresIn: S3_GET_URL_EXPIRY_SECONDS });
    return res.json({ ok: true, signedGetUrl });
  } catch (err) {
    console.error("/api/media/signed-get error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});
    res.status(500).json({ error: "Failed to load task sets" });
  }
});

app.get("/api/tasksets/:id", async (req, res) => {
  try {
    const set = await TaskSet.findById(req.params.id).lean();
    if (!set) return res.status(404).json({ error: "Task set not found" });
    return res.json(set);
  } catch (err) {
    console.error("GET /api/tasksets/:id error:", err);
    return res.status(500).json({ error: "Failed to load task set" });
  }
});

// --------------------------------------------------------------------
// Share link: create an expiring link that another logged-in presenter can run.
// --------------------------------------------------------------------
app.post("/api/tasksets/:id/share", authRequired, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    const tasksetId = String(req.params.id || "").trim();
    if (!ownerId) return res.status(401).json({ ok: false, error: "Not authorized." });
    if (!tasksetId) return res.status(400).json({ ok: false, error: "Missing taskset id." });

    const ts = await TaskSet.findById(tasksetId).lean();
    if (!ts) return res.status(404).json({ ok: false, error: "Task set not found." });

    const tsOwner = String(ts.ownerId || ts.owner || ts.userId || "").trim();
    if (tsOwner && tsOwner !== ownerId) {
      return res.status(403).json({ ok: false, error: "You do not own this task set." });
    }

    // Resolve teacher name/email for nicer UI
    let ownerName = "";
    let ownerEmail = "";
    try {
      const prof = await TeacherProfile.findOne({ ownerId }).lean();
      if (prof?.name) ownerName = String(prof.name).trim();
      if (prof?.email) ownerEmail = String(prof.email).trim();
    } catch {}

    const token = crypto.randomBytes(16).toString("hex");
    const tokenHash = hashShareToken(token);

    // Hard rule: always 7 days
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

    const authorDisplay = computeAuthorDisplay(ownerName);

    await SharedTasksetLink.create({
      tokenHash,
      token, // optional back-compat; remove later
      tasksetId,
      ownerId,
      ownerName,
      ownerEmail,
      authorDisplay,
      expiresAt,
      createdByUserId: String(req.user?.id || req.user?._id || ownerId || ""),
    });

    const shareUrl = `https://set.curriculate.net/shared/${token}`;
    res.json({ ok: true, token, shareUrl, expiresAt, ownerName, ownerEmail, authorDisplay });
  } catch (err) {
    console.error("POST /api/tasksets/:id/share error:", err);
    res.status(500).json({ ok: false, error: "Failed to create share link." });
  }
});

// Validate + resolve a share token (recipient must be logged in)
app.get("/api/shared/:token", authRequired, async (req, res) => {
  try {
    const token = String(req.params.token || "").trim();
    if (!token) return res.status(400).json({ ok: false, error: "Missing token." });

    const rawToken = String(req.params.token || "").trim();
    const tokenHash = hashShareToken(rawToken);
    const link =
      (await SharedTasksetLink.findOne({ tokenHash }).lean()) ||
      (await SharedTasksetLink.findOne({ token: rawToken }).lean()); // back-compat

  if (!link || link.revokedAt) return res.status(404).json({ ok: false, error: "Link not found." });

    const now = Date.now();
    const exp = link.expiresAt ? new Date(link.expiresAt).getTime() : 0;
    if (exp && exp < now) return res.status(410).json({ ok: false, error: "Link expired." });

    res.json({
      ok: true,
      token,
      tasksetId: link.tasksetId,
      ownerId: link.ownerId,
      ownerName: link.ownerName || "",
      ownerEmail: link.ownerEmail || "",
      expiresAt: link.expiresAt || null,
    });
  } catch (err) {
    console.error("GET /api/shared/:token error:", err);
    res.status(500).json({ ok: false, error: "Failed to validate link." });
  }
});

app.post("/api/shared/:token/mark-used", authRequired, async (req, res) => {
  try {
    const token = String(req.params.token || "").trim();
    if (!token) return res.status(400).json({ ok: false, error: "Missing token." });

    const link = await SharedTasksetLink.findOne({ token });
    if (!link || link.revokedAt) return res.status(404).json({ ok: false, error: "Link not found." });

    const now = new Date();
    link.usedCount = Number(link.usedCount || 0) + 1;
    link.lastUsedAt = now;
    if (!link.firstUsedAt) link.firstUsedAt = now;

    // Also mark the invite record for this user (so follow-ups stop)
    const email = String(req.user?.email || req.user?.emailAddress || "").trim().toLowerCase();
    let senderUserId = "";
    let senderEmail = "";
    let senderName = "";
    if (email && Array.isArray(link.invites)) {
      const inv = link.invites.find((x) => String(x.toEmail || "").trim().toLowerCase() === email);
      if (inv && !inv.firstUsedAt) inv.firstUsedAt = now;
      if (inv) {
        senderUserId = String(inv.senderUserId || "").trim();
        senderEmail = String(inv.ccEmail || "").trim();
        senderName = String(inv.senderName || "").trim();
      }
    }

    await link.save();

    // Referral incentive: if this was a share invite that just got used, check whether the sender earned a reward.
    if (senderUserId && senderEmail) {
      await maybeSendReferralReward({ senderUserId, senderEmail, senderName });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[share-mark-used] failed:", err);
    res.status(500).json({ ok: false, error: "Failed to mark used." });
  }
});

// Send a share-invite email (recipient must be logged in to open link, but email can be sent to any address)
app.post("/api/shared/:token/send-invite", authRequired, async (req, res) => {
  try {
    const token = String(req.params.token || "").trim();
    const toEmail = String(req.body?.toEmail || "").trim();
    const message = String(req.body?.message || "").trim();

    if (!token) return res.status(400).json({ ok: false, error: "Missing token." });
    if (!toEmail) return res.status(400).json({ ok: false, error: "Missing toEmail." });

    const link = await SharedTasksetLink.findOne({ token }).lean();
    if (!link || link.revokedAt) return res.status(404).json({ ok: false, error: "Link not found." });

    const now = Date.now();
    const exp = link.expiresAt ? new Date(link.expiresAt).getTime() : 0;
    if (exp && exp < now) return res.status(410).json({ ok: false, error: "Link expired." });

    const taskset = await TaskSet.findById(link.tasksetId).lean().catch(() => null);
    const tasksetName = taskset?.name || taskset?.title || "a Curriculate task set";

    const senderEmail =
      String(req.user?.email || req.user?.emailAddress || "").trim() || link.ownerEmail || "";

    const senderName =
      String(req.user?.name || req.user?.fullName || req.user?.displayName || "").trim() ||
      link.ownerName ||
      "A presenter";

    const teacherAppOrigin = process.env.TEACHER_APP_ORIGIN || "https://set.curriculate.net";
    const shareUrl = `${teacherAppOrigin}/share/${token}`;

    // Load editable template (auto-created on boot)
    const template = (await SystemEmailTemplate.findOne({ key: "share-invite" }).lean()) || {};
    const subjectTemplate =
      template.subject || "Curriculate: {{SENDER_NAME}} shared a task set with you";
    const htmlTemplate = template.html || "";

    const customMessageBlock = message
      ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:10px 12px;margin:12px 0;">
           <div style="font-weight:700;margin-bottom:6px;">Message from ${senderName}</div>
           <div style="white-space:pre-wrap;">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
         </div>`
      : "";

    const vars = {
      SENDER_NAME: senderName,
      TASKSET_NAME: tasksetName,
      SHARE_URL: shareUrl,
      EXPIRES_DATE: link.expiresAt ? new Date(link.expiresAt).toLocaleDateString() : "",
      CUSTOM_MESSAGE_BLOCK: customMessageBlock,
    };

    const subject = renderEmailTemplate(subjectTemplate, vars);
    const html = renderEmailTemplate(htmlTemplate, vars);

    await sendSystemEmail({
      to: toEmail,
      cc: senderEmail || undefined, // copy the sender
      subject,
      html,
    });

    // Log invite (for metrics + follow-ups)
    await SharedTasksetLink.updateOne(
      { token },
      {
        $push: {
          invites: {
            toEmail,
            ccEmail: senderEmail || "",
            senderUserId: getOwnerId(req),
            senderName,
            sentAt: new Date(),
          },
        },
      }
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("[share-invite] failed:", err);
    res.status(500).json({ ok: false, error: "Failed to send invite." });
  }
});




app.put("/api/tasksets/:id", async (req, res) => {
  try {
    const updated = await TaskSet.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    }).lean();
    if (!updated) {
      return res.status(404).json({ error: "Task set not found" });
    }
    res.json(updated);
  } catch (err) {
    console.error("PUT /api/tasksets/:id error:", err);
    res.status(500).json({ error: "Failed to update task set" });
  }
});

app.delete("/api/tasksets/:id", async (req, res) => {
  try {
    await TaskSet.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/tasksets/:id error:", err);
    res.status(500).json({ error: "Failed to delete task set" });
  }
});

// END SESSION — FINAL ANALYTICS SAVE
app.post("/api/sessions/:roomCode/end", authRequired, async (req, res) => {
  try {
    const { roomCode } = req.params;
    const code = roomCode.toUpperCase();
    const room = rooms[code];

    if (room?.lightningInterval) {
      clearInterval(room.lightningInterval);
      room.lightningInterval = null;
      console.log("Cleared lightning interval for room", code);
    }

    const session = await Session.findOne({ roomCode: code });
    if (!session)
      return res.status(404).json({ error: "Session not found" });

    const leaderboard = session.teams.map((team) => ({
      teamName: team.name,
      score: team.score || 0,
      tasksCompleted: team.tasksCompleted || 0,
      avgResponseTime:
        team.tasksCompleted && team.totalResponseTime
          ? team.totalResponseTime / team.tasksCompleted
          : 0,
      perfectTasks: team.perfectTasks || 0,
    }));

    session.endedAt = new Date();
    session.leaderboard = leaderboard;
    session.totalTasks = session.tasks.length;
    session.completedTasks = session.teams.reduce(
      (sum, t) => sum + (t.tasksCompleted || 0),
      0
    );

    await session.save();

    io.to(code).emit("session-ended", { leaderboard });
    res.json({ success: true, leaderboard });
  } catch (err) {
    console.error("End session error:", err);
    res.status(500).json({ error: "Failed to end session" });
  }
});

// ====================================================================
//  REPORTS API (immutable snapshots)
//  TeacherApp "Reports" sidebar should hit these endpoints.
// ====================================================================

// List reports for current teacher (most recent first)
app.get("/api/reports", authRequired, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const rows = await SessionReport.find({ ownerId })
      .sort({ createdAt: -1 })
      .select("_id roomCode className gradeLevel headline createdAt planTierUsed taskSetName runByPresenterName sharedFromTeacherName sharedFromTeacherEmail")
      .lean();

    return res.json({ ok: true, reports: rows || [] });
  } catch (err) {
    console.error("GET /api/reports failed:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Get one report (full JSON snapshot)
app.get("/api/reports/:id", authRequired, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const id = String(req.params.id || "").trim();
    const doc = await SessionReport.findOne({ _id: id, ownerId }).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "Report not found" });

    return res.json({ ok: true, report: doc });
  } catch (err) {
    console.error("GET /api/reports/:id failed:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Analytics API (protected)
app.get("/analytics/sessions", authRequired, listSessions);
app.get("/analytics/sessions/:id", authRequired, getSessionDetails);

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Curriculate backend running on port", PORT);
})

// ------------------------------
// Grading Captures (30-day TTL)
// ------------------------------
const GradingCapture = mongoose.models.GradingCapture || mongoose.model(
  "GradingCapture",
  new mongoose.Schema(
    {
      submissionId: { type: String, unique: true, index: true, required: true },
      keys: { type: [String], default: [] }, // S3 object keys
      createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 }, // 30 days TTL
    },
    { timestamps: false }
  )
);

// --------------------------------------------------------------------
// Admin: Access Codes (create + list)
// --------------------------------------------------------------------
function genAccessCode(len = 8) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/O/1/0 confusion
  let out = "";
  for (let i = 0; i < len; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

app.get("/api/admin/access-codes", ...adminRequired, async (req, res) => {
  try {
    const rows = await AccessCode.find({})
      .sort({ createdAt: -1 })
      .lean();

    const codes = (rows || []).map((c) => ({
      _id: String(c._id),
      code: String(c.code || ""),
      planTier: String(c.planTier || "FREE"),
      maxSeats: Number(c.maxSeats || 1),
      disabled: !!c.disabled,
      expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString().slice(0, 10) : null,
      claimantsCount: Array.isArray(c.claimants) ? c.claimants.length : 0,
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
    }));

    return res.json({ ok: true, codes });
  } catch (err) {
    console.error("[admin-access-codes] list failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load access codes." });
  }
});

app.post("/api/admin/access-codes", ...adminRequired, async (req, res) => {
  try {
    const planTier = String(req.body?.planTier || "FREE").toUpperCase().trim();
    const maxSeats = Math.max(1, Number(req.body?.maxSeats ?? req.body?.seats ?? 1));

    const expiresRaw = req.body?.expiresAt ?? req.body?.expires ?? null;
    let expiresAt = null;
    if (expiresRaw) {
      const d = new Date(expiresRaw);
      if (!Number.isNaN(d.getTime())) expiresAt = d;
    }

    // generate unique code
    let code = genAccessCode(8);
    for (let i = 0; i < 5; i += 1) {
      const exists = await AccessCode.findOne({ code }).lean();
      if (!exists) break;
      code = genAccessCode(8);
    }

    const doc = await AccessCode.create({
      code,
      planTier,
      maxSeats,
      expiresAt,
      disabled: false,
      claimants: [],
    });

    return res.json({
      ok: true,
      accessCode: {
        _id: String(doc._id),
        code: doc.code,
        planTier: doc.planTier,
        maxSeats: doc.maxSeats,
        expiresAt: doc.expiresAt ? new Date(doc.expiresAt).toISOString().slice(0, 10) : null,
      },
    });
  } catch (err) {
    console.error("[admin-access-codes] create failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to create access code." });
  }
});

// --------------------------------------------------------------------
// Admin: Email templates + metrics (share links)
// --------------------------------------------------------------------
app.get("/api/admin/email-templates", ...adminRequired, async (req, res) => {
  try {
    const all = await SystemEmailTemplate.find({}).sort({ key: 1 }).lean();
    res.json({ ok: true, templates: all });
  } catch (err) {
    console.error("[admin-email-templates] get failed:", err);
    res.status(500).json({ ok: false, error: "Failed to load templates." });
  }
});

app.put("/api/admin/email-templates/:key", ...adminRequired, async (req, res) => {
  try {
    const key = String(req.params.key || "").trim();
    if (!key) return res.status(400).json({ ok: false, error: "Missing key." });

    const patch = {
      subject: String(req.body?.subject || ""),
      html: String(req.body?.html || ""),
      enabled: req.body?.enabled !== false,
    };

    if (req.body?.followupDays != null) {
      patch.followupDays = Number(req.body.followupDays);
    }

    const updated = await SystemEmailTemplate.findOneAndUpdate(
      { key },
      { $set: patch },
      { new: true, upsert: true }
    ).lean();

    res.json({ ok: true, template: updated });
  } catch (err) {
    console.error("[admin-email-templates] save failed:", err);
    res.status(500).json({ ok: false, error: "Failed to save template." });
  }
});

// --------------------------------------------------------------------
// Admin: Referral program settings (share incentives)
// --------------------------------------------------------------------
app.get("/api/admin/referral-settings", ...adminRequired, async (req, res) => {
  try {
    const s = await ReferralProgramSettings.findOne({ key: "default" }).lean();
    res.json({ ok: true, settings: s || { key: "default", enabled: true, threshold: 5, rewardMonths: 1 } });
  } catch (err) {
    console.error("[admin-referral-settings] get failed:", err);
    res.status(500).json({ ok: false, error: "Failed to load referral settings." });
  }
});

app.put("/api/admin/referral-settings", ...adminRequired, async (req, res) => {
  try {
    const enabled = req.body?.enabled !== false;
    const threshold = Math.max(1, Number(req.body?.threshold || 5));
    const rewardMonths = Math.max(0, Number(req.body?.rewardMonths || 1));

    const updated = await ReferralProgramSettings.findOneAndUpdate(
      { key: "default" },
      { $set: { enabled, threshold, rewardMonths } },
      { new: true, upsert: true }
    ).lean();

    res.json({ ok: true, settings: updated });
  } catch (err) {
    console.error("[admin-referral-settings] save failed:", err);
    res.status(500).json({ ok: false, error: "Failed to save referral settings." });
  }
});

app.get("/api/admin/email-metrics", ...adminRequired, async (req, res) => {
  try {
    const shareLinks = await SharedTasksetLink.countDocuments({});
    const invitesAgg = await SharedTasksetLink.aggregate([
      { $unwind: { path: "$invites", preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: null,
          invites: { $sum: 1 },
          followup7: { $sum: { $cond: [{ $ifNull: ["$invites.followup7SentAt", false] }, 1, 0] } },
          followup30: { $sum: { $cond: [{ $ifNull: ["$invites.followup30SentAt", false] }, 1, 0] } },
          used: { $sum: { $cond: [{ $ifNull: ["$invites.firstUsedAt", false] }, 1, 0] } },
          rewardEmails: { $sum: { $cond: [{ $ifNull: ["$invites.rewardSentAt", false] }, 1, 0] } },
        },
      },
    ]);

    const row = invitesAgg?.[0] || {};
    res.json({
      ok: true,
      counts: {
        shareLinks,
        invites: row.invites || 0,
        followup7: row.followup7 || 0,
        followup30: row.followup30 || 0,
        invitesUsed: row.used || 0,
        rewardEmails: row.rewardEmails || 0,
      },
    });
  } catch (err) {
    console.error("[admin-email-metrics] failed:", err);
    res.status(500).json({ ok: false, error: "Failed to load metrics." });
  }
});