// ====================================================================
//  Curriculate Backend – Rooms, Teams, Stations, Tasks, AI, Emailing
// ====================================================================

// 1) Bootstrap (loads env vars first)
import "dotenv/config";

// 2) Core server deps
import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
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
import { sendStudentReportEmail } from "./email/studentReportEmailer.js";
import { sendSystemEmail } from "./email/shareInviteEmailer.js";
import OpenAI, { toFile } from "openai";

// 8) Controllers
import { getMeController } from "./controllers/meController.js"; // you'll create this
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
import SharedTasksetLink, { hashShareToken } from "./models/SharedTasksetLink.js";
import SessionReport from "./models/SessionReport.js";
import { aggregateTimingStats } from "./services/taskTypeTimingAggregator.js";
import resultsRoutes from "./routes/resultsRoutes.js";
import adminFeedbackRouter from "./routes/adminFeedback.js";
import feedbackRouter from "./routes/feedback.js";
import { listFeedback } from "./controllers/adminFeedbackController.js";
import { requireAdminJson } from "./middleware/requireAdminJson.js";
import adminRouter from "./routes/admin.js";
import analyticsRouter from "./routes/analytics.js";
import billingHandoffRouter from "./routes/billingHandoff.js";
// reportsRouter intentionally deferred — listReports/getReport missing from controller
import sessionsRouter from "./routes/sessions.js";
import speechRouter from "./routes/speech.js";
import teacherProfileRouter from "./routes/teacherProfileRoutes.js";
import voiceRouter from "./routes/voice.js";

// 11) Extracted modules for room engine, game handlers, and routes
import { createRoomEngine } from "./socket/roomEngine.js";
import { registerGameHandlers } from "./socket/gameHandlers.js";
import profileInlineRouter from "./routes/profileInline.js";
import adminCrudRouter from "./routes/adminCrud.js";

function renderEmailTemplate(str, vars) {
  let out = String(str || "");
  for (const [k, v] of Object.entries(vars || {})) {
    out = out.replaceAll(`{{${k}}}`, String(v ?? ""));
  }
  return out;
}

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
      gradeLevel: String,
      imageCount: Number,
      overrideInputUsed: Boolean,
      responseTimeMs: Number,
      refCode: String,
      userAgent: String,
    },
    { timestamps: false }
  )
);

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
  <p style="margin:0 0 10px 0;">If you still need it, the shared task set link is below (if it hasn't expired).</p>
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
    <div style="margin-top:6px;">You've hit the referral goal of <b>{{THRESHOLD}}</b> successful shares. We've queued <b>{{REWARD_MONTHS}}</b> free month(s) on your account.</div>
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

// ====================================================================
//  Global process-level error guards (must be before anything else)
// ====================================================================
process.on("uncaughtException", (err) => {
  console.error("[FATAL] uncaughtException — process will continue:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] unhandledRejection — promise rejected without catch:", reason);
});

// ====================================================================
//  Rate limiters
// ====================================================================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 auth attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests — please try again later." },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,             // 10 AI-generation requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "AI rate limit exceeded — please slow down." },
});

const app = express();

const server = http.createServer(app);

// 1) Security headers (before CORS so helmet headers are always sent)
app.use(
  helmet({
    // Allow the teacher/student apps to load in iframes from same origin
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// 2) CORS + parsers first
app.use(cors(corsOptions));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// 3) Health check (before auth — must be publicly reachable by load balancers)
app.get("/health", async (_req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.status(200).json({ ok: true, mongo: "connected", uptime: process.uptime() });
  } catch {
    res.status(503).json({ ok: false, mongo: "disconnected" });
  }
});

// 2) Auth + misc routes that don't depend on tasksets
app.use("/api/auth", authLimiter, authRoutes);

stripeRoutes.use(cors(corsOptions));
stripeRoutes.options("*", cors(corsOptions));
app.use("/api/stripe", stripeRoutes);

app.use("/api/subscription", subscriptionRoutes);

// 3) Demo stream routes
app.use("/api/demo", demoTasksetStreamRoutes);

// 4) Taskset routes (your new canonical ones)
// If your routers already do their own auth, mount directly:
app.use("/api/ai/tasksets", aiLimiter, aiTasksetsRouter);
app.use("/api/tasksets", tasksetsRouter);

// 5) Shared taskset links (public, no auth)
app.use("/api/shared", sharedRoutes);

// 6) Previously-unregistered route files
app.use("/api/sessions", sessionsRouter);
// NOTE: reportsRouter (routes/reports.js) is intentionally NOT mounted here.
// Its listReports/getReport exports are missing from sessionReportController.js.
// The working inline implementations for GET /api/reports and GET /api/reports/:id
// remain below until that controller is completed.
app.use("/api", analyticsRouter);
app.use("/api", billingHandoffRouter);
app.use("/api/speech", speechRouter);
app.use("/api/voice", voiceRouter);
app.use("/api/teacher-profile", teacherProfileRouter);
app.use("/api/admin", adminRouter);

// 7) Admin + feedback + results
import adminUsageSummaryRouter from "./routes/adminUsageSummary.js";
app.use("/admin", adminUsageSummaryRouter);
app.use("/admin", adminFeedbackRouter);

// Results sharing routes
app.use("/results", resultsRoutes);

app.use("/feedback", feedbackRouter);

app.get("/api/version", (req, res) => {
  res.json({ ok: true, version: "ACCESS-CODE-BUILD-2025-12-31b" });
});

app.get("/feedback", requireAdminJson, listFeedback);

// Simple UUID generator
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const raceWinner = {};
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

// ────────────────────────────────────────────────────────────
// Record-audio: transcribe via Whisper + generate AI feedback
// ────────────────────────────────────────────────────────────
async function transcribeAndFeedbackRecordAudio(s3Key, task) {
  const s3 = getS3Client();
  if (!s3 || !S3_BUCKET || !s3Key) return null;

  try {
    // 1) Download audio from S3
    const getCmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key });
    const s3Resp = await s3.send(getCmd);
    const chunks = [];
    for await (const chunk of s3Resp.Body) chunks.push(chunk);
    const audioBuffer = Buffer.concat(chunks);

    if (audioBuffer.length < 500) {
      console.warn("[transcribeRecordAudio] audio too small, skipping");
      return null;
    }

    // 2) Transcribe with Whisper
    const ext = s3Key.endsWith(".mp3") ? "mp3" : s3Key.endsWith(".wav") ? "wav" : "webm";
    const mimeType = ext === "mp3" ? "audio/mpeg" : ext === "wav" ? "audio/wav" : "audio/webm";
    // Use OpenAI SDK's toFile() — works across all Node versions (File global only in Node 20+)
    const audioFile = await toFile(audioBuffer, `recording.${ext}`, { type: mimeType });

    const oai = getOpenAIInstance();
    const whisperResp = await oai.audio.transcriptions.create({
      model: "whisper-1",
      file: audioFile,
      response_format: "text",
    });

    const transcript = (typeof whisperResp === "string" ? whisperResp : whisperResp?.text || "").trim();
    if (!transcript) {
      return { transcript: "", feedback: "We couldn't detect any speech in your recording. Try speaking louder and closer to the mic." };
    }

    // 3) Generate AI feedback on the transcript
    const taskPrompt = task?.prompt || task?.title || task?.question || "";
    const rubric = task?.rubric || task?.criteria || task?.config?.rubric || "";
    const model = process.env.AI_MODEL || "gpt-4.1-mini";

    const systemMsg = `You are a supportive classroom teacher giving brief feedback on a student's spoken response.
Be encouraging but honest. Keep feedback to 2-3 sentences max.
${rubric ? `\nAssessment criteria: ${rubric}` : ""}`;

    const userMsg = `Task prompt: "${taskPrompt}"

Student's spoken response (transcribed):
"${transcript}"

Give brief, constructive feedback. Start with what was good, then suggest one improvement if needed.`;

    const chatResp = await oai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: userMsg },
      ],
      max_tokens: 200,
      temperature: 0.7,
    });

    const feedback = chatResp.choices?.[0]?.message?.content?.trim() || "";

    return { transcript, feedback };
  } catch (err) {
    console.error("[transcribeRecordAudio] error:", err?.message || err);
    return null; // graceful fallback — student still gets generic feedback
  }
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
//  SOCKET.IO setup (routes already registered above)
// ====================================================================
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

// Log socket.io transport-level errors without crashing the process
io.engine.on("connection_error", (err) => {
  console.warn("[Socket.IO] connection_error:", err.req?.url, err.code, err.message);
});

// --------------------------------------------------------------------
// MongoDB Connection
// --------------------------------------------------------------------
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("❌ MONGO_URI is not defined in environment!");
  process.exit(1);
}

mongoose.connection.on("disconnected", () => {
  console.warn("[MongoDB] Disconnected — Mongoose will auto-reconnect.");
});
mongoose.connection.on("reconnected", () => {
  console.log("[MongoDB] Reconnected.");
});
mongoose.connection.on("error", (err) => {
  console.error("[MongoDB] Connection error:", err);
});

mongoose
  .connect(MONGO_URI, {
    serverSelectionTimeoutMS: 10_000, // fail fast if no replica found in 10 s
    socketTimeoutMS: 45_000,          // drop idle sockets after 45 s
    heartbeatFrequencyMS: 10_000,     // check replica health every 10 s
    maxPoolSize: 20,                   // max concurrent DB connections
  })
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
  .catch((err) => {
    console.error("Mongo initial connection error:", err);
    // Don't exit — Mongoose will keep retrying; health check will report 503
  });

// ====================================================================
//  ROOM ENGINE (imported from socket/roomEngine.js)
// ====================================================================
const engine = createRoomEngine(io);
const {
  rooms,
  normalizeTeacherInstanceId,
  pruneTeacherRoomsByInstance,
  shuffle,
  createRoom,
  reassignStations,
  reassignStationForTeam,
  buildTranscript,
  computePerParticipantStats,
  buildRoomState,
  sendTaskToTeam,
  scheduleNextTask,
  cancelScheduledNextTask,
  advanceTaskNow,
  ensureTreatsConfig,
  isMultiRoomRoom,
  normalizeSlug,
  displayRoomLabel,
  formatGoTo,
  maybeAwardTreat,
  ensureNoiseControl,
  updateNoiseDerivedState,
  arraysDeepEqual,
  scoreMatchingTask,
  scoreVennSortTask,
  getRoomTaskProgress,
  _fcNormalizeAnswer,
  _fcCardMatchesAnswer,
  _fcGetDeckFromTask,
  _fcGetSecondsPerCardFromTask,
  _fcGetPointsFromTask,
  _fcRecordWinSubmission,
  _fcRecordSummarySubmission,
  _fcFinalizeRace,
  _fcClearTimer,
  _fcBroadcastState,
  _fcAdvanceCard,
  _fcEnsureRaceState,
  OFFLINE_TIMEOUT_MS,
  NEXT_TASK_DELAY_MS,
  POST_SUBMIT_SECONDS,
  keepAliveInterval,
} = engine;



// ====================================================================
//  SOCKET.IO – EVENT HANDLERS
// ====================================================================
// ── Socket payload validation helpers ──────────────────────────────────────
const MAX_STRING_BYTES = 64 * 1024;        // 64 KB max for any single string field
const MAX_PAYLOAD_BYTES = 256 * 1024;      // 256 KB max total serialized payload

/**
 * Recursively walk a socket payload and reject if any string exceeds the limit
 * or the total serialized size exceeds the payload cap.
 */
function validateSocketPayload(payload, socketId) {
  try {
    const serialized = JSON.stringify(payload);
    if (serialized.length > MAX_PAYLOAD_BYTES) {
      console.warn(`[SOCKET] Oversized payload rejected (${serialized.length} bytes) from ${socketId}`);
      return false;
    }
  } catch {
    return false; // non-serializable
  }

  function walkStrings(obj, depth = 0) {
    if (depth > 10) return true; // stop at depth 10
    if (typeof obj === "string") {
      if (Buffer.byteLength(obj, "utf8") > MAX_STRING_BYTES) return false;
    } else if (Array.isArray(obj)) {
      for (const v of obj) { if (!walkStrings(v, depth + 1)) return false; }
    } else if (obj && typeof obj === "object") {
      for (const v of Object.values(obj)) { if (!walkStrings(v, depth + 1)) return false; }
    }
    return true;
  }

  if (!walkStrings(payload)) {
    console.warn(`[SOCKET] String field too large in payload from ${socketId}`);
    return false;
  }
  return true;
}

io.on("connection", (socket) => {
  // Wrap socket.on so every event is validated before its handler runs
  const _origOn = socket.on.bind(socket);
  socket.on = (event, handler) => {
    if (typeof handler !== "function") return _origOn(event, handler);
    _origOn(event, (payload, ack) => {
      // Skip internal socket.io events
      if (event === "disconnect" || event === "error" || event === "connect") {
        return handler(payload, ack);
      }
      if (payload !== undefined && !validateSocketPayload(payload, socket.id)) {
        if (typeof ack === "function") ack({ ok: false, error: "Payload too large." });
        return; // drop silently
      }
      handler(payload, ack);
    });
  };

  console.log(
    "[SOCKET] New connection",
    socket.id,
    "origin:",
    socket.handshake.headers.origin,
    "referer:",
    socket.handshake.headers.referer
  );

  socket.on("task:testRequestByIndex", (payload = {}, ack) => {
    try {
      const roomCode = String(payload.roomCode || socket.data?.roomCode || "").trim().toUpperCase();
      const teamId = String(payload.teamId || socket.data?.teamId || "").trim();
      const rawTaskIndex = Number(payload.taskIndex);
      const bypassScan = payload.bypassScan !== false;
      const localOnly = payload.localOnly !== false;

      const room = rooms[roomCode];
      if (!room) {
        ack && ack({ ok: false, error: "Room not found." });
        return;
      }

      if (!teamId || !room.teams?.[teamId]) {
        ack && ack({ ok: false, error: "Team not found." });
        return;
      }

      if (!room.taskset || !Array.isArray(room.taskset.tasks) || room.taskset.tasks.length === 0) {
        ack && ack({ ok: false, error: "No taskset loaded for this room." });
        return;
      }

      if (!Number.isInteger(rawTaskIndex) || rawTaskIndex < 0 || rawTaskIndex >= room.taskset.tasks.length) {
        ack && ack({
          ok: false,
          error: `Task index must be between 0 and ${room.taskset.tasks.length - 1}.`,
        });
        return;
      }

      const team = room.teams[teamId];
      const task = room.taskset.tasks[rawTaskIndex];

      team.testMode = true;
      team.testTaskIndex = rawTaskIndex;
      team.testBypassScan = !!bypassScan;
      team.testLocalOnly = !!localOnly;

      team.taskIndex = rawTaskIndex;
      delete team.nextTaskIndex;

      if (bypassScan) {
        team.lastScannedStationId =
          team.currentStationId || team.stationId || team.station || null;
      }

      const timeLimitSeconds =
        typeof task.timeLimitSeconds === "number"
          ? task.timeLimitSeconds
          : typeof task.time_limit === "number"
          ? task.time_limit
          : null;

      const out = {
        taskIndex: rawTaskIndex,
        index: rawTaskIndex,
        task,
        timeLimitSeconds,
        totalTasks: room.taskset.tasks.length,
        testMode: true,
        localOnly: !!localOnly,
        bypassScan: !!bypassScan,
      };

      io.to(teamId).emit("task:launch", out);
      io.to(teamId).emit("task:assigned", out);

      const state = buildRoomState(room);
      io.to(roomCode).emit("room:state", state);
      io.to(roomCode).emit("roomState", state);

      ack && ack({
        ok: true,
        taskIndex: rawTaskIndex,
        totalTasks: room.taskset.tasks.length,
        testMode: true,
        localOnly: !!localOnly,
        bypassScan: !!bypassScan,
      });
    } catch (err) {
      console.error("task:testRequestByIndex error:", err);
      ack && ack({ ok: false, error: "Server error." });
    }
  });

  socket.on("task:testClear", (payload = {}, ack) => {
    try {
      const roomCode = String(payload.roomCode || socket.data?.roomCode || "").trim().toUpperCase();
      const teamId = String(payload.teamId || socket.data?.teamId || "").trim();

      const room = rooms[roomCode];
      if (!room || !teamId || !room.teams?.[teamId]) {
        ack && ack({ ok: false, error: "Room/team not found." });
        return;
      }

      const team = room.teams[teamId];
      delete team.testMode;
      delete team.testTaskIndex;
      delete team.testBypassScan;
      delete team.testLocalOnly;

      ack && ack({ ok: true });
    } catch (err) {
      console.error("task:testClear error:", err);
      ack && ack({ ok: false, error: "Server error." });
    }
  });

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
        reportEmail:
          typeof payload.reportEmail === "string" && payload.reportEmail.includes("@")
            ? payload.reportEmail.trim().toLowerCase().slice(0, 120)
            : null,
      };

      room.feedback[String(effectiveTeamId)] = safe;

      // Also merge this email into the team's email list for report distribution
      if (safe.reportEmail && room.teams?.[effectiveTeamId]) {
        const prevEmails = Array.isArray(room.teams[effectiveTeamId].emails) ? room.teams[effectiveTeamId].emails : [];
        if (!prevEmails.includes(safe.reportEmail)) {
          room.teams[effectiveTeamId].emails = [...prevEmails, safe.reportEmail].slice(0, 10);
        }
      }

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
    // Skip noisy high-frequency events
    if (event === "teacher:keepalive" || event === "student:keepalive") return;
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
  socket.on("teacher:createRoom", async ({ roomCode, teacherInstanceId, sharedFromTeacherId, sharedFromTeacherEmail }, callback) => {
    const code = roomCode?.toUpperCase()?.trim();
    if (!code) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Missing room code." });
      }
      return;
    }

    const instId = normalizeTeacherInstanceId(teacherInstanceId, socket.id);

    // Ensure this LiveSession instance only owns ONE room at a time
    pruneTeacherRoomsByInstance(instId, code);

    // Reuse existing room or create it once
    let room = rooms[code];
    if (!room) {
      room = await createRoom(code, socket.id);
      rooms[code] = room;
      console.log(`Teacher created room ${code}`);
    }

    // Store shared teacher info if this is a shared run
    if (sharedFromTeacherId) {
      room.reportOwnerId = String(sharedFromTeacherId);
      room.reportOwnerEmail = String(sharedFromTeacherEmail || "");
      console.log(`[shared] Room ${code} is a shared run from teacher ${sharedFromTeacherId}`);
    }

    // Load teacher preferences for session config
    try {
      const userId = socket.data?.userId || socket.data?.user?._id || null;
      if (userId) {
        const tp = await TeacherProfile.findOne({ ownerId: String(userId) }).lean();
        if (tp) {
          room.minimizeOnScreen = !!tp.minimizeOnScreen;
        }
      }
    } catch (e) {
      console.warn("[teacher:createRoom] Could not load teacher profile:", e.message);
    }

    // Cancel any pending grace-period prune from a previous disconnect
    if (room._pendingPruneTimeout) {
      clearTimeout(room._pendingPruneTimeout);
      room._pendingPruneTimeout = null;
      console.log(`[ROOM] Teacher ${instId} reconnected — cancelled pending prune for ${code}`);
    }

    // Stamp ownership / keepalive
    room.teacherSocketId = socket.id;
    room.teacherInstanceId = instId;
    room.lastTeacherSeenAt = Date.now();
    room.expiresAt = Date.now() + 1000 * 60 * 60; // 1 hour

    socket.data.role = "teacher";
    socket.data.roomCode = code;
    socket.data.teacherInstanceId = instId;

    socket.join(code);

    const state = buildRoomState(room);

    // Emit both event names for compatibility
    socket.emit("room:state", state);
    socket.emit("roomState", state);
    io.to(code).emit("room:state", state);
    io.to(code).emit("roomState", state);

    console.log(`Room ${code} is now READY for students`);

    if (typeof callback === "function") {
      callback({ ok: true, roomCode: code, room: state });
    }
  });

  // teacher keepalive event
  socket.on("teacher:keepalive", ({ roomCode, teacherInstanceId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const instId = normalizeTeacherInstanceId(teacherInstanceId, socket.id);

    // ✅ Safety net: if this instance ever had other rooms, kill them now
    pruneTeacherRoomsByInstance(instId, code);

    // Cancel any pending grace-period prune on keepalive (reconnect heartbeat)
    if (room._pendingPruneTimeout) {
      clearTimeout(room._pendingPruneTimeout);
      room._pendingPruneTimeout = null;
    }

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
      const { roomCode, teamName, members, emails, displayName, maxTeamSize } = payload || {};
      const code = (roomCode || "").toUpperCase().trim();

      // Cap emoji/symbol usage in names (allow up to 2)
      const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;
      const capEmojis = (str, max = 2) => {
        let count = 0;
        return str.replace(EMOJI_RE, (m) => { count++; return count <= max ? m : ""; });
      };

      const cleanName = capEmojis((teamName || "").trim());

      const memberList = Array.isArray(members)
        ? members
            .filter((m) => typeof m === "string")
            .map((m) => capEmojis(m.trim()))
            .filter((m) => m.length > 0)
        : [];

      // Collect valid email addresses (optional, for student reports)
      const emailList = Array.isArray(emails)
        ? emails
            .filter((e) => typeof e === "string")
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e.length > 0 && e.includes("@"))
            .slice(0, 5)
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
          emails: emailList,
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
        // Merge emails (deduplicate)
        const prevEmails = Array.isArray(room.teams[teamId].emails) ? room.teams[teamId].emails : [];
        room.teams[teamId].emails = Array.from(new Set([...prevEmails, ...emailList])).slice(0, 10);
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

      // ── Auto-start trigger check ──
      // If taskset is loaded and armed (not yet active), check if we should auto-start.
      if (
        !room.isActive &&
        room.autoStart?.armed &&
        room.taskset &&
        Array.isArray(room.taskset.tasks) &&
        room.taskset.tasks.length > 0
      ) {
        const teamCount = Object.keys(room.teams || {}).length;
        const mode = room.autoStart.mode;

        if (mode === "first_ready" && teamCount >= 1) {
          // First team joined — start immediately
          console.log(`[AutoStart] first_ready triggered for room ${code} (${teamCount} team(s))`);
          room.autoStart.armed = false;
          if (room._autoStartTimer) { clearTimeout(room._autoStartTimer); room._autoStartTimer = null; }
          // Defer start slightly so the join ack reaches the client first
          setTimeout(() => {
            startTasksetForRoom(code);
            io.to(code).emit("autoStart:triggered", { mode: "first_ready" });
          }, 1500);
        } else if (mode === "all_ready") {
          const minTeams = room.autoStart.minTeams || 2;
          if (teamCount >= minTeams) {
            console.log(`[AutoStart] all_ready triggered for room ${code} (${teamCount}/${minTeams} teams)`);
            room.autoStart.armed = false;
            if (room._autoStartTimer) { clearTimeout(room._autoStartTimer); room._autoStartTimer = null; }
            // Give a few seconds for last team to settle
            setTimeout(() => {
              startTasksetForRoom(code);
              io.to(code).emit("autoStart:triggered", { mode: "all_ready" });
            }, 3000);
          }
        }
        // "timer" mode is handled by the setTimeout set during loadTaskset
      }

      // If taskset is active, do NOT auto-push a task on join.
      // Keep scan as the gate. We only prepare the team state so the
      // next accepted station scan can unlock/re-send the correct task.
      if (
        room.isActive === true &&
        room.taskset &&
        Array.isArray(room.taskset.tasks) &&
        room.taskset.tasks.length > 0
      ) {
        const currentOrNextIdx =
          typeof room.teams?.[teamId]?.nextTaskIndex === "number" &&
          room.teams[teamId].nextTaskIndex >= 0
            ? room.teams[teamId].nextTaskIndex
            : typeof room.teams?.[teamId]?.taskIndex === "number" &&
              room.teams[teamId].taskIndex >= 0
            ? room.teams[teamId].taskIndex
            : 0;

        // Do not emit sendTaskToTeam here.
        // Just make sure there is something available for task:requestNext after scan.
        room.teams[teamId].nextTaskIndex = currentOrNextIdx;

        // Late-joiner catch-up flag: if the room has already progressed and this team is starting from 0
        const progress = getRoomTaskProgress(room);
        if (progress.maxJoinedTaskIndex > 0 && currentOrNextIdx === 0) {
          room.teams[teamId].catchingUp = true;
        }
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

  socket.on("room:request-state", ({ roomCode, teamId } = {}, ack) => {
    try {
      const code = String(roomCode || socket.data?.roomCode || "").trim().toUpperCase();
      const effectiveTeamId = String(teamId || socket.data?.teamId || "").trim();

      const room = rooms[code];
      if (!room) {
        if (typeof ack === "function") {
          ack({ ok: false, error: "Room not found." });
        }
        return;
      }

      const state = buildRoomState(room);

      // reply directly to requester
      socket.emit("room:state", state);
      socket.emit("roomState", state);

      // optional ack
      if (typeof ack === "function") {
        ack({
          ok: true,
          roomCode: code,
          teamId: effectiveTeamId || null,
          roomState: state,
        });
      }
    } catch (err) {
      console.error("room:request-state error:", err);
      if (typeof ack === "function") {
        ack({ ok: false, error: "Server error." });
      }
    }
  });

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
      // If a taskset is already running, do NOT auto-push the task on resume.
      // Preserve scan-gated flow: resume -> restore station/team -> scan -> requestNext.
      if (room.taskset && Array.isArray(room.taskset.tasks) && room.taskset.tasks.length > 0) {
        const currentOrNextIdx =
          typeof room.teams?.[teamId]?.nextTaskIndex === "number" &&
          room.teams[teamId].nextTaskIndex >= 0
            ? room.teams[teamId].nextTaskIndex
            : typeof room.teams?.[teamId]?.taskIndex === "number" &&
              room.teams[teamId].taskIndex >= 0
            ? room.teams[teamId].taskIndex
            : 0;

        room.teams[teamId].nextTaskIndex = currentOrNextIdx;
      }

      socket.data.roomCode = code;
      socket.data.teamId = teamId;
      socket.data.teamName = team.teamName;

      const state = buildRoomState(room);

      // Determine if we can auto-push the team's current task on resume
      let currentTask = null;
      if (room.taskset && Array.isArray(room.taskset.tasks) && room.taskset.tasks.length > 0 && room.isActive) {
        const idx =
          typeof team.taskIndex === "number" && team.taskIndex >= 0
            ? team.taskIndex
            : typeof team.nextTaskIndex === "number" && team.nextTaskIndex >= 0
            ? team.nextTaskIndex
            : -1;

        if (idx >= 0 && idx < room.taskset.tasks.length) {
          const task = room.taskset.tasks[idx];
          currentTask = {
            task,
            taskIndex: idx,
            totalTasks: room.taskset.tasks.length,
            timeLimitSeconds: task.timeLimitSeconds || null,
          };
        }
      }

      if (typeof ack === "function") {
        ack({
          success: true,
          teamId,
          teamName: team.teamName,
          members: team.members || [],
          assignedStationId: room?.teams?.[teamId]?.currentStationId || room?.teams?.[teamId]?.stationId || null,
          assignedColor: normalizeStationId(room?.teams?.[teamId]?.currentStationId || room?.teams?.[teamId]?.stationId || null)?.color || null,
          roomState: state,
          currentTask, // null if no active task, otherwise { task, taskIndex, totalTasks }
        });
      }

      // Auto-push the current task so the student picks up where they left off
      // (fires task:assigned which the frontend handles)
      if (currentTask) {
        // Small delay to let the ack arrive and frontend setState before task:assigned
        setTimeout(() => {
          sendTaskToTeam(room, teamId, currentTask.taskIndex);
        }, 500);
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

  function normalizeStationId(input, room = null) {
    const raw = (input || "").toString().trim();
    const lower = raw.toLowerCase();

    // 1) explicit station-<n>
    const m = lower.match(/station-(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      const id = `station-${n}`;
      const color = room?.stations?.[id]?.color || null;
      return { id, number: n, color };
    }

    // 2) color embedded in string / URL
    const colorRegex = new RegExp(
      `(?:^|[\\/\\?#&=])(${COLORS.join("|")})(?:$|[\\/\\?#&=])`,
      "i"
    );
    const cm = lower.match(colorRegex);
    const foundColor = cm?.[1]?.toLowerCase() || (COLORS.includes(lower) ? lower : null);

    if (foundColor) {
      if (room?.stations) {
        const match = Object.values(room.stations).find(
          (s) => String(s?.color || "").toLowerCase() === foundColor
        );
        if (match) {
          const numMatch = String(match.id).match(/station-(\d+)/);
          return {
            id: match.id,
            number: numMatch ? parseInt(numMatch[1], 10) : null,
            color: foundColor,
          };
        }
      }

      return { id: null, number: null, color: foundColor };
    }

    return { id: null, number: null, color: null };
  }

  function buildReviewPayload({ task, answer, correct, aiScore }) {
    const type = task?.taskType;
    const cfg = task?.config && typeof task.config === "object" ? task.config : {};
    // Items can live at task.items OR task.config.items (AI generator uses config.items)
    const reviewItems = Array.isArray(task?.items) && task.items.length > 0
      ? task.items
      : (Array.isArray(cfg.items) ? cfg.items : []);

      // Multi-question objective packs (MC / TF only) — check BEFORE single-question
      if (
        reviewItems.length > 0 &&
        (
          type === "multiple-choice" ||
          type === "true-false" ||
          type === "multi-choice" ||
          type === "multi-true-false"
        )
      ) {
        // Build correct answers from items, supporting both correctAnswer and correctIndex
        const correctAnswers = reviewItems.map((it) => {
          if (it?.correctAnswer !== undefined) return it.correctAnswer;
          if (it?.correctIndex !== undefined) {
            // Resolve correctIndex to option text if possible
            const opts = Array.isArray(it.options) ? it.options : [];
            if (typeof it.correctIndex === "number" && opts[it.correctIndex] != null) {
              return opts[it.correctIndex];
            }
            return it.correctIndex;
          }
          return null;
        });

        // Guard: if none of the items define correctAnswer/correctIndex, fall through
        const hasAnyCorrect = correctAnswers.some((v) => v !== null);
        if (hasAnyCorrect) {
          return { correctAnswers };
        }
      }

      // MC / TF (single-question fallback)
      if (type === "multiple-choice" || type === "true-false") {
        const correctAnswer = task?.correctAnswer ?? cfg?.correctAnswer ?? null;
        return { correctAnswer };
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
          Array.isArray(task?.config?.correctOrder) ? task.config.correctOrder :
          Array.isArray(task?.order) ? task.order :
          null;

        const studentOrder = answer?.order || answer?.sequence || answer || null;
        const correctCount = aiScore?.correctCount ?? null;
        const totalItems = aiScore?.totalItems ?? (correctOrder ? correctOrder.length : null);
        const fraction = aiScore?.fractionCorrect ?? null;

        // Build items lookup for display-friendly names
        const items = Array.isArray(task?.items) ? task.items :
                      Array.isArray(task?.config?.items) ? task.config.items : [];
        const itemById = new Map();
        for (const it of items) {
          if (it?.id) itemById.set(String(it.id), it);
        }

        const feedback = fraction === 1 ? "Perfect order — well done!"
          : fraction != null && fraction >= 0.5 ? `You got ${correctCount} of ${totalItems} in the right position. Close!`
          : fraction != null ? `${correctCount} of ${totalItems} correct. Review the order and try again next time.`
          : null;

        return {
          correctOrder,
          studentOrder,
          correctCount,
          totalItems,
          fractionCorrect: fraction,
          aiFeedback: feedback,
          score: aiScore?.totalScore ?? null,
          maxScore: aiScore?.maxPoints ?? task?.points ?? null,
        };
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
        return {
          correctAnswers: task?.correctAnswers || null,
          studentAnswers: answer?.answers || null,
          winner: answer?.winner || null,
          winnerPlayer: answer?.winnerPlayer || null,
          playerScores: answer?.playerScores || null,
          board: answer?.board || null,
        };
      }

      // TRUE/FALSE CONNECT FOUR
      if (type === "true-false-connect-four") {
        return {
          correctAnswers: task?.correctAnswers || null,
          studentAnswers: answer?.answers || null,
          winner: answer?.winner || null,
          winnerPlayer: answer?.winnerPlayer || null,
          playerScores: answer?.playerScores || null,
          board: answer?.board || null,
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
        // For multi-short packs, feedback lives inside itemResults — aggregate it
        let aggregateFeedback = aiScore?.feedback || aiScore?.rationale || null;
        let aggregateHint = aiScore?.hint || null;
        let aggregateModelAnswer = aiScore?.suggestedAnswer || aiScore?.modelAnswer || null;

        if (!aggregateFeedback && Array.isArray(aiScore?.itemResults) && aiScore.itemResults.length > 0) {
          const wrong = aiScore.itemResults.filter((r) => !r.correct && r.feedback);
          const allRight = aiScore.itemResults.every((r) => r.correct);
          if (allRight) {
            aggregateFeedback = "All parts correct — great work!";
          } else if (wrong.length > 0) {
            aggregateFeedback = wrong.map((r, i) => `${wrong.length > 1 ? `Part ${i + 1}: ` : ""}${r.feedback}`).join(" • ");
          }
        }

        return {
          aiSuggestedAnswer: aggregateModelAnswer,
          aiFeedback: aggregateFeedback,
          aiHint: aggregateHint,
          score: aiScore?.score ?? aiScore?.totalScore ?? null,
          maxScore: aiScore?.maxPoints ?? task?.points ?? null,
          itemResults: Array.isArray(aiScore?.itemResults) ? aiScore.itemResults : undefined,
        };
      }

      // OPEN TEXT (AI)
      if (type === "open-text") {
        return {
          aiSuggestedAnswer: aiScore?.suggestedAnswer || aiScore?.modelAnswer || null,
          aiFeedback: aiScore?.feedback || aiScore?.rationale || null,
          aiHint: aiScore?.hint || null,
          score: aiScore?.score ?? aiScore?.totalScore ?? null,
          maxScore: aiScore?.maxPoints ?? task?.points ?? null,
        };
      }

      // RECORD AUDIO (transcription + AI feedback if available)
      if (type === "record-audio") {
        const transcript = aiScore?.transcript || answer?.transcript || null;
        const aiFeedback = aiScore?.feedback || answer?.feedback || null;
        if (transcript || aiFeedback) {
          return {
            recorded: true,
            transcript: transcript || null,
            aiFeedback: aiFeedback || (transcript ? "Your recording was transcribed successfully." : null),
            score: aiScore?.totalScore ?? null,
            maxScore: aiScore?.maxPoints ?? task?.points ?? null,
          };
        }
        return {
          recorded: true,
          aiFeedback: "Your recording was submitted successfully. Your teacher will listen to it later.",
        };
      }

      // READING COMP (AI paragraph + 1-sentence response)
      if (type === "reading-comp" || type === "reading_comp" || type === "reading-comprehension") {
        return {
          aiFeedback: aiScore?.aiFeedback || aiScore?.reason || aiScore?.feedback || aiScore?.rationale || null,
          score: aiScore?.score ?? aiScore?.totalScore ?? null,
          maxScore: aiScore?.maxPoints ?? task?.points ?? null,
          perResponse: aiScore?.details?.perResponse || null,
        };
      }

      // BRAIN BLITZ
      if (type === "brain-blitz") {
        return {
          clues: task?.clues || task?.config?.clues || null,
          correctAnswer: task?.correctAnswer || task?.config?.correctAnswer || null,
          clientScore: answer?.finalScore ?? null,
          score: aiScore?.totalScore ?? null,
          maxScore: aiScore?.maxPoints ?? task?.points ?? null,
        };
      }

      // FLASHCARDS (participation)
      if (type === "flashcards") {
        const ans = answer && typeof answer === "object" ? (answer.answer || answer) : {};
        return {
          viewed: ans.viewed ?? null,
          totalCards: (task?.cards || task?.config?.cards || []).length || null,
          score: aiScore?.totalScore ?? null,
          maxScore: aiScore?.maxPoints ?? task?.points ?? null,
        };
      }

      // FLASHCARDS RACE
      if (type === "flashcards-race") {
        const ans = answer?.answer || answer || {};
        return {
          winner: ans.winner || null,
          scores: ans.scores || null,
          totalCards: ans.totalCards ?? null,
          score: aiScore?.totalScore ?? null,
          maxScore: aiScore?.maxPoints ?? task?.points ?? null,
        };
      }

      // HANGMAN DUEL
      if (type === "hangman-duel" || type === "hangman") {
        return {
          solved: aiScore?.solved ?? null,
          wrongGuesses: aiScore?.wrongGuesses ?? null,
          score: aiScore?.totalScore ?? null,
          maxScore: aiScore?.maxPoints ?? task?.points ?? null,
        };
      }

      // WORD WEAVER DUEL
      if (type === "word-weaver-duel") {
        const ans = answer?.answer || answer || {};
        return {
          mode: ans.mode || null,
          clientScores: aiScore?.clientScores || ans.scores || null,
          placed: Array.isArray(ans.placed) ? ans.placed.filter(Boolean).length : null,
          score: aiScore?.totalScore ?? null,
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
      const expected = normalizeStationId(expectedStation, room);
      const scanned = normalizeStationId(stationId, room);
      const scannedCanonicalId = scanned?.id || stationId || null;
      if (scannedCanonicalId) {
        team.lastScannedStationId = scannedCanonicalId;
      }

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

      console.log("[station:scan check]", {
        teamId,
        expectedStationRaw: expectedStation,
        expected,
        scannedRaw: stationId,
        scanned,
        currentStationId: team.currentStationId,
        nextTaskIndex: team.nextTaskIndex,
        taskIndex: team.taskIndex,
      });

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

      // If this team has a queued task, deliver it now
      let deliveredTask = false;

      // If this team has a queued task, deliver it now
      if (room.taskset && Array.isArray(room.taskset.tasks)) {
        const queuedIndex =
          typeof team.nextTaskIndex === "number" && team.nextTaskIndex >= 0
            ? team.nextTaskIndex
            : -1;

        if (queuedIndex >= 0) {
          console.log("[station:scan deliver queued task]", {
            teamId,
            queuedIndex,
            currentTaskIndex: team.taskIndex,
          });
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

  // Helper: Check for teams with pacingHold and release if conditions allow
  function checkAndReleasePacingHolds(room, code) {
    if (!room || !room.teams || typeof code !== "string") return;

    const progress = getRoomTaskProgress(room);
    const heldTeams = Object.entries(room.teams).filter(
      ([, team]) => team && team.pacingHold === true
    );

    for (const [teamId, team] of heldTeams) {
      const nextIdx = team.nextTaskIndex;
      if (typeof nextIdx !== "number") continue;

      // Can release if the slowest joined team has now caught up
      if (nextIdx <= progress.minJoinedTaskIndex + 1) {
        delete team.pacingHold;
        io.to(teamId).emit("team:pacing-released", {
          roomCode: code,
          teamId,
        });
      }
    }
  }

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
    console.warn("[handleStudentSubmit missing room/taskset]", {
      roomCode,
      code,
      hasRoom: !!room,
      hasTaskset: !!room?.taskset,
      knownRooms: Object.keys(rooms || {}),
    });
    if (typeof ack === "function") {
      ack({ ok: false, error: "Room or taskset not found" });
    }
    return;
  }

  const effectiveTeamId = teamId || socket.data.teamId;
  const team = room.teams[effectiveTeamId] || {};

  const isTestMode = team.testMode === true;
  const isLocalOnlyTest = isTestMode && team.testLocalOnly === true;

  // Use explicit taskIndex if provided, otherwise this team's current index
  const idx =
    isTestMode && typeof team.testTaskIndex === "number" && team.testTaskIndex >= 0
      ? team.testTaskIndex
      : typeof taskIndex === "number" && taskIndex >= 0
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
  const basePoints = (task.points ?? 100) * 10; // 10× multiplier for dramatic scores & fewer ties

  // ─── Skip task: student chose to skip with a reason ───
  if (answer && typeof answer === "object" && answer.skipped === true) {
    const skipReason = String(answer.skipReason || "No reason given").trim().slice(0, 300);
    const submittedAt = Date.now();

    if (!Array.isArray(room.submissions)) room.submissions = [];
    room.submissions.push({
      roomCode: code,
      teamId: effectiveTeamId,
      teamName,
      playerId: socket.data.playerId || null,
      taskIndex: idx,
      answer: null,
      photoUrl: null,
      correct: false,
      points: 0,
      aiScore: { strategy: "skipped", skipReason },
      skipped: true,
      skipReason,
      timeMs: timeMs ?? null,
      submittedAt,
    });

    // Advance team to next task
    if (room.teams[effectiveTeamId]) {
      room.teams[effectiveTeamId].taskIndex = idx;
      room.teams[effectiveTeamId].nextTaskIndex = idx + 1;
    }

    // Broadcast leaderboard update (0 points for skip)
    io.to(code).emit("score-update", {
      roomCode: code,
      teamId: effectiveTeamId,
      teamName,
      points: 0,
      isCorrect: false,
      taskIndex: idx,
      skipped: true,
      skipReason,
    });

    if (typeof ack === "function") {
      ack({ ok: true, correct: false, points: 0, skipped: true });
    }
    return;
  }

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
      // PMC / physical-multiple-choice: summarize letter answers
      if (
        answer.type === "physical-multiple-choice" &&
        Array.isArray(answer.answers)
      ) {
        const parts = answer.answers.map((a, i) => {
          const lbl = a?.letter || `Q${i + 1}`;
          const mark = a?.isCorrect ? "✓" : "✗";
          return `${lbl} ${mark}`;
        });
        const total = answer.answers.length;
        const right = answer.answers.filter((a) => a?.isCorrect).length;
        return `${parts.join(", ")} (${right}/${total})`;
      }

      // Generic structured answers with an answers[] array
      if (Array.isArray(answer.answers) && answer.answers.length > 0) {
        try {
          return answer.answers
            .map((a, i) => {
              const val =
                a?.value ?? a?.answer ?? a?.letter ?? a?.selected ?? `Q${i + 1}`;
              const mark =
                a?.isCorrect === true ? " ✓" : a?.isCorrect === false ? " ✗" : "";
              return `${String(val).trim()}${mark}`;
            })
            .join("; ");
        } catch {
          /* fall through */
        }
      }

      // Single value answer (e.g. { answer: "Blue", correct: true })
      if (typeof answer.answer === "string" && answer.answer.trim()) {
        return answer.answer.trim();
      }
      if (typeof answer.value === "string" && answer.value.trim()) {
        return answer.value.trim();
      }

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
  const taskItems = Array.isArray(task.items) && task.items.length > 0
    ? task.items
    : (Array.isArray(task.config?.items) ? task.config.items : []);
  if (isMultiPack && taskItems.length > 0) {
    const items = taskItems;
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
        // Support both correctAnswer and correctIndex (AI generator uses correctIndex)
        const itemCorrect = item.correctAnswer ?? item.correctIndex;
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
      // Short-answer items: AI evaluation per item
      else if (answer.type === "multi-short") {
        const itemCorrect =
          typeof item.correctAnswer === "string"
            ? item.correctAnswer.trim()
            : "";

        const acceptableAnswers =
          Array.isArray(item.acceptableAnswers)
            ? item.acceptableAnswers
            : Array.isArray(item?.payload?.acceptableAnswers)
            ? item.payload.acceptableAnswers
            : [];

        const itemMaxPoints =
          typeof item.points === "number" && item.points > 0 ? item.points : 1;

        const itemPrompt =
          item.prompt ||
          item.question ||
          item.label ||
          item.text ||
          `Question ${target.index + 1}`;

        const evalResult = await evaluateMultiShortItem({
          prompt: itemPrompt,
          studentAnswer: givenValue,
          correctAnswer: itemCorrect,
          acceptableAnswers,
          gradeLevel: task.gradeLevel || task?.config?.gradeLevel || "6-8",
          maxPoints: itemMaxPoints,
        });

        isCorrectItem = evalResult.correct === true;

        if (!aiScore || typeof aiScore !== "object") {
          aiScore = {
            strategy: "ai-multi-short",
            maxPoints: basePoints,
            totalScore: 0,
            itemResults: [],
          };
        }

        if (!Array.isArray(aiScore.itemResults)) {
          aiScore.itemResults = [];
        }

        aiScore.itemResults.push({
          itemId: rawId ?? String(target.index),
          prompt: itemPrompt,
          studentAnswer: String(givenValue ?? "").trim(),
          correctAnswer: itemCorrect,
          score: evalResult.score,
          maxPoints: itemMaxPoints,
          correct: evalResult.correct,
          feedback: evalResult.feedback,
        });
      }

      if (isCorrectItem === true) {
        correctCount += 1;
      }
      evaluatedCount += 1;
      }

      const totalItems = items.length;
      const usedItems = evaluatedCount || totalItems;

      if (answer.type === "multi-short" && aiScore?.strategy === "ai-multi-short") {
        const itemResults = Array.isArray(aiScore.itemResults) ? aiScore.itemResults : [];
        const earned = itemResults.reduce((sum, r) => sum + (Number(r.score) || 0), 0);
        const possible =
          itemResults.reduce((sum, r) => sum + (Number(r.maxPoints) || 0), 0) || usedItems;

        const fraction =
          possible > 0 ? Math.max(0, Math.min(1, earned / possible)) : 0;

        pointsEarned = Math.round(basePoints * fraction);
        aiScore.totalScore = pointsEarned;
        aiScore.correctCount = itemResults.filter((r) => r.correct).length;
        aiScore.totalItems = totalItems;
        aiScore.evaluatedItems = usedItems;
        aiScore.fractionCorrect = fraction;

        if (fraction === 1) {
          correct = true;
        } else if (fraction === 0) {
          correct = false;
        } else {
          correct = null;
        }
      } else {
        const fraction =
          usedItems > 0 ? Math.max(0, Math.min(1, correctCount / usedItems)) : 0;

        pointsEarned = Math.round(basePoints * fraction);

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

    // ── READING-COMP: use the pre-checked decision from the frontend ──
    // ReadingCompTask calls /api/tasks/reading-comp/check BEFORE submitting and
    // bundles the result in answer.comprehensionCheck.  We trust that result here
    // so the student's score matches the feedback they already saw on-screen.
    if (!isMultiPack && task.taskType === "reading-comp") {
      const cc = answer?.comprehensionCheck || {};
      const decision = String(cc?.decision || "").toLowerCase();
      const feedback  = String(cc?.feedback  || "").trim();
      const reason    = String(cc?.reason    || "").trim();

      if (decision === "accept") {
        correct       = true;
        pointsEarned  = basePoints;
        aiScore = {
          strategy:   "reading-comp-check",
          decision:   "accept",
          reason,
          totalScore: pointsEarned,
          maxPoints:  basePoints,
          feedback:   feedback || "Great — you showed understanding of the main idea.",
        };
      } else if (decision === "followup_answered") {
        // Student answered the follow-up question — full credit
        correct       = true;
        pointsEarned  = basePoints;
        aiScore = {
          strategy:   "reading-comp-check",
          decision:   "followup_answered",
          reason,
          totalScore: pointsEarned,
          maxPoints:  basePoints,
          feedback:   feedback || "Good — you clarified your understanding.",
        };
      } else if (decision === "followup") {
        // Needed a follow-up — partial credit; student engaged but wasn't fully clear
        correct       = null;   // not wrong, just incomplete
        pointsEarned  = Math.round(basePoints * 0.5);
        aiScore = {
          strategy:   "reading-comp-check",
          decision:   "followup",
          reason,
          totalScore: pointsEarned,
          maxPoints:  basePoints,
          feedback:   feedback || "You had the right idea — try to include the main point more clearly.",
        };
      } else {
        // No comprehensionCheck payload (e.g. submitted without the check) — award participation
        correct       = null;
        pointsEarned  = Math.round(basePoints * 0.5);
        aiScore = {
          strategy:   "reading-comp-check",
          decision:   "unknown",
          totalScore: pointsEarned,
          maxPoints:  basePoints,
          feedback:   "Response submitted.",
        };
      }
    }

    // Non-multi SHORT_ANSWER
if (!isMultiPack && task.taskType === "short-answer" && pointsEarned === 0 && correct === null) {
  const question = String(
    task.prompt ||
    task.question ||
    task.title ||
    task.text ||
    ""
  ).trim();

  const studentAnswer = String(answerText ?? answer ?? "").trim();
  const correctAnswer = String(task.correctAnswer || "").trim();
  const acceptableAnswers = Array.isArray(task.acceptableAnswers)
    ? task.acceptableAnswers.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8)
    : Array.isArray(task?.config?.acceptableAnswers)
    ? task.config.acceptableAnswers.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8)
    : [];

  if (!studentAnswer) {
    correct = false;
    pointsEarned = 0;
    aiScore = {
      strategy: "short-answer-eval",
      maxPoints: basePoints,
      totalScore: 0,
      correct: false,
      feedback: "No answer given.",
      hint: "Include the main idea in your answer.",
    };
  } else if (studentAnswer.split(/\s+/).length < 3) {
    correct = false;
    pointsEarned = 0;
    aiScore = {
      strategy: "short-answer-eval",
      maxPoints: basePoints,
      totalScore: 0,
      correct: false,
      feedback: "Please write a fuller answer.",
      hint: "Use a complete thought and include the key idea.",
    };
  } else {
    try {
      const prompt = `
        You are a teacher evaluating one student short answer.

        Grade level: ${task.gradeLevel || task?.config?.gradeLevel || "6-8"}

        Question:
        ${question}

        Student answer:
        ${studentAnswer}

        Correct answer:
        ${correctAnswer || "(not provided)"}

        Other acceptable answers:
        ${acceptableAnswers.length ? acceptableAnswers.join(" | ") : "(none)"}

        Return JSON ONLY in this exact shape:
        {
          "score": number,
          "maxPoints": number,
          "correct": boolean,
          "feedback": "one sentence saying what the student got right or what is missing",
          "hint": "one sentence that strongly points to the missing key idea without copying the full answer",
          "modelAnswer": "one short model answer"
        }

        Rules:
        - score must be between 0 and ${basePoints}
        - Use full credit if the student clearly shows the right idea, even if the wording differs.
        - Be lenient with paraphrases.
        - Do NOT require exact keywords if the concept is clearly there.
        - A mostly correct answer should usually earn full credit on a short-answer task unless an essential idea is missing.
        - If the answer is partially correct, score generously but not fully.
        - feedback must be specific to THIS question and THIS answer.
        - Never say vague things like "be clearer" or "include more detail" by themselves.
        - Name the missing concept directly in student-friendly language.
        - hint must strongly guide the student toward the missing idea.
        - modelAnswer must be short, direct, and student-friendly.
        `.trim();

              const response = await openai.responses.create({
                model: process.env.AI_MODEL || "gpt-4.1-mini",
                input: [
                  {
                    role: "user",
                    content: [{ type: "input_text", text: prompt }],
                  },
                ],
                text: {
                  format: {
                    type: "json_schema",
                    name: "short_answer_eval",
                    strict: true,
                    schema: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        score: { type: "number" },
                        maxPoints: { type: "number" },
                        correct: { type: "boolean" },
                        feedback: { type: "string" },
                        hint: { type: "string" },
                        modelAnswer: { type: "string" },
                      },
                      required: ["score", "maxPoints", "correct", "feedback", "hint", "modelAnswer"],
                    },
                  },
                },
                max_output_tokens: 220,
              });

              const parsed = safeJsonParse(response.output_text) || {};
              const rawScore = Number(parsed?.score);
              const boundedScore = Number.isFinite(rawScore)
                ? Math.max(0, Math.min(basePoints, rawScore))
                : 0;

              pointsEarned = boundedScore;
              correct = parsed?.correct === true || boundedScore >= basePoints;

              aiScore = {
                strategy: "short-answer-eval",
                maxPoints: basePoints,
                totalScore: pointsEarned,
                correct,
                feedback: String(parsed?.feedback || "").trim() || "Answer needs improvement.",
                hint: String(parsed?.hint || "").trim() || "Include the key idea more directly.",
                modelAnswer: String(parsed?.modelAnswer || "").trim() || "",
              };
            } catch (e) {
              console.error("Short answer eval failed:", e);
              correct = false;
              pointsEarned = 0;
              aiScore = {
                strategy: "short-answer-eval",
                maxPoints: basePoints,
                totalScore: 0,
                correct: false,
                feedback: "Could not evaluate answer.",
                hint: "Try again and include the main idea.",
              };
            }
          }
        }

// ── OPEN TEXT fallback AI scoring (when generateAIScore had no rubric) ──
if (!isMultiPack && task.taskType === "open-text" && pointsEarned === 0 && correct === null && !aiScore) {
  const prompt = String(task.prompt || task.question || task.title || "").trim();
  const studentAnswer = String(answerText ?? answer ?? "").trim();
  const guidingQuestions = Array.isArray(task.guidingQuestions)
    ? task.guidingQuestions.slice(0, 4).join(" | ")
    : "";

  if (!studentAnswer || studentAnswer.split(/\s+/).length < 2) {
    correct = false;
    pointsEarned = 0;
    aiScore = {
      strategy: "open-text-eval",
      maxPoints: basePoints,
      totalScore: 0,
      correct: false,
      feedback: "No response was submitted.",
      hint: "Write at least a few sentences to earn credit.",
    };
  } else {
    try {
      const evalPrompt = `
You are a teacher evaluating a student's written response.

Grade level: ${task.gradeLevel || task?.config?.gradeLevel || "6-8"}

Writing prompt:
${prompt || "(open-ended writing task)"}

${guidingQuestions ? `Guiding questions: ${guidingQuestions}\n` : ""}
Student response:
${studentAnswer}

Return JSON ONLY in this exact shape:
{
  "score": number,
  "maxPoints": number,
  "correct": boolean,
  "feedback": "1-2 sentences about what the student did well and/or what was missing",
  "hint": "one constructive suggestion to improve the response",
  "modelAnswer": "one short example of a strong response (2-3 sentences max)"
}

Rules:
- score must be between 0 and ${basePoints}
- Award full credit for responses that address the prompt with clear ideas and evidence.
- Award partial credit for responses that partially address the prompt.
- feedback must be specific to this response, not generic.
- Encourage the student; even partial credit responses deserve acknowledgment of what they did right.
`.trim();

      const response = await openai.responses.create({
        model: process.env.AI_MODEL || "gpt-4.1-mini",
        input: [{ role: "user", content: [{ type: "input_text", text: evalPrompt }] }],
        text: {
          format: {
            type: "json_schema",
            name: "open_text_eval",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                score: { type: "number" },
                maxPoints: { type: "number" },
                correct: { type: "boolean" },
                feedback: { type: "string" },
                hint: { type: "string" },
                modelAnswer: { type: "string" },
              },
              required: ["score", "maxPoints", "correct", "feedback", "hint", "modelAnswer"],
            },
          },
        },
        max_output_tokens: 280,
      });

      const parsed = safeJsonParse(response.output_text) || {};
      const rawScore = Number(parsed?.score);
      const boundedScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(basePoints, rawScore)) : Math.round(basePoints * 0.5);

      pointsEarned = boundedScore;
      correct = parsed?.correct === true || boundedScore >= basePoints;

      aiScore = {
        strategy: "open-text-eval",
        maxPoints: basePoints,
        totalScore: pointsEarned,
        correct,
        feedback: String(parsed?.feedback || "").trim() || "Thanks for your response.",
        hint: String(parsed?.hint || "").trim() || "Try to include more specific details.",
        modelAnswer: String(parsed?.modelAnswer || "").trim() || "",
      };
    } catch (e) {
      console.error("Open text eval failed:", e);
      // Participation credit on error
      correct = null;
      pointsEarned = Math.round(basePoints * 0.5);
      aiScore = {
        strategy: "open-text-eval",
        maxPoints: basePoints,
        totalScore: pointsEarned,
        correct: null,
        feedback: "Your response was submitted. Good effort!",
        hint: "Include specific details and examples to strengthen your answer.",
      };
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
  pointsEarned = numericScore;

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

    // ✅ PHYSICAL MULTIPLE CHOICE — objective scoring from client answers
    if (
      !isMultiPack &&
      task.taskType === "physical-multiple-choice" &&
      answer &&
      typeof answer === "object" &&
      Array.isArray(answer.answers) &&
      answer.answers.length > 0
    ) {
      const totalQ = answer.answers.length;
      const correctQ = answer.answers.filter((a) => a?.isCorrect === true).length;
      correct = correctQ === totalQ;
      pointsEarned = totalQ > 0 ? Math.round((correctQ / totalQ) * basePoints) : 0;
      aiScore = {
        strategy: "pmc-objective",
        correct,
        correctCount: correctQ,
        totalCount: totalQ,
        maxPoints: basePoints,
        totalScore: pointsEarned,
      };
    }

    // ✅ DRAW-MIME — use client-side team score (participation + bonus)
    if (!isMultiPack && task.taskType === "draw-mime" && answer && typeof answer === "object") {
      const clientScore = Number(answer.teamScore) || 0;
      const played = answer.completed === true || answer.allRoundsDone === true;
      if (played) {
        pointsEarned = clientScore > 0 ? Math.min(clientScore, basePoints) : Math.round(basePoints * 0.5);
        correct = clientScore > 0 ? true : null;
      } else {
        pointsEarned = Math.round(basePoints * 0.25);
        correct = null;
      }
      aiScore = {
        strategy: "draw-mime-client",
        correct,
        teamScore: clientScore,
        maxPoints: basePoints,
        totalScore: pointsEarned,
      };
    }

    // ✅ TRUE-FALSE TIC-TAC-TOE — trust client scoring (per-player + team)
    if (!isMultiPack && task.taskType === "true-false-tictactoe" && answer && typeof answer === "object") {
      const clientTeamPts = Number(answer.teamPointsEarned || answer.pointsEarned) || 0;
      const played = answer.completed === true || answer.gameComplete === true;
      if (played && clientTeamPts > 0) {
        pointsEarned = Math.min(clientTeamPts, basePoints * 3); // cap at 3× base to prevent exploits
        correct = answer.winner && answer.winner !== "draw" ? true : null;
      } else if (played) {
        pointsEarned = Math.round(basePoints * 0.25); // participated but no client score
        correct = null;
      } else {
        pointsEarned = 0;
        correct = null;
      }
      aiScore = {
        strategy: "tictactoe-client",
        correct,
        winner: answer.winner || null,
        playerScores: answer.playerScores || null,
        teamPointsEarned: clientTeamPts,
        speedBonus: Number(answer.speedBonus) || 0,
        maxPoints: basePoints,
        totalScore: pointsEarned,
      };
    }

    // ✅ TRUE-FALSE CONNECT FOUR — trust client scoring (per-player + team)
    if (!isMultiPack && task.taskType === "true-false-connect-four" && answer && typeof answer === "object") {
      const clientTeamPts = Number(answer.teamPointsEarned || answer.pointsEarned) || 0;
      const played = answer.completed === true || answer.gameComplete === true;
      if (played && clientTeamPts > 0) {
        pointsEarned = Math.min(clientTeamPts, basePoints * 3);
        correct = answer.winner && answer.winner !== "draw" ? true : null;
      } else if (played) {
        pointsEarned = Math.round(basePoints * 0.25);
        correct = null;
      } else {
        pointsEarned = 0;
        correct = null;
      }
      aiScore = {
        strategy: "connect-four-client",
        correct,
        winner: answer.winner || null,
        playerScores: answer.playerScores || null,
        teamPointsEarned: clientTeamPts,
        speedBonus: Number(answer.speedBonus) || 0,
        maxPoints: basePoints,
        totalScore: pointsEarned,
      };
    }

    // ✅ BRAIN BLITZ — client sends { finalScore } (count of correct clue guesses)
    if (!isMultiPack && task.taskType === "brain-blitz" && answer && typeof answer === "object") {
      const clientScore = Number(answer.finalScore) || 0;
      const clues = Array.isArray(task.clues) ? task.clues
        : Array.isArray(task.config?.clues) ? task.config.clues : [];
      const totalClues = clues.length || 1;
      const fraction = Math.min(1, clientScore / totalClues);
      pointsEarned = Math.max(Math.round(basePoints * fraction), clientScore > 0 ? 1 : 0);
      correct = fraction >= 0.5;
      aiScore = {
        strategy: "brain-blitz-client",
        correct,
        clientScore,
        totalClues,
        fractionCorrect: fraction,
        maxPoints: basePoints,
        totalScore: pointsEarned,
      };
    }

    // ✅ FLASHCARDS — participation/mastery (scoringMode: "none"); award for completing the review
    if (!isMultiPack && task.taskType === "flashcards" && !aiScore) {
      const ans = answer && typeof answer === "object" ? (answer.answer || answer) : {};
      const viewed = Number(ans.viewed) || 0;
      const completed = answer?.completed === true || ans.mode === "flashcards";
      if (completed || viewed > 0) {
        pointsEarned = basePoints; // full credit for completing flashcard review
        correct = null; // not a right/wrong task
      } else {
        pointsEarned = Math.round(basePoints * 0.25); // opened but didn't finish
        correct = null;
      }
      aiScore = {
        strategy: "flashcards-participation",
        correct,
        viewed,
        completed,
        maxPoints: basePoints,
        totalScore: pointsEarned,
      };
    }

    // ✅ FLASHCARDS RACE — client sends { answer: { winner, scores, totalCards } }
    if (!isMultiPack && task.taskType === "flashcards-race" && answer && typeof answer === "object") {
      const ans = answer.answer || answer;
      const scores = ans.scores && typeof ans.scores === "object" ? ans.scores : {};
      const teamScore = Number(scores[effectiveTeamId]) || 0;
      const totalCards = Number(ans.totalCards) || 1;
      const played = Object.keys(scores).length > 0 || ans.winner != null;
      if (played && teamScore > 0) {
        pointsEarned = Math.min(teamScore, basePoints * 2); // cap at 2× base
        correct = true;
      } else if (played) {
        pointsEarned = Math.round(basePoints * 0.25); // participated but scored 0
        correct = null;
      } else {
        pointsEarned = 0;
        correct = null;
      }
      aiScore = {
        strategy: "flashcards-race-client",
        correct,
        teamScore,
        allScores: scores,
        totalCards,
        winner: ans.winner || null,
        maxPoints: basePoints,
        totalScore: pointsEarned,
      };
    }

    // ✅ HANGMAN DUEL — check server-side game state for whether team solved the word
    if (!isMultiPack && (task.taskType === "hangman-duel" || task.taskType === "hangman") && !aiScore) {
      let solved = false;
      let wrongGuesses = 0;
      try {
        const hd = room?.hangmanDuel?.byTeam?.[effectiveTeamId];
        if (hd) {
          const blanks = Array.isArray(hd.blanks) ? hd.blanks : [];
          const word = String(hd.word || "").toUpperCase();
          solved = word.length > 0 && blanks.join("").toUpperCase() === word;
          wrongGuesses = Array.isArray(hd.wrongGuesses) ? hd.wrongGuesses.length : 0;
        }
      } catch { /* non-blocking */ }

      if (solved) {
        // Fewer wrong guesses → more points (at least 50% for solving)
        const penaltyFraction = Math.min(1, wrongGuesses * 0.1);
        pointsEarned = Math.max(Math.round(basePoints * 0.5), Math.round(basePoints * (1 - penaltyFraction)));
        correct = true;
      } else {
        // Didn't solve but participated
        pointsEarned = Math.round(basePoints * 0.15);
        correct = false;
      }
      aiScore = {
        strategy: "hangman-duel-server-state",
        correct,
        solved,
        wrongGuesses,
        maxPoints: basePoints,
        totalScore: pointsEarned,
      };
    }

    // ✅ WORD WEAVER DUEL — client sends { mode, scores, placed, ... }
    if (!isMultiPack && task.taskType === "word-weaver-duel" && answer && typeof answer === "object") {
      const ans = answer.answer || answer;
      const mode = ans.mode || "unknown";
      if (mode === "scrabble") {
        const clientScores = ans.scores && typeof ans.scores === "object" ? ans.scores : {};
        const totalPts = Object.values(clientScores).reduce((s, v) => s + (Number(v) || 0), 0);
        const placed = Array.isArray(ans.placed) ? ans.placed.filter(Boolean).length : 0;
        if (totalPts > 0 || placed > 0) {
          pointsEarned = Math.min(totalPts > 0 ? totalPts : basePoints, basePoints * 2);
          correct = null; // creative/collaborative — no right/wrong
        } else {
          pointsEarned = Math.round(basePoints * 0.25);
          correct = null;
        }
        aiScore = {
          strategy: "word-weaver-scrabble-client",
          correct,
          clientScores,
          totalClientPoints: totalPts,
          placed,
          maxPoints: basePoints,
          totalScore: pointsEarned,
        };
      } else {
        // phrase mode — the student assembled words into a phrase
        const hasAnswer = typeof ans.answer === "string" && ans.answer.trim().length > 0;
        pointsEarned = hasAnswer ? basePoints : Math.round(basePoints * 0.25);
        correct = null;
        aiScore = {
          strategy: "word-weaver-phrase-client",
          correct,
          hasAnswer,
          maxPoints: basePoints,
          totalScore: pointsEarned,
        };
      }
    }

    // ✅ SEQUENCE — compare student order to correct order, award partial credit
    if (!isMultiPack && task.taskType === "sequence" && !aiScore) {
      const correctOrder =
        Array.isArray(task.correctOrder) ? task.correctOrder :
        Array.isArray(task.config?.correctOrder) ? task.config.correctOrder :
        Array.isArray(task.order) ? task.order :
        null;

      const studentOrder = answer?.order || answer?.sequence || null;

      if (correctOrder && Array.isArray(studentOrder) && studentOrder.length > 0) {
        let correctCount = 0;
        for (let i = 0; i < correctOrder.length; i++) {
          if (String(studentOrder[i] ?? "").trim() === String(correctOrder[i] ?? "").trim()) {
            correctCount++;
          }
        }
        const total = correctOrder.length;
        const fraction = total > 0 ? correctCount / total : 0;

        correct = fraction === 1;
        pointsEarned = Math.round(basePoints * fraction);
        aiScore = {
          strategy: "sequence-objective",
          correct,
          correctCount,
          totalItems: total,
          fractionCorrect: fraction,
          maxPoints: basePoints,
          totalScore: pointsEarned,
          correctOrder,
          studentOrder,
        };
      } else {
        // No correct order to compare — participation credit
        correct = null;
        pointsEarned = Math.round(basePoints * 0.5);
        aiScore = {
          strategy: "sequence-participation",
          maxPoints: basePoints,
          totalScore: pointsEarned,
        };
      }
    }

    if (!isMultiPack && !isObjective && !aiScore) {
      // "Evidence tasks" are ones that don't expect text and don't have options,
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
        // Load teacher profile once per room (cached on room object) so
        // perspectives / worldview lenses are applied during AI scoring.
        if (!room._teacherProfileCache && room.reportOwnerId) {
          try {
            room._teacherProfileCache = await TeacherProfile.findOne({
              ownerId: String(room.reportOwnerId),
            }).lean();
          } catch {
            // Non-blocking — scoring continues without profile
          }
        }
        try {
          aiScore = await generateAIScore({
            task,
            rubric: task.aiRubric || null,
            submission: submissionForScoring,
            teacherProfile: room._teacherProfileCache || null,
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

    // ── GUARANTEED FALLBACK ──────────────────────────────────────────
    // If a student submitted *something* but all scoring paths resulted in 0
    // (e.g. AI scoring failed, no explicit handler matched), award participation
    // credit so no task type silently scores 0 when a student engaged.
    if (pointsEarned === 0 && !isMultiPack && answer != null) {
      const hasSubmission =
        typeof answer === "string"
          ? answer.trim().length > 0
          : typeof answer === "object"
          ? Object.keys(answer).length > 0
          : !!answer;
      if (hasSubmission && !aiScore) {
        pointsEarned = Math.round(basePoints * 0.15); // 15% participation credit
        aiScore = {
          strategy: "guaranteed-participation-fallback",
          reason: "No explicit handler or AI score — participation credit awarded",
          maxPoints: basePoints,
          totalScore: pointsEarned,
        };
        console.warn(`[scoring-fallback] Task type "${task.taskType}" fell through all scoring paths — awarding ${pointsEarned} participation pts.`);
      }
    }

    // If we're in the multi-pack path, we still need a timestamp
    const submittedAt =
      typeof submittedAtNonMulti === "number" ? submittedAtNonMulti : Date.now();

    // ── SPEED BONUS ──────────────────────────────────────────────────
    // Reward fast answers: up to +50% of basePoints for answering quickly.
    // Full bonus if answered in ≤ 5 s, scales to zero at 60 s, nothing after.
    // Only applies when the answer earned points (correct or partial credit).
    //
    // WHITELIST approach: speed bonus only for quick-recall / objective tasks
    // where faster = better. Thoughtful tasks (essays, debates, creative work,
    // reading comprehension, audio, etc.) should NOT penalise students who
    // take their time to produce quality work.
    const speedBonusEligible = new Set([
      "multiple-choice",
      "physical-multiple-choice",
      "true-false",
      "matching",
      "sequence",
      "sort",
      "flashcards",
      "flashcards-race",
      "diff-detective",
      "brain-blitz",
    ]);
    // These handle their own client-side speed bonus (already baked into pointsEarned)
    const clientSpeedBonusTypes = new Set([
      "true-false-tictactoe",
      "true-false-connect-four",
    ]);

    let speedBonus = 0;
    const elapsedMs = typeof timeMs === "number" && timeMs > 0 ? timeMs : null;
    if (
      pointsEarned > 0 &&
      elapsedMs != null &&
      speedBonusEligible.has(task.taskType) &&
      !clientSpeedBonusTypes.has(task.taskType)
    ) {
      const elapsedSec = elapsedMs / 1000;
      const FAST_THRESHOLD  = 5;   // seconds — full bonus at or below
      const SLOW_THRESHOLD  = 60;  // seconds — no bonus at or above
      const MAX_SPEED_BONUS = Math.round(basePoints * 0.5); // up to +50%

      if (elapsedSec <= FAST_THRESHOLD) {
        speedBonus = MAX_SPEED_BONUS;
      } else if (elapsedSec < SLOW_THRESHOLD) {
        const fraction = 1 - (elapsedSec - FAST_THRESHOLD) / (SLOW_THRESHOLD - FAST_THRESHOLD);
        speedBonus = Math.round(MAX_SPEED_BONUS * fraction);
      }
      pointsEarned += speedBonus;
    }

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

    // ── Record-audio: transcribe + AI feedback (before building review) ──
    let audioTranscript = null;
    if (task.taskType === "record-audio") {
      // Check if client already sent transcript+feedback (direct upload path, no S3)
      const preTranscript = typeof answer?.transcript === "string" ? answer.transcript.trim() : "";
      const preFeedback = typeof answer?.feedback === "string" ? answer.feedback.trim() : "";

      if (preTranscript) {
        // Use pre-computed transcript from direct /api/audio/transcribe endpoint
        audioTranscript = { transcript: preTranscript, feedback: preFeedback };
        const wordCount = preTranscript.split(/\s+/).filter(Boolean).length;
        if (wordCount >= 5) {
          correct = true;
          pointsEarned = task.points || 10;
          aiScore = {
            strategy: "record-audio-transcribed",
            totalScore: pointsEarned,
            maxPoints: task.points || 10,
            transcript: preTranscript,
            feedback: preFeedback,
            wordCount,
          };
        } else {
          correct = null;
          pointsEarned = Math.round((task.points || 10) * 0.5);
          aiScore = {
            strategy: "record-audio-transcribed",
            totalScore: pointsEarned,
            maxPoints: task.points || 10,
            transcript: preTranscript,
            feedback: preFeedback || "Try to say a bit more next time!",
            wordCount,
          };
        }
      }

      // S3 path: fetch audio from S3 and transcribe server-side
      const s3Key = answer?.s3Key || answer?.key || null;
      if (!audioTranscript && s3Key) {
        try {
          const result = await transcribeAndFeedbackRecordAudio(s3Key, task);
          if (result) {
            audioTranscript = result;
            answer.transcript = result.transcript || "";
            const wordCount = (result.transcript || "").split(/\s+/).filter(Boolean).length;
            if (wordCount >= 5) {
              correct = true;
              pointsEarned = task.points || 10;
              aiScore = {
                strategy: "record-audio-transcribed",
                totalScore: pointsEarned,
                maxPoints: task.points || 10,
                transcript: result.transcript,
                feedback: result.feedback,
                wordCount,
              };
            } else {
              correct = null;
              pointsEarned = Math.round((task.points || 10) * 0.5);
              aiScore = {
                strategy: "record-audio-transcribed",
                totalScore: pointsEarned,
                maxPoints: task.points || 10,
                transcript: result.transcript,
                feedback: result.feedback || "Try to say a bit more next time!",
                wordCount,
              };
            }
          }
        } catch (transcribeErr) {
          console.error("[handleStudentSubmit] record-audio transcribe error:", transcribeErr?.message);
          // Graceful fallback — student still gets generic feedback
        }
      }
    }

    let review = null;
    try {
      review = buildReviewPayload({ task, answer, correct, aiScore });
    } catch (reviewErr) {
      console.error("[handleStudentSubmit] buildReviewPayload failed:", reviewErr?.message);
    }

    if (isTestMode) {
      if (typeof ack === "function") {
        ack({
          ok: true,
          testMode: true,
          localOnly: !!team.testLocalOnly,
          roomCode: code,
          teamId: effectiveTeamId,
          taskIndex: idx,
          correct,
          points: pointsEarned,
          maxPoints: Number.isFinite(task?.points) ? Number(task.points) : 100,
          speedBonus: speedBonus || 0,
          aiScore,
          review,
        });
      }
      return;
    }

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

    if (task.taskType === "physical-multiple-choice") {
      const pmcLast = answer?.lastScannedColor || null;

      if (pmcLast && room.teams?.[effectiveTeamId]) {
        const normalized = normalizeStationId(pmcLast, room);
        // Use the canonical station ID if found; otherwise fall back to the raw
        // color string so reassignStationForTeam can still exclude it by color.
        const excludeId = normalized?.id || normalized?.color || pmcLast.toLowerCase().trim() || null;
        if (excludeId) {
          room.teams[effectiveTeamId].lastScannedStationId = excludeId;
        }
      }
    }

    // ── ACK FIRST ── Send response to student BEFORE side effects
    // so that the overlay/review always shows even if progression code crashes.
    // After every graded submission, advance THIS team to the next station so they must rescan.
    reassignStationForTeam(room, effectiveTeamId);

    const nextStation = room.teams?.[effectiveTeamId]?.currentStationId || null;
    const nextStationNorm = nextStation ? normalizeStationId(nextStation, room) : null;

    if (typeof ack === "function") {
      try {
        ack({
          ok: true,
          roomCode: code,
          teamId: effectiveTeamId,
          taskIndex: idx,
          correct,
          accepted: correct,
          points: pointsEarned,
          speedBonus: speedBonus || 0,
          maxPoints: Number.isFinite(task?.points) ? Number(task.points) : 100,
          aiScore,
          review,
          nextStationId: nextStationNorm?.id || nextStation,
          nextStationColor: nextStationNorm?.color || null,
          postSubmitSeconds: Number(task?.reviewPauseSeconds) > 0 ? Number(task.reviewPauseSeconds) : 15,
        });
      } catch (ackErr) {
        console.error("[handleStudentSubmit] ack failed:", ackErr);
      }
    }
    socket.emit("task:received");

    // ── SIDE EFFECTS (fire-and-forget, errors logged but don't affect student) ──
    try {
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

      const isQuickTaskset = isQuick; // same condition

      if (room.taskset && Array.isArray(room.taskset.tasks)) {
        const currentIndex = idx;
        const nextIndex = currentIndex + 1;

        if (isQuickTaskset) {
          sendTaskToTeam(room, effectiveTeamId, nextIndex);
        } else {
          if (!room.teams[effectiveTeamId]) {
            room.teams[effectiveTeamId] = {};
          }

          const progress = getRoomTaskProgress(room);
          const isCatchingUp = currentIndex < progress.maxJoinedTaskIndex;
          const wouldExceedPace = nextIndex > progress.minJoinedTaskIndex + 1;

          if (wouldExceedPace && !isCatchingUp) {
            room.teams[effectiveTeamId].nextTaskIndex = nextIndex;
            room.teams[effectiveTeamId].pacingHold = true;
            io.to(effectiveTeamId).emit("team:pacing-hold", {
              roomCode: code,
              teamId: effectiveTeamId,
              message: "Waiting for other teams to catch up...",
            });
          } else {
            room.teams[effectiveTeamId].nextTaskIndex = nextIndex;
            if (room.teams[effectiveTeamId].pacingHold) {
              delete room.teams[effectiveTeamId].pacingHold;
            }
          }
        }
      }

      checkAndReleasePacingHolds(room, code);

      const submissionSummary = {
        roomCode: code,
        teamId: effectiveTeamId,
        teamName,
        taskIndex: idx,
        answerText,
        correct,
        points: pointsEarned,
        speedBonus: speedBonus || 0,
        timeMs: timeMs ?? null,
        submittedAt,
        aiScore,
      };
      io.to(code).emit("taskSubmission", { ...submissionSummary, review });
    } catch (sideEffectErr) {
      console.error("[handleStudentSubmit] Side-effect error (student already got ack):", sideEffectErr);
    }

  };

  socket.on("student:submitAnswer", (payload, ack) => {
    handleStudentSubmit(payload, ack).catch((err) => {
      console.error("[handleStudentSubmit] Unhandled error:", err?.message || err, err?.stack);
      if (typeof ack === "function") {
        try { ack({ ok: false, error: "Server error during submission" }); } catch {}
      }
    });
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

    if (team.testMode === true && team.testLocalOnly === true) {
      if (typeof ack === "function") {
        ack({
          ok: true,
          testMode: true,
          localOnly: true,
          taskIndex: typeof team.testTaskIndex === "number" ? team.testTaskIndex : team.taskIndex ?? 0,
        });
      }
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
    handleStudentSubmit(payload, ack).catch((err) => {
      console.error("[handleStudentSubmit via task:submit] Unhandled error:", err?.message || err, err?.stack);
      // ack may already have been sent (we send it early now); Socket.IO ignores duplicate acks
      if (typeof ack === "function") {
        try { ack({ ok: false, error: "Server error during submission" }); } catch {}
      }
    });
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
        socket.emit("taskset:error", { message: "Missing room code or taskset ID." });
        return;
      }

      // Auto-create room if it doesn't exist yet (handles race conditions
      // where the socket reconnected between createRoom and loadTaskset)
      let room = rooms[code];
      if (!room) {
        console.warn("handleTeacherLoadTaskset: room not found for", code, "— auto-creating");
        room = await createRoom(code, socket.id);
        rooms[code] = room;
        room.teacherSocketId = socket.id;
        room.teacherInstanceId = socket.data?.teacherInstanceId || socket.id;
        room.lastTeacherSeenAt = Date.now();
        room.expiresAt = Date.now() + 1000 * 60 * 60;
        socket.join(code);
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

      // ── Auto-start configuration ──
      // Modes: "immediate" (legacy: start now), "first_ready", "all_ready", "timer"
      const autoStartMode = payload.autoStartMode || "immediate";
      if (autoStartMode !== "immediate") {
        room.autoStart = {
          mode: autoStartMode,
          timerSeconds: Number(payload.autoStartTimerSeconds) || 180,
          armed: true,
          armedAt: Date.now(),
          minTeams: Number(payload.autoStartMinTeams) || 1,
        };
        console.log(`[AutoStart] Taskset armed for room ${code}, mode=${autoStartMode}`);

        // Timer mode: schedule auto-start after N seconds
        if (autoStartMode === "timer") {
          const delaySec = room.autoStart.timerSeconds;
          if (room._autoStartTimer) clearTimeout(room._autoStartTimer);
          room._autoStartTimer = setTimeout(() => {
            if (room.autoStart?.armed && !room.isActive) {
              console.log(`[AutoStart] Timer expired for room ${code} — starting taskset`);
              startTasksetForRoom(code);
              room.autoStart.armed = false;
              io.to(code).emit("autoStart:triggered", { mode: "timer" });
            }
          }, delaySec * 1000);
          console.log(`[AutoStart] Timer set: ${delaySec}s for room ${code}`);
        }
      } else {
        room.autoStart = null;
      }

      // Increment play counter (covers both direct launches and shared-link plays)
      TaskSet.updateOne(
        { _id: tasksetId },
        { $inc: { totalPlays: 1 }, $set: { lastPlayedAt: new Date() } }
      ).catch((e) => console.warn("Failed to increment totalPlays:", e?.message));

      // Let LiveSession & others refresh their state if needed
      const state = buildRoomState(room);
      io.to(code).emit("room:state", state);
      io.to(code).emit("roomState", state);

      // Notify the teacher client that the taskset is ready
      socket.emit("tasksetLoaded", {
        roomCode: code,
        tasksetId: String(tasksetDoc._id),
        name: (
          tasksetDoc.name ||
          tasksetDoc.title ||
          tasksetDoc.tasksetName ||
          "Untitled set"
        ).replace(/^taskset:\s*/i, "").trim(),
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

  socket.on("teacher:startSession", async (payload = {}) => {
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

    // Refresh teacher preference for paper mode
    try {
      const userId = socket.data?.userId || socket.data?.user?._id || null;
      if (userId) {
        const tp = await TeacherProfile.findOne({ ownerId: String(userId) }).lean();
        if (tp) {
          room.minimizeOnScreen = !!tp.minimizeOnScreen;
        }
      }
    } catch (e) {
      console.warn("[teacher:startSession] Could not load teacher profile:", e.message);
    }

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
  // Behavior dings (teacher awards +/− points to a team)
  // --------------------------
  socket.on("teacher:behaviorDing", (payload = {}) => {
    const { roomCode, teamId, delta, reason } = payload;
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const team = room.teams?.[teamId];
    if (!team) return;

    const pts = Number(delta) || 0;
    if (!Number.isFinite(pts) || pts === 0) return;

    // Store ding in room for report inclusion
    if (!Array.isArray(room.behaviorDings)) room.behaviorDings = [];
    const ding = {
      teamId,
      teamName: team.teamName || "Team",
      delta: pts,
      reason: String(reason || "").trim().slice(0, 120) || (pts > 0 ? "Good behavior" : "Behavior warning"),
      timestamp: Date.now(),
    };
    room.behaviorDings.push(ding);

    // Apply the points via submission so it appears in scores
    addBonusSubmission(room, teamId, pts, "behavior-ding", {
      reason: ding.reason,
      behaviorDing: true,
    });

    // Broadcast updated room state (leaderboard updates)
    const state = buildRoomState(room);
    io.to(code).emit("room:state", state);

    // Send targeted notification to the team's student devices
    io.to(code).emit("behavior:ding", {
      teamId,
      teamName: ding.teamName,
      delta: pts,
      reason: ding.reason,
    });

    console.log(`[behaviorDing] ${ding.teamName} ${pts > 0 ? "+" : ""}${pts} — ${ding.reason}`);
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

  // Game handlers (imported from socket/gameHandlers.js)
  registerGameHandlers(socket, { io, rooms, updateTeamScore, generateAIScore, buildRoomState });

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
    gradingConfig, // { enabled, maxGrade, letterGradeScale }
  } = {}) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) {
      socket.emit("transcript:error", { message: "Room not found" });
      return;
    }

    try {

    const safeOwnerId = String((ownerId || room.reportOwnerId || "").trim());

    // If ownerId isn't provided, try to infer from the connected teacher profile (best-effort)
    // NOTE: This is intentionally conservative to avoid mismatching owners.
    if (!safeOwnerId) {
      console.warn("teacher:endSessionAndEmail missing ownerId (Option A expects it).");
    }

    // 0.5) Fallback: load assessmentCategories from TeacherProfile if not sent by frontend
    let safeAssessmentCategories = Array.isArray(assessmentCategories) && assessmentCategories.length > 0
      ? assessmentCategories
      : [];
    if (safeAssessmentCategories.length === 0 && safeOwnerId) {
      try {
        const tp = await TeacherProfile.findOne({ ownerId: safeOwnerId }).select("assessmentCategories").lean();
        if (tp && Array.isArray(tp.assessmentCategories) && tp.assessmentCategories.length > 0) {
          safeAssessmentCategories = tp.assessmentCategories;
          console.log(`[report] Loaded ${safeAssessmentCategories.length} assessment categories from TeacherProfile for owner ${safeOwnerId}`);
        }
      } catch (e) {
        console.warn("[report] Failed to load assessmentCategories from TeacherProfile:", e.message);
      }
    }

    // Immediately signal ALL students that the session is complete.
    // This triggers the feedback form on student devices before reports are generated.
    io.to(code).emit("session:complete");

    // Helper: emit progress to teacher UI
    const emitProgress = (step, total, label) => {
      socket.emit("report:progress", { step, total, label });
      io.to(code).emit("report:progress", { step, total, label });
    };

    // 1) Build transcript + stats
    emitProgress(1, 6, "Building transcript…");
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

    // 2.5) Compute top teams and top players for AI blurb
    const topTeams = Object.values(room.teams || {})
      .map((t) => ({ name: t.teamName || t.name || "Team", score: t.score ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const topPlayers = [...perParticipant]
      .sort((a, b) => (b.pointsEarned ?? 0) - (a.pointsEarned ?? 0))
      .slice(0, 3)
      .map((p) => ({ name: p.studentName || "Player", team: p.teamName || "", points: p.pointsEarned ?? 0 }));

    // 3) Generate AI summary (overview + engagement) — non-fatal if it fails
    emitProgress(2, 6, "Generating AI summary…");
    let summary = {};
    try {
      summary = await generateSessionSummaries({
        roomCode: code,
        transcript,
        perParticipantStats: perParticipant,
        assessmentCategories: safeAssessmentCategories,
        perspectives,
        className,
        gradeLevel,
        planTierUsed,
        topTeams,
        topPlayers,
      });
    } catch (aiErr) {
      console.error("[report] AI summary generation failed (continuing without it):", aiErr?.message || aiErr);
      summary = { groupSummary: "AI summary unavailable.", keyConcepts: [], perParticipant: [] };
    }

    // 3.5) Merge AI per-participant summaries into raw stats for enriched reports
    const aiPerParticipant = Array.isArray(summary?.perParticipant) ? summary.perParticipant : [];
    if (aiPerParticipant.length > 0) {
      for (const p of perParticipant) {
        const match = aiPerParticipant.find(
          (ai) =>
            (ai.studentName || "").toLowerCase() === (p.studentName || "").toLowerCase() &&
            (ai.teamName || "").toLowerCase() === (p.teamName || "").toLowerCase()
        );
        if (match) {
          p.summary = match.summary || "";
          p.categories = Array.isArray(match.categories) ? match.categories : [];
          if (match.engagementPercent != null) p.engagementPercent = match.engagementPercent;
          if (match.finalPercent != null) p.finalPercent = match.finalPercent;
        }
      }
    }

    // Also map fields expected by the PDF renderer
    for (const p of perParticipant) {
      p.name = p.name || p.studentName;
      p.tasksAttempted = p.tasksAttempted ?? p.attempts ?? 0;
      p.accuracyPercent = p.accuracyPercent ?? (p.attempts > 0 ? Math.round((p.correctCount / p.attempts) * 100) : 0);
      p.engagementScore = p.engagementScore ?? p.engagementPercent ?? 0;
      p.notes = p.notes || p.summary || "";
    }

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

    // 5) Compute per-student gradebook grades
    // Resolve grading config: prefer session-level override, fall back to taskset config
    const gc = gradingConfig || room.taskset?.gradingConfig || null;
    const gradingEnabled = gc && gc.enabled === true;
    const maxGrade = gradingEnabled && Number(gc.maxGrade) > 0 ? Number(gc.maxGrade) : 100;
    const defaultScale = [
      { min: 90, letter: "A" },
      { min: 80, letter: "B" },
      { min: 70, letter: "C" },
      { min: 60, letter: "D" },
      { min: 0, letter: "F" },
    ];
    const letterScale = Array.isArray(gc?.letterGradeScale) && gc.letterGradeScale.length > 0
      ? gc.letterGradeScale.slice().sort((a, b) => b.min - a.min)
      : defaultScale;

    function computeLetterGrade(pct) {
      for (const tier of letterScale) {
        if (pct >= tier.min) return tier.letter;
      }
      return "F";
    }

    const studentGrades = (perParticipant || []).map((p) => {
      const pct = p.finalPercent ?? (p.pointsPossible > 0 ? Math.round((p.pointsEarned / p.pointsPossible) * 100) : 0);
      const scaled = Math.round((pct / 100) * maxGrade * 10) / 10; // one decimal
      return {
        studentName: p.studentName || "Unknown",
        teamName: p.teamName || "",
        pointsEarned: p.pointsEarned || 0,
        pointsPossible: p.pointsPossible || 0,
        percent: pct,
        scaledGrade: scaled,
        maxGrade,
        letterGrade: computeLetterGrade(pct),
      };
    });

    // 6) Persist immutable report snapshot
    emitProgress(3, 6, "Computing grades…");

    // Compute class averages for the overview card
    let classAverageScore = null;
    let classAverageEngagement = null;
    if (Array.isArray(perParticipant) && perParticipant.length > 0) {
      const withScores = perParticipant.filter((p) => p.pointsPossible > 0);
      if (withScores.length > 0) {
        const totalPct = withScores.reduce((s, p) => s + (p.pointsPossible > 0 ? (p.pointsEarned / p.pointsPossible) * 100 : 0), 0);
        classAverageScore = Math.round(totalPct / withScores.length);
      }
      // Engagement: percentage of tasks attempted (attempts / total tasks)
      const totalTasks = transcript?.tasks?.length || 0;
      if (totalTasks > 0) {
        const avgAttemptRate = perParticipant.reduce((s, p) => s + Math.min(1, (p.attempts || 0) / totalTasks), 0) / perParticipant.length;
        classAverageEngagement = Math.round(avgAttemptRate * 100);
      }
    }

    let reportDoc = null;
    emitProgress(4, 6, "Saving report…");

    // Build teams array with exit feedback + mood checkins from in-memory room state.
    // This data only lives in memory during the session and must be captured now.
    const reportTeams = (() => {
      const teamsMap = room.teams && typeof room.teams === "object" ? room.teams : {};
      const moods = room.moodCheckins && typeof room.moodCheckins === "object" ? room.moodCheckins : {};
      const feedbacks = room.feedback && typeof room.feedback === "object" ? room.feedback : {};
      const submissions = Array.isArray(room.submissions) ? room.submissions : [];
      const totalTasks = transcript?.tasks?.length || 0;

      return Object.entries(teamsMap).map(([teamId, team]) => {
        const teamName = String(team?.teamName || team?.name || `Team-${String(teamId).slice(-4)}`);
        const members = Array.isArray(team?.members) ? team.members.map(String).filter(Boolean) : [];

        const teamSubs = submissions.filter((s) => String(s?.teamId) === String(teamId));
        const attemptedIdxs = [...new Set(teamSubs.map((s) => s?.taskIndex).filter((n) => Number.isFinite(n) && n >= 0))];
        const tasksCompleted = attemptedIdxs.length;
        const teamPoints = teamSubs.reduce((sum, s) => sum + (Number(s?.points) || 0), 0);
        const pointsPossible = totalTasks > 0
          ? attemptedIdxs.reduce((sum, idx) => {
              const t = transcript?.tasks?.[idx];
              return sum + (Number(t?.points) || Number(t?.maxPoints) || 10);
            }, 0)
          : 0;
        const scorePercent = pointsPossible > 0 ? Math.max(0, Math.min(100, Math.round((teamPoints / pointsPossible) * 100))) : 0;
        const engagementScore = totalTasks > 0 ? Math.max(0, Math.min(100, Math.round((tasksCompleted / totalTasks) * 100))) : 0;

        const mood = moods[String(teamId)] || null;
        const fb = feedbacks[String(teamId)] || null;

        return {
          teamId: String(teamId),
          teamName,
          members,
          moodEntry: mood
            ? {
                moods: Array.isArray(mood?.moods) ? mood.moods.filter((n) => Number.isInteger(n)) : [],
                excitement: String(mood?.excitement || ""),
                submittedAt: mood?.submittedAt ? new Date(mood.submittedAt) : null,
              }
            : { moods: [], excitement: "", submittedAt: null },
          tasksCompleted,
          engagementScore,
          scorePercent,
          teamPoints,
          pointsPossible,
          exitFeedback: fb
            ? {
                rating: Number.isFinite(fb?.rating) ? Number(fb.rating) : null,
                highlights: String(fb?.highlights || ""),
                improvements: String(fb?.improvements || ""),
                favoriteTask: String(fb?.favoriteTask || ""),
                learned: String(fb?.learned || ""),
                submittedAt: fb?.submittedAt ? new Date(fb.submittedAt) : null,
              }
            : { rating: null, highlights: "", improvements: "", favoriteTask: "", learned: "", submittedAt: null },
          scoringBreakdown: { percent: scorePercent, categories: [] },
        };
      });
    })();

    try {
      if (safeOwnerId) {
        reportDoc = await SessionReport.create({
          ownerId: safeOwnerId,
          roomCode: code,
          className: safeClass,
          gradeLevel: safeGrade,
          startedAt: room.startedAt || Date.now(),
          taskSetName: room.taskset?.name || room.taskSetName || "",
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
          teams: reportTeams,
          noiseSummary: computeNoiseSummary(room?.noiseSamples || [], room?.noiseControl || {}),
          noiseSamples: Array.isArray(room?.noiseSamples) ? room.noiseSamples : [],
          perParticipant,
          mediaSubmissions,
          gradingConfig: gradingEnabled ? { enabled: true, maxGrade, letterGradeScale: letterScale } : null,
          studentGrades,
          assessmentCategories: safeAssessmentCategories,
          includeIndividualReports: !!includeIndividualReports,
          classAverageScore,
          classAverageEngagement,
        });
      }
    } catch (e) {
      console.error("Failed to persist SessionReport:", e);
    }

    // Emit report:ready immediately after save, regardless of email outcome.
    // This ensures the Analytics page refreshes even if email times out.
    if (reportDoc?._id) {
      io.to(code).emit("report:ready", {
        roomCode: code,
        reportId: String(reportDoc._id),
      });
    }

    // 5b) Aggregate per-task-type timing stats (fire-and-forget, non-blocking)
    try {
      const sessionTasks = room?.taskset?.tasks || [];
      const sessionSubs = Array.isArray(room.submissions) ? room.submissions : [];
      aggregateTimingStats(sessionSubs, sessionTasks, safeOwnerId).catch((err) =>
        console.warn("[TaskTypeTimingAggregator] background error:", err?.message || err)
      );
    } catch (e) {
      console.warn("[TaskTypeTimingAggregator] setup error:", e?.message || e);
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
    emitProgress(5, 6, "Sending email report…");
    try {
      // Wrap email send in a 45-second timeout so the progress bar never hangs
      await Promise.race([
        sendTranscriptEmail({
          to: toEmail,
          roomCode: code,
          schoolName,
          aiSummary: summary,
          transcript,
          perParticipant,
          assessmentCategories: safeAssessmentCategories,
          includeIndividualReports,
          parentNote,
          mediaSubmissions,
          reportId: reportDoc?._id ? String(reportDoc._id) : null,
          planName: planTierUsed,
          studentGrades,
          gradingConfig: gc,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Email send timed out after 45 seconds")), 45_000)
        ),
      ]);

      // 8) If this was a shared run, also email the original teacher
      const sharedFromTeacherId = reportDoc?.sharedFromTeacherId || room.reportOwnerId;
      const sharedFromTeacherEmail = reportDoc?.sharedFromTeacherEmail || room.reportOwnerEmail;

      if (sharedFromTeacherId && sharedFromTeacherEmail && String(sharedFromTeacherId) !== String(safeOwnerId)) {
        try {
          // Send a copy of the report to the original teacher
          await sendTranscriptEmail({
            to: sharedFromTeacherEmail,
            roomCode: code,
            schoolName,
            aiSummary: summary,
            transcript,
            perParticipant,
            assessmentCategories: safeAssessmentCategories,
            includeIndividualReports,
            parentNote,
            mediaSubmissions,
            reportId: reportDoc?._id ? String(reportDoc._id) : null,
            planName: planTierUsed,
            isSharedRunCopy: true, // Optional flag for the emailer to customize the email
            studentGrades,
            gradingConfig: gc,
          });
          console.log(`[shared] Sent report email to original teacher: ${sharedFromTeacherEmail}`);
        } catch (e) {
          console.warn(`[shared] Failed to email original teacher (${sharedFromTeacherEmail}):`, e);
        }
      }

      // ── Student report emails (fire-and-forget) ──
      // Collect all student emails from team objects + feedback submissions
      try {
        const studentCC = "admin@curriculate.net";
        const teamsMap = room.teams && typeof room.teams === "object" ? room.teams : {};
        const feedbackMap = room.feedback && typeof room.feedback === "object" ? room.feedback : {};

        // Compute team rankings for the report
        const rankedTeams = Object.entries(teamsMap)
          .map(([tid, t]) => ({ tid, name: t.teamName || "Team", score: t.score ?? 0 }))
          .sort((a, b) => b.score - a.score);

        for (const [tid, team] of Object.entries(teamsMap)) {
          const teamEmails = Array.isArray(team.emails) ? team.emails.filter((e) => e && e.includes("@")) : [];
          // Also check feedback for a reportEmail
          const fbEmail = feedbackMap[tid]?.reportEmail;
          if (fbEmail && !teamEmails.includes(fbEmail)) teamEmails.push(fbEmail);

          if (!teamEmails.length) continue;

          const teamRankEntry = rankedTeams.findIndex((r) => r.tid === tid);
          const teamRank = teamRankEntry >= 0 ? teamRankEntry + 1 : null;

          // Find per-participant AI summaries for this team
          const teamParticipants = perParticipant.filter(
            (p) => String(p.teamId || "") === String(tid) || String(p.teamName || "").toLowerCase() === String(team.teamName || "").toLowerCase()
          );

          // Gather per-task evidence for this team from submissions
          const teamSubs = (Array.isArray(room.submissions) ? room.submissions : [])
            .filter((s) => String(s?.teamId) === String(tid));
          const perTaskEvidence = teamSubs.map((s) => {
            const task = room?.taskset?.tasks?.[s.taskIndex] || {};
            return {
              taskIndex: s.taskIndex,
              type: task.taskType || task.type || "",
              title: task.title || `Task ${(s.taskIndex ?? 0) + 1}`,
              pointsEarned: Number(s.points ?? 0),
              maxPoints: Number(task.points ?? 100) * 10,
              isCorrect: s.correct ?? s.isCorrect ?? null,
              aiFeedback: s.aiFeedback || s.feedback || "",
            };
          });

          // Team score percent
          const teamPtsPossible = perTaskEvidence.reduce((sum, t) => sum + (t.maxPoints || 0), 0);
          const teamPtsEarned = perTaskEvidence.reduce((sum, t) => sum + (t.pointsEarned || 0), 0);
          const teamScorePct = teamPtsPossible > 0 ? Math.round((teamPtsEarned / teamPtsPossible) * 100) : null;

          const fb = feedbackMap[tid] || {};

          for (const email of teamEmails) {
            sendStudentReportEmail({
              to: email,
              cc: studentCC,
              roomCode: code,
              className: safeClass,
              taskSetName: room?.taskset?.name || room?.taskset?.title || "",
              teamName: team.teamName || "Your Team",
              teamScore: team.score ?? 0,
              teamScorePercent: teamScorePct,
              teamRank,
              totalTeams: rankedTeams.length,
              members: Array.isArray(team.members) ? team.members : [],
              perTask: perTaskEvidence,
              feedback: fb,
              participantSummaries: teamParticipants,
              aiSummary: summary,
            }).catch((err) => console.warn(`[studentReport] Failed to send to ${email}:`, err?.message || err));
          }
        }
      } catch (studentReportErr) {
        console.warn("[studentReport] Error sending student reports:", studentReportErr?.message || studentReportErr);
      }

      emitProgress(6, 6, "Done! Report sent.");
      socket.emit("transcript:sent", {
        ok: true,
        email: toEmail || teacherEmail || "",
        reportId: reportDoc?._id ? String(reportDoc._id) : null,
      });
    } catch (e) {
      console.error("Transcript emailing failed:", e);
      const isTimeout = /timed? ?out/i.test(e?.message || "");
      emitProgress(5, 6, isTimeout
        ? "Email timed out — report saved, but email could not be delivered."
        : "Email failed — report saved, check your email settings.");
      socket.emit("transcript:error", {
        message: isTimeout
          ? "Email send timed out. Your report was saved — you can view it on the Reports page."
          : "Failed to send transcript email. Your report was saved — you can view it on the Reports page.",
        reportId: reportDoc?._id ? String(reportDoc._id) : null,
      });
    }

    } catch (outerErr) {
      console.error("teacher:endSessionAndEmail crashed:", outerErr);
      socket.emit("transcript:error", {
        message: outerErr?.message || "Report generation failed unexpectedly.",
      });
    }
  }
);


  // ─────────────────────────────────────────────
  // Retry email for an already-saved report
  // ─────────────────────────────────────────────
  socket.on("report:retryEmail", async ({ reportId, roomCode: code }) => {
    try {
      if (!reportId) {
        socket.emit("transcript:error", { message: "No saved report to retry." });
        return;
      }
      const report = await SessionReport.findById(reportId).lean();
      if (!report) {
        socket.emit("transcript:error", { message: "Report not found in database." });
        return;
      }
      // Look up teacher email
      let toEmail = "";
      try {
        const profile = await TeacherProfile.findOne({ ownerId: report.ownerId }).lean();
        if (profile?.email) toEmail = String(profile.email).trim();
      } catch (_) {}

      socket.emit("report:progress", { step: 5, total: 6, label: "Retrying email…" });

      await Promise.race([
        sendTranscriptEmail({
          to: toEmail,
          roomCode: report.roomCode,
          schoolName: report.schoolName || "",
          aiSummary: report.summary,
          transcript: report.transcript,
          perParticipant: report.perParticipant || [],
          assessmentCategories: report.assessmentCategories || [],
          includeIndividualReports: report.includeIndividualReports,
          parentNote: report.parentNote || "",
          mediaSubmissions: report.mediaSubmissions || [],
          reportId: String(report._id),
          planName: report.planTierUsed || "",
          studentGrades: report.studentGrades || [],
          gradingConfig: report.gradingConfig || null,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Email retry timed out after 45 seconds")), 45_000)
        ),
      ]);

      socket.emit("report:progress", { step: 6, total: 6, label: "Done! Email sent." });
      socket.emit("transcript:sent", {
        ok: true,
        email: toEmail,
        reportId: String(report._id),
      });
    } catch (e) {
      console.error("report:retryEmail failed:", e);
      socket.emit("transcript:error", {
        message: `Email retry failed: ${e?.message || "Unknown error"}. Your report is still saved — view it on the Reports page.`,
        reportId,
      });
    }
  });

  // ─────────────────────────────────────────────
  // Disconnect / offline cleanup (team sockets)
  // Add this AFTER debate-response (or near the bottom of connection handler)
  // ─────────────────────────────────────────────
  socket.on("disconnect", async (reason) => {
    try {
      // ✅ Teacher disconnect: give a 10-second grace window before pruning.
      // A browser refresh or brief network blip should not immediately evict
      // all active student sessions.  The teacher's LiveSession page sends a
      // stable teacherInstanceId so a rapid reconnect will cancel this timeout.
      if (socket.data?.role === "teacher") {
        const instId = normalizeTeacherInstanceId(socket.data?.teacherInstanceId, socket.id);

        // Store the pending prune timeout on the room objects so an incoming
        // teacher:join for the same instanceId can cancel it.
        const pruneTimeout = setTimeout(() => {
          pruneTeacherRoomsByInstance(instId, null);
        }, 10_000); // 10-second grace period

        // Tag every room this teacher owns with the pending prune so join can cancel it
        for (const room of Object.values(rooms)) {
          if (room?.teacherInstanceId === instId) {
            if (room._pendingPruneTimeout) clearTimeout(room._pendingPruneTimeout);
            room._pendingPruneTimeout = pruneTimeout;
          }
        }

        console.log(`[ROOM] Teacher ${instId} disconnected — will prune rooms in 10 s if not reconnected`);
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

          // Optional: free station so the room doesn't get "blocked" by offline teams
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

// Reading comp ai prompt
async function runReadingCompCheck({ paragraph, answer, gradeLevel }) {
  const prompt = `
    You are checking a student's reading-comprehension response.

    Grade level: ${gradeLevel ?? "unknown"}

    Paragraph:
    """${paragraph}"""

    Student answer:
    """${answer}"""

    Return JSON only in this exact shape:
    {
      "decision": "accept" | "followup",
      "reason": "clear" | "too_vague" | "partial" | "unclear" | "likely_copied",
      "feedback": string,
      "followUpQuestion": string | null
    }

    Rules:
    - Accept if the student shows a reasonable understanding of the paragraph, even if the wording is imperfect.
    - Accept paraphrases and partial explanations if the main idea is correct.
    - Do NOT require exact wording or multiple details for acceptance.
    - Only use followup if:
      - the answer is very vague
      - OR clearly incomplete and missing the main idea
      - OR unclear/confusing
      - OR appears copied without showing understanding
    - If the student includes the main idea, ACCEPT.

    Feedback rules:
    - feedback must be exactly one short sentence.
    - feedback must be specific to the student's answer.
    - If the answer is accepted, say briefly what the student understood.
    - If the answer is not accepted, name the missing idea directly in student-friendly language.
    - Do not say vague things like "be clearer" or "add more detail" by themselves.

    Follow-up rules:
    - Ask exactly ONE short question.
    - Only include a followUpQuestion when decision is "followup".
    - The question must target the missing idea directly.
    - Do NOT ask generic questions like "Can you explain more?"
    - The question must be answerable from the paragraph.
    - Keep it student-friendly.
    - Do not explain your reasoning.
    `.trim();

      const schema = {
        type: "object",
        additionalProperties: false,
        properties: {
          decision: {
            type: "string",
            enum: ["accept", "followup"],
          },
          reason: {
            type: "string",
            enum: ["clear", "too_vague", "partial", "unclear", "likely_copied"],
          },
          feedback: {
            type: "string",
          },
          followUpQuestion: {
            type: ["string", "null"],
          },
        },
        required: ["decision", "reason", "feedback", "followUpQuestion"],
      };

      const response = await openai.responses.create({
        model: process.env.AI_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "reading_comp_check",
            strict: true,
            schema,
          },
        },
        max_output_tokens: 220,
      });

      const parsed = safeJsonParse(response.output_text) || {};

      const decision = parsed?.decision === "followup" ? "followup" : "accept";
      const reason =
        typeof parsed?.reason === "string" ? parsed.reason : "clear";

      const feedback =
        String(parsed?.feedback || "").trim() ||
        (decision === "accept"
          ? "You showed the main idea clearly."
          : "Your answer is missing the main idea from the paragraph.");

      const followUpQuestion =
        decision === "followup"
          ? String(parsed?.followUpQuestion || "").trim() ||
            "What is the main idea the paragraph is trying to explain?"
          : null;

      return {
        decision,
        reason,
        feedback,
        followUpQuestion,
      };
    }

async function evaluateMultiShortItem({
  prompt,
  studentAnswer,
  correctAnswer,
  acceptableAnswers = [],
  gradeLevel = "6-8",
  maxPoints = 1,
}) {
  const cleanPrompt = String(prompt || "").trim().slice(0, 1000);
  const cleanStudent = String(studentAnswer || "").trim().slice(0, 1000);
  const cleanCorrect = String(correctAnswer || "").trim().slice(0, 1000);
  const cleanAcceptable = Array.isArray(acceptableAnswers)
    ? acceptableAnswers.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8)
    : [];

  if (!cleanStudent) {
    return {
      score: 0,
      maxPoints,
      correct: false,
      feedback: "No answer given.",
      hint: "Include the main idea from the question.",
      modelAnswer: "",
    };
  }

  const promptText = `
    You are grading one short-answer item from a student assignment.

    Grade level: ${gradeLevel}

    Question:
    ${cleanPrompt}

    Student answer:
    ${cleanStudent}

    Correct answer:
    ${cleanCorrect || "(not provided)"}

    Other acceptable answers:
    ${cleanAcceptable.length ? cleanAcceptable.join(" | ") : "(none)"}

    Return JSON only in this exact shape:
    {
      "score": number,
      "maxPoints": number,
      "correct": boolean,
      "feedback": string,
      "hint": string,
      "modelAnswer": string
    }

    Rules:
    - score must be between 0 and ${maxPoints}
    - Use full credit if the student clearly shows the correct idea, even if wording differs.
    - Be lenient but accurate.
    - Do NOT require exact keywords if the meaning is clearly correct.
    - feedback must be specific to this student's answer and this question.
    - If the answer is incomplete or wrong, name the missing key fact or concept directly.
    - Do not say vague things like "be clearer" or "add more detail" by themselves.
    - hint must strongly guide the student toward the correct idea without copying the full answer.
    - modelAnswer must be one short, student-friendly model answer.
    `.trim();

      const schema = {
        type: "object",
        additionalProperties: false,
        properties: {
          score: { type: "number" },
          maxPoints: { type: "number" },
          correct: { type: "boolean" },
          feedback: { type: "string" },
          hint: { type: "string" },
          modelAnswer: { type: "string" },
        },
        required: ["score", "maxPoints", "correct", "feedback", "hint", "modelAnswer"],
      };

      try {
        const response = await openai.responses.create({
          model: process.env.AI_MODEL || "gpt-4.1-mini",
          input: [
            {
              role: "user",
              content: [{ type: "input_text", text: promptText }],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "multi_short_item_eval",
              strict: true,
              schema,
            },
          },
          max_output_tokens: 220,
        });

        const parsed = safeJsonParse(response.output_text) || {};
        const rawScore = Number(parsed?.score);
        const boundedScore = Number.isFinite(rawScore)
          ? Math.max(0, Math.min(maxPoints, rawScore))
          : 0;

        return {
          score: boundedScore,
          maxPoints,
          correct: parsed?.correct === true || boundedScore >= maxPoints,
          feedback: String(parsed?.feedback || "").trim() || "Answer needs improvement.",
          hint: String(parsed?.hint || "").trim() || "Include the key idea more directly.",
          modelAnswer: String(parsed?.modelAnswer || "").trim() || "",
        };
      } catch (evalErr) {
        console.error("evaluateMultiShortItem AI call failed:", evalErr?.message || evalErr);
        return {
          score: 0,
          maxPoints,
          correct: false,
          feedback: "Could not evaluate answer.",
          hint: "Try again and include the main idea.",
          modelAnswer: "",
        };
      }
    }

// Profile routes (imported from routes/profileInline.js)
app.use("/api/profile", profileInlineRouter);

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

// Reading comp understanding check for follow-up
app.post("/api/tasks/reading-comp/check", async (req, res) => {
  try {
    const paragraph = String(req.body?.paragraph || "").trim().slice(0, 8000);
    const answer = String(req.body?.answer || "").trim().slice(0, 1000);
    const gradeLevel = req.body?.gradeLevel;

    if (!paragraph || !answer) {
      return res.status(400).json({ error: "Missing paragraph or answer." });
    }

    const result = await runReadingCompCheck({
      paragraph,
      answer,
      gradeLevel,
    });

    return res.json(result);
  } catch (err) {
    console.error("POST /api/tasks/reading-comp/check error:", err);
    return res.status(500).json({ error: "Failed to check comprehension." });
  }
});

app.post("/api/evaluate/short-answer", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim().slice(0, 4000);
    const studentAnswer = String(req.body?.studentAnswer || "").trim().slice(0, 1000);
    const gradeLevel = req.body?.gradeLevel;
    const correctAnswer = String(req.body?.correctAnswer || "").trim().slice(0, 1000);
    const acceptableAnswers = Array.isArray(req.body?.acceptableAnswers)
      ? req.body.acceptableAnswers.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8)
      : [];

    if (!question || !studentAnswer) {
      return res.status(400).json({ error: "Missing data" });
    }

    if (studentAnswer.split(/\s+/).length < 3) {
      return res.json({
        type: "SHORT_ANSWER",
        studentAnswer,
        correct: false,
        feedback: "Please write a fuller answer.",
        hint: "Use a complete thought and include the main idea.",
      });
    }

    const prompt = `
      You are a teacher evaluating a student's short answer.

      Grade level: ${gradeLevel || "6-8"}

      Question:
      ${question}

      Student answer:
      ${studentAnswer}

      Correct answer:
      ${correctAnswer || "(not provided)"}

      Other acceptable answers:
      ${acceptableAnswers.length ? acceptableAnswers.join(" | ") : "(none)"}

      Return JSON ONLY in this exact shape:
      {
        "correct": true,
        "feedback": "one short sentence",
        "hint": "one short sentence that strongly hints at the correct idea without copying the full answer"
      }

      Rules:
      - Decide if the answer shows understanding of the question.
      - Be lenient but accurate.
      - If the answer is incomplete or wrong, the hint must strongly steer the student toward the missing idea.
      - Do not be vague.
      - Keep both feedback and hint student-friendly.
      `.trim();

          const response = await openai.chat.completions.create({
            model: process.env.AI_MODEL || "gpt-4.1-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
          });

          const text = response.choices?.[0]?.message?.content || "{}";

          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = {
              correct: false,
              feedback: "Could not evaluate answer.",
              hint: "Try again and include the main idea.",
            };
          }

          return res.json({
            type: "SHORT_ANSWER",
            studentAnswer,
            correct: parsed.correct === true,
            feedback: parsed.feedback || "",
            hint: parsed.hint || "",
          });
        } catch (err) {
          console.error("Short answer eval error:", err);
          return res.status(500).json({ error: "Evaluation failed" });
        }
      });

/* ------------------------------------------------------------------ */
/*  Letter task — real-time AI reply from character                    */
/* ------------------------------------------------------------------ */
app.post("/api/evaluate/letter-reply", async (req, res) => {
  try {
    const {
      studentLetter, character, characterDescription,
      letterStyle, topicContext, gradeLevel, relevantConcepts,
    } = req.body || {};

    const letter = String(studentLetter || "").trim().slice(0, 3000);
    const charName = String(character || "Historical Figure").slice(0, 100);
    const charDesc = String(characterDescription || "").slice(0, 300);
    const style = letterStyle === "business" ? "business" : "friendly";
    const topic = String(topicContext || "").slice(0, 500);
    const grade = parseInt(gradeLevel, 10) || 7;
    const concepts = Array.isArray(relevantConcepts)
      ? relevantConcepts.slice(0, 12).map((c) => String(c).trim()).filter(Boolean)
      : [];

    if (!letter) return res.status(400).json({ error: "Missing studentLetter" });

    const prompt = `
You are ${charName}. ${charDesc}

A student (grade ${grade}) has written you a ${style} letter about: ${topic || "your life and times"}.

Here is their letter:
---
${letter}
---

Write a reply letter back to the student, IN CHARACTER as ${charName}. Guidelines:
- Use a ${style} letter format (${style === "business" ? "formal greeting, structured paragraphs, professional closing" : "warm greeting, conversational tone, friendly closing"}).
- Respond to specific things the student mentioned — show you read their letter.
- Naturally weave in 1-3 of these key concepts if relevant: ${concepts.join(", ") || "any relevant historical details"}.
- Keep language appropriate for grade ${grade}.
- Be encouraging about their writing. If they included good details, mention that.
- Keep the reply 80-150 words — concise but warm.
- Sign off as ${charName}.
- Return ONLY the letter text, no JSON wrapping or markdown.
    `.trim();

    const response = await openai.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 400,
    });

    const reply = (response.choices?.[0]?.message?.content || "").trim();

    return res.json({ reply: reply || `Dear student,\n\nThank you for your thoughtful letter!\n\nSincerely,\n${charName}` });
  } catch (err) {
    console.error("Letter reply error:", err);
    return res.status(500).json({ error: "Reply generation failed" });
  }
});

/* ------------------------------------------------------------------ */
/*  Case Study — AI expert feedback on student's solution              */
/* ------------------------------------------------------------------ */
app.post("/api/evaluate/case-study-feedback", async (req, res) => {
  try {
    const {
      studentResponse, scenario, expertRole, expertDescription,
      gradeLevel, relevantConcepts,
    } = req.body || {};

    const response = String(studentResponse || "").trim().slice(0, 3000);
    const scene = String(scenario || "").slice(0, 800);
    const role = String(expertRole || "Subject Expert").slice(0, 100);
    const roleDesc = String(expertDescription || "").slice(0, 300);
    const grade = parseInt(gradeLevel, 10) || 7;
    const concepts = Array.isArray(relevantConcepts)
      ? relevantConcepts.slice(0, 12).map((c) => String(c).trim()).filter(Boolean)
      : [];

    if (!response) return res.status(400).json({ error: "Missing studentResponse" });

    const prompt = `
You are a ${role}. ${roleDesc}

A student (grade ${grade}) was presented with this case study:
---
${scene}
---

Here is their proposed solution/analysis:
---
${response}
---

Provide expert feedback on their solution. Guidelines:
- Acknowledge what they got right — be encouraging first.
- Point out 1-2 things they could improve or didn't consider.
- If they used any of these key concepts well, praise that: ${concepts.join(", ") || "relevant domain terms"}.
- Suggest one follow-up question to deepen their thinking.
- Keep language appropriate for grade ${grade}.
- Be warm but substantive — this is a learning moment.
- Keep the feedback 80-150 words.
- Sign off with your title/role.
- Return ONLY the feedback text, no JSON wrapping or markdown.
    `.trim();

    const aiResponse = await openai.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 400,
    });

    const feedback = (aiResponse.choices?.[0]?.message?.content || "").trim();

    return res.json({ feedback: feedback || `Good analysis! You raised some solid points.\n\n— ${role}` });
  } catch (err) {
    console.error("Case study feedback error:", err);
    return res.status(500).json({ error: "Feedback generation failed" });
  }
});

/* ------------------------------------------------------------------ */
/*  Art View — image fallback lookup via Wikimedia Commons API          */
/* ------------------------------------------------------------------ */
app.post("/api/art-view/image-fallback", async (req, res) => {
  try {
    const { imageTitle, imageArtist, imageYear, imageDescription } = req.body || {};

    // Build a search query from whatever metadata we have
    const parts = [imageTitle, imageArtist, imageYear].map(s => String(s || "").trim()).filter(Boolean);
    const query = parts.length ? parts.join(" ") : String(imageDescription || "").slice(0, 100);

    if (!query.trim()) {
      return res.status(400).json({ ok: false, error: "No image metadata provided for fallback lookup" });
    }

    // Search Wikimedia Commons for matching images
    const searchUrl = `https://commons.wikimedia.org/w/api.php?` +
      `action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6` +
      `&srlimit=5&format=json&origin=*`;

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);

    const searchRes = await fetch(searchUrl, { signal: ctrl.signal }).finally(() => clearTimeout(timeout));
    if (!searchRes.ok) throw new Error(`Wikimedia search failed: ${searchRes.status}`);

    const searchData = await searchRes.json();
    const results = searchData?.query?.search || [];

    if (!results.length) {
      return res.json({ ok: false, error: "No matching images found on Wikimedia Commons", query });
    }

    // Get the direct image URL for the first result
    const fileName = results[0].title; // e.g. "File:Starry Night.jpg"
    const imageInfoUrl = `https://commons.wikimedia.org/w/api.php?` +
      `action=query&titles=${encodeURIComponent(fileName)}&prop=imageinfo&iiprop=url|size|mime` +
      `&format=json&origin=*`;

    const ctrl2 = new AbortController();
    const timeout2 = setTimeout(() => ctrl2.abort(), 8000);

    const infoRes = await fetch(imageInfoUrl, { signal: ctrl2.signal }).finally(() => clearTimeout(timeout2));
    if (!infoRes.ok) throw new Error(`Wikimedia imageinfo failed: ${infoRes.status}`);

    const infoData = await infoRes.json();
    const pages = infoData?.query?.pages || {};
    const page = Object.values(pages)[0];
    const imageInfo = page?.imageinfo?.[0];

    if (!imageInfo?.url) {
      return res.json({ ok: false, error: "Could not resolve image URL", fileName });
    }

    // For large images, use a thumbnail URL (800px wide) for faster loading
    const thumbUrl = imageInfo.url.includes("upload.wikimedia.org")
      ? imageInfo.url.replace(/\/commons\//, "/commons/thumb/") + "/800px-" + fileName.replace("File:", "")
      : imageInfo.url;

    console.log(`[ArtView] Fallback image found: ${fileName} → ${thumbUrl}`);

    return res.json({
      ok: true,
      imageUrl: thumbUrl,
      fullUrl: imageInfo.url,
      fileName,
      mime: imageInfo.mime,
      width: imageInfo.width,
      height: imageInfo.height,
      query,
    });
  } catch (err) {
    console.error("[ArtView] Image fallback error:", err);
    return res.status(500).json({ ok: false, error: "Image fallback lookup failed" });
  }
});

// ── Historical Document fallback (reuses same Wikimedia Commons strategy as ArtView) ──
app.post("/api/historical-doc/image-fallback", async (req, res) => {
  try {
    const { docTitle, docAuthor, docYear, imageDescription, docType } = req.body || {};

    // Build a search query from whatever metadata we have
    const parts = [docTitle, docAuthor, docYear, docType].map(s => String(s || "").trim()).filter(Boolean);
    const query = parts.length ? parts.join(" ") : String(imageDescription || "").slice(0, 100);

    if (!query.trim()) {
      return res.status(400).json({ ok: false, error: "No document metadata provided for fallback lookup" });
    }

    // Search Wikimedia Commons for matching images
    const searchUrl = `https://commons.wikimedia.org/w/api.php?` +
      `action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6` +
      `&srlimit=5&format=json&origin=*`;

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);

    const searchRes = await fetch(searchUrl, { signal: ctrl.signal }).finally(() => clearTimeout(timeout));
    if (!searchRes.ok) throw new Error(`Wikimedia search failed: ${searchRes.status}`);

    const searchData = await searchRes.json();
    const results = searchData?.query?.search || [];

    if (!results.length) {
      return res.json({ ok: false, error: "No matching document images found on Wikimedia Commons", query });
    }

    const fileName = results[0].title;
    const imageInfoUrl = `https://commons.wikimedia.org/w/api.php?` +
      `action=query&titles=${encodeURIComponent(fileName)}&prop=imageinfo&iiprop=url|size|mime` +
      `&format=json&origin=*`;

    const ctrl2 = new AbortController();
    const timeout2 = setTimeout(() => ctrl2.abort(), 8000);

    const infoRes = await fetch(imageInfoUrl, { signal: ctrl2.signal }).finally(() => clearTimeout(timeout2));
    if (!infoRes.ok) throw new Error(`Wikimedia imageinfo failed: ${infoRes.status}`);

    const infoData = await infoRes.json();
    const pages = infoData?.query?.pages || {};
    const page = Object.values(pages)[0];
    const imageInfo = page?.imageinfo?.[0];

    if (!imageInfo?.url) {
      return res.json({ ok: false, error: "Could not resolve document image URL", fileName });
    }

    const thumbUrl = imageInfo.url.includes("upload.wikimedia.org")
      ? imageInfo.url.replace(/\/commons\//, "/commons/thumb/") + "/800px-" + fileName.replace("File:", "")
      : imageInfo.url;

    console.log(`[HistoricalDoc] Fallback image found: ${fileName} → ${thumbUrl}`);

    return res.json({
      ok: true,
      imageUrl: thumbUrl,
      fullUrl: imageInfo.url,
      fileName,
      mime: imageInfo.mime,
      width: imageInfo.width,
      height: imageInfo.height,
      query,
    });
  } catch (err) {
    console.error("[HistoricalDoc] Image fallback error:", err);
    return res.status(500).json({ ok: false, error: "Document image fallback lookup failed" });
  }
});

// Grading start

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
              "Could not access that Google Doc. Make sure it's shared as 'Anyone with the link can view' (no sign-in).",
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

let _openaiInstance = null;
function getOpenAIInstance() {
  if (_openaiInstance) return _openaiInstance;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("[index] OPENAI_API_KEY is not set");
  return (_openaiInstance = new OpenAI({ apiKey }));
}
const openai = new Proxy({}, { get: (_, prop) => getOpenAIInstance()[prop] });

function parseDataUrlImage(dataUrl) {
  const s = String(dataUrl || "");
  const m = s.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  const contentType = m[1];
  const b64 = m[2];
  const buf = Buffer.from(b64, "base64");
  return { contentType, buf };
}

function parseRubricOrOverrides(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return {
      fixedOutOf: null,
      pageOutOfMap: null,
      rubricOverrideText: "",
    };
  }

  const s = raw.toLowerCase();

  // 1) page/side overrides
  const pageMatches = [...s.matchAll(/\b(?:page|p|side)\s*(\d+)\s*[:\-]?\s*\/?\s*(\d+)\b/gi)];
  if (pageMatches.length) {
    const pageOutOfMap = {};
    for (const m of pageMatches) {
      const pageNum = Number(m[1]);
      const outOf = Number(m[2]);
      if (Number.isFinite(pageNum) && pageNum > 0 && Number.isFinite(outOf) && outOf > 0) {
        pageOutOfMap[pageNum] = outOf;
      }
    }

    const keys = Object.keys(pageOutOfMap);
    if (keys.length) {
      return {
        fixedOutOf: keys.reduce((sum, k) => sum + pageOutOfMap[k], 0),
        pageOutOfMap,
        rubricOverrideText: "",
      };
    }
  }

  // 2) single total override
  const single =
    raw.match(/^\/?\s*(\d{1,4})\s*$/) ||
    raw.match(/^out of\s+(\d{1,4})$/i) ||
    raw.match(/^mark(?:ed)?\s+out\s+of\s+(\d{1,4})$/i);

  if (single) {
    const n = Number(single[1]);
    if (Number.isFinite(n) && n > 0) {
      return {
        fixedOutOf: n,
        pageOutOfMap: null,
        rubricOverrideText: "",
      };
    }
  }

  // 3) otherwise treat as rubric text
  return {
    fixedOutOf: null,
    pageOutOfMap: null,
    rubricOverrideText: raw,
  };
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
          <p>Ask your child's teacher: <b>"Are we using Curriculate yet?"</b></p>
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
- Grade fairly and proportionally.
- Strong, thorough, mostly accurate work should score better than brief minimal work that happens to avoid mistakes.
- Do not punish a student merely for giving more detail.
- Minor inaccuracies in an otherwise strong answer should reduce marks only modestly.
- Do not "search for deductions"; only deduct for clear, visible issues.
- When marks are lost, explain them clearly and specifically.
`.trim();

  const specs = {
  professional: `
VOICE: Professional
- Tone: neutral, calm, formal-but-friendly.
- Sentence length: medium.
- Style: clear, objective, minimal emotion.
- Marking approach:
  - Evaluate work fairly and consistently.
  - Avoid exaggerated praise or harsh criticism.
- Teacher_comment:
  - Encouraging but measured.
`.trim(),

  warm: `
VOICE: Warm & encouraging (default)
- Tone: positive, supportive, uplifting.
- Sentence length: short-to-medium.
- Style: celebrate wins first; use gentle phrasing for corrections.
- Marking approach:
  - Maintain accuracy in grading while emphasizing encouragement.
- Teacher_comment:
  - Affirm effort + one clear improvement + brief tip.
`.trim(),

  direct: `
VOICE: Direct & concise
- Tone: straightforward, no fluff.
- Sentence length: short.
- Style: prioritize clarity and efficiency.
- Marking approach:
  - Focus on the most important feedback only.
- Teacher_comment:
  - 1–2 short sentences unless absolutely necessary.
`.trim(),

  coach: `
VOICE: Detailed coach
- Tone: supportive, instructional, growth-minded.
- Sentence length: medium.
- Style: guide improvement with clarity and examples.
- Marking approach:
  - Focus on helping the student improve, not just evaluating performance.
  - When possible, include one concrete example or model improvement.
- Teacher_comment:
  - Up to 3 sentences if it adds clarity.
`.trim(),

  gentle_firm: `
VOICE: Gentle but firm
- Tone: caring, steady, clear expectations.
- Sentence length: short-to-medium.
- Style: name what's good; clearly state what must improve.
- Marking approach:
  - Maintain standards; do not inflate marks.
  - Identify the main issue clearly without softening it too much.
- Teacher_comment:
  - Respectful but unmistakably clear.
`.trim(),

  witty_light: `
VOICE: Witty (light)
- Tone: friendly, light humor permitted.
- Sentence length: short-to-medium.
- Style: include 0–1 playful phrase max; never distract from clarity.
- Marking approach:
  - Keep grading accurate and unaffected by tone.
- Teacher_comment:
  - Must remain respectful, helpful, and focused.
`.trim(),

  standards: `
VOICE: Standards-based (rubric language)
- Tone: objective, criteria-aligned.
- Sentence length: medium.
- Style: use assessment language (e.g., "meets", "approaching", "exceeds") naturally.
- Marking approach:
  - Align feedback directly with demonstrated performance.
  - Avoid over-praising if criteria are only partially met.
- Teacher_comment:
  - Reference criteria briefly (clarity, accuracy, completeness) without overdoing it.
`.trim(),

  student_friendly: `
VOICE: Student-friendly (simple wording)
- Tone: clear, encouraging, accessible.
- Sentence length: short.
- Style: avoid advanced vocabulary; make next steps easy to follow.
- Marking approach:
  - Keep expectations clear but understandable.
- Teacher_comment:
  - Write as if the student will read it directly.
`.trim(),

  iep_supportive: `
VOICE: IEP-supportive (high encouragement, gentle marking)
- Tone: very encouraging, affirming, calm, confidence-building.
- Sentence length: short; simple wording.
- Style: spotlight what the student DID successfully first; frame gaps as "next steps."
- Marking approach:
  - Prioritize evidence of understanding over mechanics, spelling, or presentation.
  - Award generous partial credit when correct thinking is shown.
  - If an answer is ambiguous but plausible, lean toward partial credit.
  - Do not deduct for neatness unless it prevents reading.
  - Keep improvements small and achievable (1–2 actions).
- Teacher_comment:
  - 2–3 sentences:
    1) specific success,
    2) one gentle next step,
    3) brief encouragement ("You're getting there—keep going.").
`.trim(),

  journal_response: `
VOICE: Journal Response (reflective, teacher voice)
- Tone: personal, thoughtful, warm, responsive.
- Sentence length: medium.
- Style: respond to the student's ideas as a teacher reading real thoughts, not just scoring work.
- Focus:
  - Prioritize reflection, honesty, insight, and personal connection.
  - Engage directly with what the student is saying.
  - Look for and respond to:
  - a meaningful idea,
  - a personal connection,
  - or a thoughtful insight (even if imperfectly expressed).
- Mechanics:
  - May be mentioned briefly if they affect clarity.
  - Do not treat grammar, spelling, or mechanics as deductions.
- Marking approach:
  - Reward sincerity, depth of thought, and meaningful engagement.
  - Do not reduce marks primarily for writing imperfections.
  - Frame improvements as invitations to expand or think more deeply.
- Teacher_comment:
  - Sound like a real teacher responding personally.
  - Include:
    1) something meaningful the student expressed,
    2) one thoughtful nudge, question, or invitation to deepen,
    3) a brief encouraging close.
  - Use phrasing like "I appreciated...", "I noticed...", "I wondered...", "I'd like to hear more about..."
  - Avoid harsh evaluative language.
`.trim(),

  pudewa_mastery: `
VOICE: Mastery / IEW-style (Andrew Pudewa)
- Philosophy: Mastery-based. Work is either "Accepted" or "Not Finished Yet." The goal is always eventual success, not ranking.
- Tone: warm, cooperative, editor-like. You are a helpful editor, not an authoritarian judge. The student is a writer improving their craft.
- Core principles (apply to ALL subjects, not just writing):
  - ALWAYS find something to affirm first. Name what the student did well — be specific.
  - Never overcorrect. Focus on ONE main area for improvement, not a list of everything wrong.
  - Frame gaps as "not yet" rather than "wrong." Mastery is a process.
  - Help as much as needed. If something is close, guide them to the finish line rather than marking it down.
  - Edit with a smile — corrections should feel like collaboration, not punishment.
- For WRITING tasks (open-text, journal, reading-comp, short-answer with sentences):
  - Evaluate primarily on structure and ideas, not surface mechanics.
  - Spelling, handwriting, and grammar are separate neurological functions — note them gently but do not let them dominate the grade.
  - Recognize structural elements the student used (topic sentence, supporting details, transitions, conclusion) and affirm them.
  - If stylistic techniques are attempted (strong verbs, -ly adverbs, clausal openers, alliteration), notice and celebrate them.
  - Suggest ONE concrete stylistic improvement they could try next time (e.g., "Try opening your next sentence with an -ly adverb" or "What if you added a 'because' clause here?").
- Marking approach:
  - On borderline cases, lean toward the higher mark — effort and attempt matter.
  - Partial credit for partial understanding. Always.
  - Do not deduct heavily for mechanics unless they prevent comprehension.
  - Strong effort with minor issues should score well; brief minimal effort should not score equally.
- Teacher_comment:
  - 2–3 sentences:
    1) Specific, genuine affirmation of what the student did well.
    2) One clear, actionable next step framed as an invitation ("Next time, try...").
    3) Encouraging close that conveys belief in the student's ability ("You're building real skill here.").
  - Sound like a mentor who has read the work carefully and wants the student to succeed.
  - Never say "good job" generically — always tie praise to something visible in the work.
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

    ${rubricOverride ? `
      TEACHER-PROVIDED RUBRIC OVERRIDE:
      ${rubricOverride}

      If this rubric override includes categories, criteria, or denominators, it takes priority over default grading assumptions.
      ` : ""}

    VOICE APPLICATION (required):
    - Apply the selected VOICE to: strengths, improvements, teacher_comment, and every sections[].teacher_comment.
    - Keep structure the same; only change phrasing and tone.
    - Do not add extra fields.
    - Do not add jokes unless VOICE allows light humor (and even then, max 0–1 brief phrase).
    - If VOICE is "iep_supportive": be more generous with partial credit and reduce emphasis on mechanics, while still following denominators/sections and question directions.

    If VOICE is "journal_response":
    - Shift from evaluation to reflective response.
    - Do not emphasize deductions for mechanics unless clarity is seriously affected.
    - Prioritize engagement with the student's ideas over technical correctness.
    - Frame improvements as invitations to deepen thinking, not corrections.
    - Teacher_comment should feel like a personal response to the student's thinking while still giving clear, useful feedback.
    - Keep the response concise (2–4 sentences max); do not turn the feedback into a full paragraph or essay.
    
    FEEDBACK LANGUAGE RULE (grade-band aligned):
    - For 3–5: Use simple, direct language. Short sentences. Avoid abstract vocabulary.
    - For 6–8: Use clear middle-school teacher tone. Practical, specific, not overly academic.
    - For 9–10: Use more precise academic language and clearer reasoning.
    - For 11+: Use mature, concise, academically appropriate phrasing.
    - Strengths, improvements, and teacher_comment must match the selected grade level tone.

    FAIRNESS AND CONSISTENCY RULES (hard):
    - Grade similar quality work similarly.
    - A short answer that is only minimally correct should not automatically tie a fuller, clearer, better-supported answer.
    - If a response is thorough, relevant, and mostly accurate, that should raise the score, not lower it.
    - Minor mistakes inside a strong answer should reduce marks only modestly unless they change the main meaning or result.
    - Do not over-penalize students who attempt more depth.
    - Do not "hunt for faults." Deduct only for clear, visible, instruction-relevant issues.

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
    - Do NOT treat that page as the student's submission.
    - Use it as the authoritative basis for grading the student pages in this submission.
    - For each question/item you grade, compare the student response to the TEACHER KEY's correct answer.
    - If the TEACHER KEY contradicts your general knowledge, the TEACHER KEY wins.
    - Do NOT deduct the student for not matching formatting/layout of the key; only correctness.
    - Never list TEACHER KEY text as "student evidence." Evidence must come from the student page, while correctness comes from the key.
    - If a Teacher Key is present, do NOT create a separate "Teacher Key" section; it is not a student section and must not appear in sections[].

    STEP 2 — DENOMINATOR POLICY (hard)
    Use this priority order exactly.

    PRIORITY 1 — EXPLICIT DENOMINATOR (highest priority)
    If an explicit denominator is visible anywhere in the student pages, teacher key, rubricOverride, rubricText, or teacher-provided override block, you MUST use it.
    Examples:
    - /20
    - out of 25
    - section boxes like Matching /10
    - rubric category totals
    - FIXED DENOMINATOR OVERRIDE supplied by the server

    PRIORITY 2 — COUNTING RESULT
    The server may provide a counting result with:
    - countResult.kind = "itemized" | "written_response" | "unknown"
    - countResult.recommended_out_of = number | null
    - countResult.confidence = 0–1

    If ALL of the following are true:
    - there is NO explicit denominator,
    - countResult.kind = "itemized",
    - countResult.recommended_out_of is a number,
    - countResult.confidence >= 0.75,

    then:
    - overall_out_of MUST equal countResult.recommended_out_of.
    - Treat each scorable item as worth 1 point unless the assignment explicitly assigns different values.
    - Count subparts (a/b/c), T/F lines, blanks, and matching prompts as separate scorable items.

    PRIORITY 3 — WRITTEN RESPONSE OR UNCERTAIN COUNT
    If there is NO explicit denominator, and either:
    - countResult.kind = "written_response", or
    - countResult.kind = "unknown", or
    - countResult.recommended_out_of is null, or
    - countResult.confidence < 0.75,

    then:
    - overall_out_of MUST be 10.
    - Grade holistically using /10.

    IMPORTANT GUARDRAILS
    - Topic headings are never denominators.
    - Do not invent denominators.
    - If a reliable item count is not available, default to /10.

    STEP 3 — GRADE CONTENT (primary):
    Grade for: completeness, accuracy/understanding, clarity, effort, thoroughness appropriate to the grade level.
    All feedback must cite visible evidence from the student work (e.g., "In question 2…", "Your chart…").
    Do NOT invent issues.
    
    QUESTION-DIRECTIONS MARKING (mandatory):
    If a question includes marking directions (e.g., "1 mark for a closing sentence", "2 marks for evidence", "include 3 reasons", "label all parts", "show your work", "units required"),
    you MUST grade exactly according to those directions.

    Rules:
    - Treat stated marks/criteria inside the question as the marking scheme for that question.
    - If a required element is missing, reduce the score by the amount indicated (e.g., missing closing sentence = –1 mark).
    - If the directions specify multiple components, allocate marks component-by-component.
    - If the question gives a total but no explicit component breakdown, infer a fair split based on the directions (e.g., 3 required reasons = roughly 1 mark each).
    - Do not "make up" extra requirements beyond what the directions ask.

    Score calibration (content-only base score out of 10) — ONLY used when overall_out_of is 10:
    9–10: excellent understanding, accurate, thoughtful connections, strong organization for the format (minor mechanics do not prevent a 9–10)
    A 9.5–10 is allowed even if there are minor issues, as long as understanding is clearly strong and the work meets/exceeds expectations.
    8–8.5: very good with minor clarity/mechanics gaps
    7–7.5: adequate with noticeable gaps or weak explanations
    <7: incomplete, unclear, or inaccurate
    If the work shows strong understanding + accurate details + organized response for the format, the base score should not be below 8.

    For written_response graded out of 10:
    10: exceeds expectations; thorough + accurate; minor wording issues ok
    9–9.5: very strong; one small inaccuracy or minor clarity issue
    8–8.5: solid; some gaps, missing depth, or a couple notable inaccuracies
    ≤7.5: thin, unclear, or several inaccuracies

    COMPONENT-BASED QUESTION TOTAL (critical):
    If a single question specifies component marks (e.g., "1 mark for introduction, 4 marks for support, 1 mark for closing"),
    you MUST:

    1) Sum those components to determine the total for that question (e.g., 1+4+1 = 6).
    2) Allocate marks strictly by component (intro, support, closing, etc.).
    3) If any component is missing, deduct exactly that component's value.
    4) Treat that summed total as the denominator for that question.
    5) Ensure section totals include the full component-based total for that question.

    You may NOT:
    - collapse component marks into a vague overall score,
    - invent a different denominator,
    - or ignore a stated component breakdown.

    TEST/QUIZ RULE (mandatory):
    If the submission is clearly a test or quiz, especially if it shows:
    - named parts/sections,
    - printed section totals,
    - score boxes,
    - or numbered questions grouped into visible parts,

    then response_format_detected MUST be "test".

    For test/quiz submissions:
    - You MUST return results by section, not only broad holistic feedback.
    - sections[] MUST be non-empty when visible sections or visible part totals exist.
    - Create one sections[] entry for each visible section or part.
    - Each section must include:
      - name
      - score
      - out_of
      - teacher_comment
      - incorrect_items (array or null)
    - Section out_of must match the printed section total, or the true visible total of the questions in that section if the section total is clearly implied by the questions.
    - overall_out_of MUST equal the sum of section out_of values.
    - overall_score MUST equal the sum of section scores.
    - Do NOT collapse a clearly sectioned test into one generic overall comment.

    SECTION COMMENT RULE:
    - Each section teacher_comment must briefly explain:
      1) what was done well in that section, and
      2) what cost marks in that section.
    - If full marks were earned, say what was done well and set incorrect_items to null.
    - If marks were lost, the section comment must make that understandable in plain language.

    INCORRECT_ITEMS RULE:
    - Use incorrect_items wherever individual missed items can reasonably be identified.
    - Keep prompts short.
    - Include student_answer and correct_answer for each incorrect item.
    - If all items are correct, return incorrect_items: null.
    - Never include an item where student_answer and correct_answer are equivalent after normalization.

    For multiple choice and true/false:
    - Read the student mark carefully.
    - If the mark is ambiguous, say it is unclear.
    - Do NOT assume a choice.
    - Only report an answer as incorrect if the student's selected answer clearly differs from the correct answer.
    - If student answer equals correct answer, do NOT list it as incorrect.

    TRUE/FALSE EXTRACTION RULE:
    - True/False questions appear as a question number followed by T and F.
    - Record exactly which letter is circled: "T" or "F".
    - Do not infer from context.
    - If you cannot clearly see which letter is circled, return "unclear" for that item.
    - Never swap T and F.
    - Only count a letter as chosen if it is clearly circled.

    INCORRECT ITEM GUARDRAIL (hard rule):
    - Before adding an item to incorrect_items, normalize both answers and compare again.
    - Normalization includes:
      - trim spaces
      - case-insensitive compare
      - treat equivalent numeric forms as equal (e.g., "-8" == "-8.0", "8/1" == "8")
      - ignore thousands separators and extra spaces (e.g., "1,000" == "1000")
    - If normalized answers match, the item MUST NOT appear in incorrect_items.
    - If the only difference is formatting, do NOT mark incorrect.
    - Do not use deductions to re-penalize wrong answers already reflected in section scores.

    MATH RULE:
    - If a numeric answer is correct but a required unit is missing, deduct 0.5 from that question.
    - Reflect this in the section score.
    - Do NOT treat this as a formatting deduction.

    SECTION REPORTING RULE:
    - If the test provides named sections with out_of values, you MUST:
      1) create one sections[] entry per named section,
      2) use the printed out_of for each section,
      3) score that section based only on the questions belonging to that section,
      4) set overall_out_of = sum of section out_of,
      5) set overall_score = sum of section scores.
    - If the test does NOT provide printed section totals, you must still create sections[] if the test is clearly divided, but only use denominators that are explicitly visible or clearly implied by the grouped questions.
    - Do NOT revert to /10 if section out_of values are visible anywhere.
    - Do NOT repeat the same generic comment across multiple sections.
    - Each section comment must reference that section's actual content.

    IMPORTANT:
    - If implied section denominators are determined from clearly grouped numbered questions, you MUST NOT set overall_out_of to 10.
    - Visible or clearly implied test denominators override holistic /10 grading.

    RUBRIC OVERRIDE RULE:
    If a rubric override is provided and it specifies categories and point values:
    - Create sections[] that match the rubric categories and totals.
    - Use the rubric's totals for out_of values.
    - Set overall_out_of to the rubric total (sum of section out_of, or stated total).
    - Set overall_score to the sum of section scores.
    - If the rubric conflicts with defaults, rubric wins.
    - For rubric-based sections, do NOT include incorrect_items; instead, cite specific evidence in teacher_comment for each section.
    - Never interpret unchecked boxes on a rubric sheet as missing work.
    - If rubricDetected=true, you MUST align feedback to rubricText criteria, even if rubricText has no numbers.
    
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

    IMPLICIT SECTION RULE (worksheet style, mandatory when applicable):
    Some worksheets do not label sections or provide section score boxes, but are clearly split by page/side.

    If ALL of the following are true:
    1) response_format_detected is "test" OR the work is clearly numbered questions (not a paragraph assignment),
    2) there are NO printed section names or section out_of totals anywhere,
    3) the submission clearly contains two distinct sides/pages where each side has its own question numbering block,

    Then you MUST treat each side/page as a section using IMPLIED denominators:

    - Section A (Side/Page 1): out_of = number of questions on that side/page
    - Section B (Side/Page 2): out_of = number of questions on that side/page

    Overall denominator rule:
    - overall_out_of MUST equal the sum of implied section out_of values.

    SECTION NAMING:
    - If no printed names exist, name sections exactly:
      - "Side 1" and "Side 2" (or "Page 1" and "Page 2" if it is clearly separate pages)

    If there are more than 2 pages/sides, you MAY create one section per page ONLY if each page is clearly its own block of numbered questions.
    Otherwise, group into the smallest number of obvious blocks.

    INCORRECT_ITEMS:
    - Use incorrect_items normally for test-style sections, but NEVER include an item where student_answer equals correct_answer.

    INCORRECT_ITEMS FIELD HYGIENE (mandatory):
    - student_answer and correct_answer must be short, clean answer strings only.
    - Do NOT include "or …", parentheses alternatives, or commentary like "unclear …" inside correct_answer.
    - Put uncertainty/explanations in teacher_comment, not inside correct_answer.
    
    Important fairness rule:
    - Do not "search for deductions." If the work is strong/excellent, the score must reflect that even if minor issues exist.

    THOROUGHNESS FAIRNESS RULE (hard):
    - If a student provides more depth than required (extra relevant details, explanations, examples) and is mostly accurate, that must help the score, not hurt it.
    - A short answer that is technically correct but thin should not automatically receive the same mark as a richer and more thoughtful answer.
    - Minor inaccuracies inside an otherwise strong, thorough answer should reduce marks only slightly unless they change the main conclusion, method, or meaning.
    - Do not treat "more writing" as "more chances to lose marks."
    - Reward genuine understanding, completeness, and strong effort.

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

    - Do not "search for deductions." Only deduct when there is a clear, visible issue.
    - If you deduct points, you MUST enumerate the issues specifically (no vague phrases like "minor errors").
    - Every deduction reason must cite concrete visible evidence (e.g., "Q4…", "In your paragraph about…", "In the chart…").
        
    DEDUCTION CLARITY RULE:
    - Every deduction must be understandable to a student reading the feedback.
    - Avoid vague phrases such as "minor errors", "some mistakes", or "lost clarity" unless immediately explained.
    - Whenever possible, tie a deduction to:
      1) a question number,
      2) a visible section,
      3) a specific missing required element,
      or 4) a rubric criterion.
    - If an answer is partially correct, say what was correct before stating what was missing or incorrect.

    Spelling/mechanics:

    Spelling fairness rule (always):
    - Do NOT deduct for US vs Commonwealth spelling differences (e.g., color/colour, center/centre, organize/organise, behavior/behaviour, defense/defence, traveled/travelled).
    - These are considered correct variations.
    - Only count an item as a spelling error if it is incorrect in BOTH major conventions.
    - Do NOT deduct for proper nouns unless clearly incorrect.

    IMAGE-BASED SPELLING RULE (hard):
    - ONLY deduct for spelling/mechanics if you can clearly READ the exact wrong word on the student page.
    - You MUST include:
      1) the exact wrong → correct pair copied from the student work, AND
      2) the location (e.g., "in Q3 sentence 2").
    - If you are not sure you read the word correctly (handwriting / blur / angle), do NOT deduct and do NOT list examples.
    - Do not guess at intended words.

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

    If VOICE is "journal_response":
    - Do NOT deduct for spelling, punctuation, or grammar unless errors significantly interfere with meaning.
    - Minor errors should be ignored for scoring purposes.
    - If clarity is affected, include at most ONE small deduction item.

    Otherwise:
    - If grammar errors meaningfully reduce clarity, include ONE deduction item describing the pattern (e.g., "sentence fragments", "run-ons").

    Tests/quizzes:
    - Wrong answers are reflected in section scores.
    - Do NOT also add "wrong answers" as separate deduction items unless there is a separate rubric rule.

    IMPORTANT:
    - Formatting deduction is separate from spelling/mechanics.
    - Total deductions must match the sum of deduction items.

    IMPROVEMENTS RULE (critical):
    Only suggest improvements that are demonstrably missing or weak in the student work shown.
    If an item is already present (labels, spacing, etc.), do not suggest it.

    HANDWRITING RULE:
    - If neat and legible: do not mention handwriting (unless praising notably neat/consistent presentation).
    - Only comment if readability is clearly impacted.

    ACADEMIC INTEGRITY (grade-calibrated, evidence-based):
      Default:
      ai_suspected_cheating = null
      copying_suspected = null

      You are grading a student at the given grade level. Use that grade band to calibrate your expectations for vocabulary, sentence structure, and reasoning sophistication.

      GRADE-LEVEL VOCABULARY BASELINE:
      - Grades 3-5: simple everyday words; "because," "also," "important." Suspect words: "furthermore," "consequently," "juxtaposition," "paradigm," "notwithstanding," "facilitate," "utilize," "comprehensive," "multifaceted."
      - Grades 6-8: transitional academic words emerging; "however," "significant," "evidence." Suspect words: "nevertheless," "epitomize," "dichotomy," "nuanced," "inherently," "synthesize," "encapsulate," "underscore."
      - Grades 9-10: stronger academic register expected. Suspect words: "hegemony," "paradigmatic," "dialectical," "ontological," "epistemological," rare SAT-level words used fluently throughout.
      - Grades 11-12: advanced academic writing expected; only flag if vocabulary is at graduate/professional level AND used with unusual density.

      A single advanced word is not suspicious. Flag when MULTIPLE words (3+) are clearly above the grade band's typical usage AND are used fluently (not as if the student looked up one word).

      GRADE-LEVEL STRUCTURE/REASONING BASELINE:
      - Grades 3-5: simple claim + reason; lists; basic cause-effect. Suspect: nested counterarguments, hedging language ("while it could be argued"), multi-paragraph thesis-evidence-analysis structure.
      - Grades 6-8: paragraph structure emerging; basic evidence use. Suspect: sophisticated rhetorical framing, seamless integration of multiple sources, nuanced "on one hand / on the other hand" balanced analysis, academic conclusion that synthesizes rather than summarizes.
      - Grades 9-10: structured arguments expected. Suspect: graduate-level analytical frameworks, discipline-specific methodological language, professional-quality prose flow with no rough edges.
      - Grades 11-12: strong analytical writing expected; only flag if reasoning resembles published academic work or professional analysis.

      PUNCTUATION & SENTENCE COMPLEXITY (strong AI signal):
      AI-generated text often uses punctuation and sentence patterns that students rarely produce:
      - Semicolons joining independent clauses (students almost never use semicolons correctly before grade 10)
      - Em-dashes for parenthetical asides — like this — (rare in authentic student writing below grade 11)
      - Colons introducing lists or elaborations within sentences
      - Complex compound-complex sentences with multiple subordinate clauses, all perfectly punctuated
      - Consistently varied sentence openings (participial phrases, adverbial clauses, inversions) across the entire response
      - Smooth parallel structure in lists (AI loves balanced tricolons: "X, Y, and Z")
      For grades 3-8, any consistent use of semicolons or em-dashes is a strong signal.
      For grades 9-10, occasional use is normal; flag when it appears throughout the response with perfect execution.
      For grades 11-12, flag only when punctuation sophistication is unnaturally uniform and flawless.

      TRIGGER CATEGORIES (need at least TWO from any category to flag):

      Category A — Grade-Level Mismatch:
      - 3+ vocabulary words clearly above the grade band's typical usage, used fluently
      - Sentence/argument structure significantly above developmental expectations for the grade
      - Reasoning sophistication (hedging, counterarguments, synthesis) far beyond grade norms
      - Suspicious uniformity of polish — every sentence is equally polished with no rough edges, no signs of a student drafting and thinking
      - Punctuation above grade level: semicolons, em-dashes, colons used correctly and consistently (see PUNCTUATION & SENTENCE COMPLEXITY section above)
      - Unnaturally perfect sentence variety: every sentence uses a different opening pattern with no repetition or awkwardness

      Category B — Direct AI Artifacts:
      - Phrases such as "As an AI language model…" or statements about being an AI
      - Meta-output structure not written for the assignment (e.g., "Here are 5 key points:")
      - Hyperlinks, "Sources:" lists, or citations not requested
      - Clearly pasted definition blocks that exceed the task scope

      Category C — Copy/Paste Markers:
      - Large blocks of generic textbook-style language
      - Definition-style wording that does not directly respond to the question
      - Substantial shift in tone/vocabulary/sophistication within the same submission
      - Formal academic phrasing inconsistent with the rest of the submission
      - Multiple distinct voice shifts suggesting material pulled from different sources

      TWO-TRIGGER REQUIREMENT (mandatory):
      - To set ai_suspected_cheating OR copying_suspected, you must identify at least TWO independent triggers from the categories above.
      - Two triggers can come from the same category (e.g., two Category A triggers: advanced vocab + advanced structure).
      - A single trigger alone is NEVER sufficient — even a Category B artifact alone could be a coincidence.
      - If you cannot identify 2 triggers, both fields MUST be null.

      FIELD SELECTION RULE:
      ai_suspected_cheating — use when triggers suggest AI-generated content (Category A + B combination is strongest, but A + A is valid when the mismatch is stark).
      copying_suspected — use when triggers suggest copying from a human source (Category C triggers, or Category A + C).
      Do NOT set both fields unless there are clearly separate visible reasons for each.

      FAIRNESS GUARDRAILS:
      - Some students genuinely write above grade level. A gifted student will show consistent voice and occasional rough edges. AI text tends to be uniformly polished with no personality.
      - ESL students may use unusual vocabulary from translation; do not flag this.
      - If the student's answer directly addresses the specific prompt with personal examples or task-specific details, weight this AGAINST suspicion (AI tends to be generic).
      - Never claim certainty. Never assign intent. Never accuse.

      EVIDENCE REQUIREMENT (mandatory if flagging):
      If either field is set, you MUST:
      - Quote or describe 2+ specific visible phrases or patterns
      - Identify their location (e.g., "In paragraph 2…", "In Question 4…")
      - Explain why each is above grade-level expectations
      - Use neutral phrasing: "This may indicate…" / "This could suggest…"

      Example (grade 6 student):
      "Possible AI-assisted work: The response uses 'furthermore,' 'multifaceted,' 'synthesize,' and 'encapsulate' — vocabulary significantly above typical grade 6 usage. Additionally, the argument follows a claim-evidence-counterargument-rebuttal structure more typical of high school analytical writing."

      FINAL RULE:
      If evidence does not meet the two-trigger threshold:
      ai_suspected_cheating = null
      copying_suspected = null

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
    - teacher_comment:
      - Default: 2–3 sentences:
        1) specific praise,
        2) one clear improvement,
        3) optional brief tip.
      - If VOICE is "journal_response":
        - Write as a personal response to the student's ideas.
        - Include:
          1) something specific the student expressed,
          2) one thoughtful question or nudge,
          3) a brief encouraging close.
        - Do NOT frame as "improvement" or "correction."

    TEST OUTPUT CLARITY REQUIREMENT:
    - For a visible test/quiz, the response must make the score understandable by section.
    - If marks are lost, the combination of sections[].teacher_comment, incorrect_items, and deductions must make clear why.
    - Do not return only generalized strengths/improvements for a clearly sectioned test.

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
    - Do NOT mention the words "evidence", "JSON", or "schema".
    - Do NOT quote student answers; summarize patterns only.
    - Return exactly ONE paragraph with no extra commentary.

    Respond with the paragraph text only.
      `.trim();
    }
  
  // ===== grading helpers =====

  function canonicalizeAnswer(raw, { isCorrectAnswer = false } = {}) {
    if (raw == null) return "";
    let s = String(raw).trim().toLowerCase();

    // 1) If correct_answer contains commentary like "— unclear ...", drop it
    if (isCorrectAnswer) {
      s = s.split("—")[0].trim();        // em dash
      s = s.split("--")[0].trim();       // double hyphen
    }

    // 2) If correct_answer contains alternatives, keep only the first
    if (isCorrectAnswer) {
      // Handles: "x (or y)" OR "x or y"
      s = s.split(/\(\s*or\s+/i)[0].trim();
      s = s.split(/\s+or\s+/i)[0].trim();
    }

    // 3) Remove commas in numbers (1,000 -> 1000)
    s = s.replace(/,/g, "");

    // 4) Remove outer parentheses repeatedly: "(16d+20)" -> "16d+20"
    while (s.startsWith("(") && s.endsWith(")")) {
      s = s.slice(1, -1).trim();
    }

    // 5) If it looks mathy, normalize aggressively
    const looksMathy = /[a-z0-9]/i.test(s) && /[+\-*/^=()]/.test(s);
    if (looksMathy) {
      s = s.replace(/\s+/g, "");     // remove all spaces
      s = s.replace(/\+\-/g, "-");   // "+-" -> "-"
      s = s.replace(/\-\-/g, "+");   // "--" -> "+"
    } else {
      // otherwise just collapse whitespace
      s = s.replace(/\s+/g, " ");
    }

    // 6) Pure numeric normalization (still keep your nice -0 handling)
    if (/^[+-]?\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      return Object.is(n, -0) ? "0" : String(n);
    }

    return s;
  }

  function scrubIncorrectItems(result) {
    if (!result?.sections || !Array.isArray(result.sections)) return result;

    for (const sec of result.sections) {
      if (!sec || !Array.isArray(sec.incorrect_items)) continue;

      sec.incorrect_items = sec.incorrect_items.filter((it) => {
        const a = canonicalizeAnswer(it?.student_answer, { isCorrectAnswer: false });
        const b = canonicalizeAnswer(it?.correct_answer, { isCorrectAnswer: true });
        return a !== b;
      });

      if (sec.incorrect_items.length === 0) sec.incorrect_items = null;
    }

    return result;
  }

  function recomputeOverallFromSections(g) {
    if (!g || typeof g !== "object") return g;
    if (!Array.isArray(g.sections) || g.sections.length === 0) return g;

    const sumOutOf = g.sections.reduce((acc, s) => {
      const o = Number(s?.out_of);
      return acc + (Number.isFinite(o) ? o : 0);
    }, 0);

    const sumScore = g.sections.reduce((acc, s) => {
      const sc = Number(s?.score);
      return acc + (Number.isFinite(sc) ? sc : 0);
    }, 0);

    // Only apply if it yields a sane denominator
    if (sumOutOf > 0) {
      g.overall_out_of = sumOutOf;
      g.overall_score = Math.max(0, Math.min(sumOutOf, sumScore));
    }

    return g;
  }

  function safeJsonParse(text) {
    if (text == null) return null;

    // If it's already an object, return it
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

    const extractObjectBlock = (str) => {
      const start = str.indexOf("{");
      const end = str.lastIndexOf("}");
      if (start >= 0 && end > start) return str.slice(start, end + 1);
      return null;
    };

    // 1) direct
    const direct = tryParse(s);
    if (direct) return direct;

    // 2) if it's a quoted JSON string (double-encoded), decode once then parse again
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

    // Try "largest {...} block"
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

  app.post("/grading", async (req, res) => {
    console.log("GRADING BODY keys:", Object.keys(req.body || {}));
    console.log("images?", Array.isArray(req.body?.images) ? req.body.images.length : 0);
    console.log("workInput len:", String(req.body?.workInput || "").length);
    
    try {
      const startTime = Date.now();

      const { images, workInput, rubricOverride, gradeBand } = req.body || {};

      // ------------------------------------------------
      // Parse teacher-provided rubric / denominator overrides
      // ------------------------------------------------
      const parsedOverride = parseRubricOrOverrides(rubricOverride);

      const overrideFixedOutOf = parsedOverride.fixedOutOf;   // teacher override like "/35"
      const pageOutOfMap = parsedOverride.pageOutOfMap;       // optional page overrides
      const effectiveRubricOverride = parsedOverride.rubricOverrideText;

      // ------------------------------------------------
      // Request metadata
      // ------------------------------------------------
      const ip =
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        null;

      const userAgent = req.headers["user-agent"] || null;

      const meta = req.body?.meta || {};
      const sessionId = meta.sessionId || null;
      const refCode = meta.refCode || null;

      // ------------------------------------------------
      // Input normalization
      // ------------------------------------------------
      const trimmed = String(workInput || "").trim();
      const looksLikeUrl = /^https?:\/\/\S+$/i.test(trimmed);

      const assignmentLinks = [];
      let submittedTextEvidence = null;

      const hasImages = Array.isArray(images) && images.length > 0;
      const hasWorkInput = trimmed.length > 0;

      // ------------------------------------------------
      // Paste mode handling
      // ------------------------------------------------
      if (!hasImages && hasWorkInput) {
        if (looksLikeUrl) {
          assignmentLinks.push({
            kind: "source",
            label: "Submitted link",
            url: trimmed,
          });
        } else {
          submittedTextEvidence = trimmed.slice(0, 12000);

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

      // ------------------------------------------------
      // Grade band normalization
      // ------------------------------------------------
      const band =
        ["3-5", "6-8", "9-10", "11+"].includes(gradeBand)
          ? gradeBand
          : "6-8";

      const submissionId = crypto.randomUUID();

      // ------------------------------------------------
      // Denominator override blocks (used in prompt)
      // NOTE: these blocks only describe the override.
      // Actual enforcement happens later.
      // ------------------------------------------------
      const fixedDenomBlock = overrideFixedOutOf
        ? `
    FIXED DENOMINATOR OVERRIDE (teacher provided):
    - overall_out_of MUST equal ${overrideFixedOutOf}.
    - Do not invent a different denominator.
    ${pageOutOfMap
      ? "- If page totals are provided below and the pages align clearly, use them as section/page denominators."
      : ""}
    `.trim()
        : "";

      const pageDenomBlock = pageOutOfMap
        ? `
    PAGE DENOMINATOR OVERRIDE (teacher provided):
    ${Object.entries(pageOutOfMap)
      .map(([page, outOf]) => `- Page ${page}: /${outOf}`)
      .join("\n")}

    Use these page totals exactly if the submission pages align clearly.
    `.trim()
        : "";

      // ------------------------------------------------
      // JSON schema for grading model output
      // ------------------------------------------------
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

          // --- Main score ---
          overall_score: { type: "number", minimum: 0 },
          overall_out_of: { type: "number", minimum: 1 },

          // --- /10 compatibility ---
          score_out_of_10: { type: ["number", "null"], minimum: 0, maximum: 10 },
          final_score_out_of_10: { type: ["number", "null"], minimum: 0, maximum: 10 },

          // --- deductions ---
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

          // --- sections ---
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

          // --- student name detection ---
          student_name: { type: ["string", "null"] },

          // --- integrity flags ---
          ai_suspected_cheating: { type: ["string", "null"] },
          copying_suspected: { type: ["string", "null"] },

          rubricText: { type: ["string", "null"], maxLength: 2200 },
          rubricDetected: { type: "boolean" },
          rubricConfidence: { type: "number", minimum: 0, maximum: 1 },

          // --- feedback ---
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

      const instructions = buildRubricInstructions({
        gradeBand: band,
        rubricOverride: effectiveRubricOverride,
        feedbackVoice,
        feedbackVoiceMode,
      });

      const instructionsWithInference = `
        ${instructions}

        INFERENCE (required):
        - inferred_subject: one of [Math, English, History, Geography, Science, Bible, Other]
        - inferred_assessment_type: one of [Essay, Test, Quiz, Homework, Project, Poster, Worksheet, Other]
        - inferred_grade_level: one of [3-5, 6-8, 9-10, 11+, Unknown]

        Rules:
        - Do NOT guess wildly. If unsure, use Other / Unknown.
        - inferred_grade_level should usually match the provided grade band (${band}) unless the work clearly indicates otherwise.

        RUBRIC DETECTION (very important):
        You must determine whether any image contains a TEACHER GRADING RUBRIC TEMPLATE.

        If a teacher rubric template is clearly present:
        - Extract only the rubric criteria and scoring structure.
        - Do NOT include student writing.
        - Summarize it as concise bullet points (max 12 lines).
        - Preserve point values and levels if visible.
        - Set rubricDetected = true.
        - Set rubricConfidence between 0 and 1.

        If no teacher rubric template is present:
        - rubricText = null
        - rubricDetected = false
        - rubricConfidence = 0
        `.trim();

      const countSchema = {
        type: "object",
        additionalProperties: false,
        properties: {
          total_out_of: { type: ["number", "null"] },
          kind: {
            type: "string",
            enum: ["itemized", "written_response", "unknown"],
          },
          recommended_out_of: { type: ["number", "null"] },
          per_page: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                page_index: { type: "number" },
                out_of: { type: ["number", "null"] },
                evidence: { type: "string" },
              },
              required: ["page_index", "out_of", "evidence"],
            },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["total_out_of", "kind", "recommended_out_of", "per_page", "confidence"],
      };

      let countedOutOf = null;
      let countedOutOfConfidence = 0;
      let countResult = null;

      if (hasImages) {
        const countingContent = [
          { type: "input_text", text: buildCountingInstructions() },
          ...images.map((img) => ({ type: "input_image", image_url: img })),
        ];

        const countResp = await openai.responses.create({
          model: process.env.AI_MODEL || "gpt-4.1-mini",
          input: [{ role: "user", content: countingContent }],
          text: { format: { type: "json_schema", name: "count_result", strict: true, schema: countSchema } },
          max_output_tokens: 350,
        });

        countResult = safeJsonParse(countResp.output_text);

        if (countResult && Number.isFinite(countResult.confidence)) {
          countedOutOfConfidence = countResult.confidence;

          if (
            Number.isFinite(countResult.recommended_out_of) &&
            countResult.recommended_out_of > 0 &&
            countedOutOfConfidence >= 0.75
          ) {
            countedOutOf = countResult.recommended_out_of;
          }
          }
        }

      const countResultBlock = countResult
          ? `
        COUNT RESULT (server computed):
        - kind: ${countResult.kind}
        - recommended_out_of: ${countResult.recommended_out_of ?? "null"}
        - confidence: ${countResult.confidence ?? 0}

        You MUST follow STEP 2 exactly using this countResult.
        Do not recalculate or override these values unless an explicit denominator is visible.
        `.trim()
          : "";

      function buildCountingInstructions() {
        return `
      You are analyzing photos to HELP the grader determine a denominator when none is printed.
      Your job is NOT to choose the final denominator; your job is to return:
      1) kind classification,
      2) scorable-item counts (if itemized),
      3) confidence and brief evidence.

      STEP 1 — CLASSIFY KIND (required):
      Choose ONE:
      - kind = "itemized" if the work has many short scorable items (T/F lines, blanks, matching, one-line answers), often with a/b/c subparts.
      - kind = "written_response" if the work is a few longer answers (sentences/paragraphs), even if numbered (e.g., 1–4).
      - kind = "unknown" if you cannot tell.

      STEP 2 — COUNT SCORABLE ITEMS (ONLY if kind="itemized"):
      Count scorable items, not headings.
      Rules:
      - Do NOT guess.
      - Count each numbered question as 1 item.
      - Count each subpart (a/b/c) as 1 item each unless the sheet assigns different point values.
      - Count each distinct blank as 1 item.
      - Count each T/F line as 1 item.
      - Matching: count the prompts being matched as items.
      - If a page is cut off or unclear, set that page out_of = null.

      MULTI-PAGE:
      Return per_page entries with:
      - page_index (0-based)
      - out_of (number or null)
      - evidence (very short, e.g., "saw Q1–20 plus Q21a–c" or "counted 12 T/F lines")

      TOTALS:
      - If kind="itemized": total_out_of = sum of per_page out_of where visible; if any major page is unclear, you may set total_out_of=null.
      - If kind!="itemized": total_out_of must be null.

      CONFIDENCE (required):
      - 0.85–1.0 only if the count is very clear across all needed pages.
      - 0.6–0.8 if mostly clear but minor uncertainty.
      - <=0.5 if any meaningful guessing would be required.

      Return JSON only.
        `.trim();
      }

      const denomOverrideBlock = [fixedDenomBlock, pageDenomBlock]
  .filter(Boolean)
  .join("\n\n");

      const instructionsWithInferenceFinal = `
        ${instructionsWithInference}
        ${denomOverrideBlock ? `\n\n${denomOverrideBlock}` : ""}
        ${countResultBlock ? `\n\n${countResultBlock}` : ""}
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

      const userContent = [{ type: "input_text", text: instructionsWithInferenceFinal }];
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
        model: process.env.AI_MODEL || "gpt-4.1-mini",
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
              overrideInputUsed: Boolean(String(rubricOverride || "").trim()),
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

      // Remove bogus incorrect_items where student_answer == correct_answer (after normalization)
      scrubIncorrectItems(grade);
      recomputeOverallFromSections(grade);

      let enforced = enforceDenominatorRules(grade);

      const hasTeacherOverride =
        Number.isFinite(overrideFixedOutOf) && overrideFixedOutOf > 0;

      const hasTrustedCountedOutOf =
        Number.isFinite(countedOutOf) && countedOutOf > 0;

      const finalFixedOutOf = hasTeacherOverride
        ? overrideFixedOutOf
        : (hasTrustedCountedOutOf ? countedOutOf : null);

      if (finalFixedOutOf) {
        enforced.overall_out_of = finalFixedOutOf;
        enforced.overall_score = clampNum(enforced.overall_score, 0, finalFixedOutOf) ?? 0;
        enforced.score_out_of_10 = null;
        enforced.final_score_out_of_10 = null;

      } else {
        // No teacher override and no trusted counted denominator.
        // Keep explicit denominators returned by the model if they appear legitimate.
        const outOf = Number(enforced.overall_out_of);

        if (!Number.isFinite(outOf) || outOf <= 0) {
          const ded = totalDeductionPoints(enforced.deductions);
          const base10 = Number.isFinite(Number(enforced.score_out_of_10))
            ? Math.max(0, Math.min(10, Number(enforced.score_out_of_10)))
            : Math.max(0, Math.min(10, Number(enforced.overall_score) || 0));
          const final10 = Math.max(0, Math.min(10, base10 - ded));

          enforced.overall_out_of = 10;
          enforced.score_out_of_10 = base10;
          enforced.final_score_out_of_10 = final10;
          enforced.overall_score = final10;

          if (!Array.isArray(enforced.sections) || enforced.sections.length === 0) {
            enforced.sections = null;
          }
        } else if (outOf === 10) {
          const ded = totalDeductionPoints(enforced.deductions);
          const base10 = Number.isFinite(Number(enforced.score_out_of_10))
            ? Math.max(0, Math.min(10, Number(enforced.score_out_of_10)))
            : Math.max(0, Math.min(10, Number(enforced.overall_score) || 0));
          const final10 = Math.max(0, Math.min(10, base10 - ded));

          enforced.score_out_of_10 = base10;
          enforced.final_score_out_of_10 = final10;
          enforced.overall_score = final10;
        } else {
          // Keep non-10 denominator because it may be an explicit visible denominator.
          enforced.score_out_of_10 = null;
          enforced.final_score_out_of_10 = null;
          enforced.overall_score = clampNum(enforced.overall_score, 0, outOf) ?? 0;
        }
      }

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
            overrideInputUsed: Boolean(String(rubricOverride || "").trim()),
            responseTimeMs,

            refCode,
            userAgent,
          });
        } catch (e) {
          console.error("GradingUsage log failed:", e?.message || e);
        }
      })();

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

      const summaryBase = buildSessionSummaryInstructions({ feedbackVoice });

      const instructions = `
        ${summaryBase}

        GRADE BAND: ${band}

        VOICE MODE:
        - feedbackVoiceMode: ${feedbackVoiceMode}

        rubricOverride (optional context only):
        ${(rubricOverride || "").trim() || "(none)"}

        evidence (JSON):
        ${JSON.stringify(evidence).slice(0, 180000)}
        `.trim();

      const response = await openai.responses.create({
        model: process.env.AI_MODEL || "gpt-4.1-mini",
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

  // Grading end 

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
    res.status(500).json({ error: "Failed to load task sets" });
  }
});

// ------------------------------
// Task type timing stats — used by AI generator + taskset listing
// Returns per-task-type avg completion times (teacher-specific when available, global fallback)
// ------------------------------
import { getTimingStatsForGenerator } from "./services/taskTypeTimingAggregator.js";

app.get("/api/task-type-timing-stats", async (req, res) => {
  try {
    const ownerId = req.query.ownerId || null;
    const stats = await getTimingStatsForGenerator(ownerId);
    res.json({ ok: true, stats });
  } catch (err) {
    console.error("GET /api/task-type-timing-stats error:", err);
    res.status(500).json({ ok: false, error: "Failed to load timing stats" });
  }
});

// Also add avgCompletionMinutes to taskset listing
// (computed from the stats of the task types in each set)
app.get("/api/tasksets-with-timing", async (req, res) => {
  try {
    const ownerId = req.query.ownerId || null;
    const [sets, stats] = await Promise.all([
      TaskSet.find().sort({ createdAt: -1 }).lean(),
      getTimingStatsForGenerator(ownerId),
    ]);

    const enriched = sets.map((ts) => {
      const tasks = ts.tasks || [];
      let totalAvgMs = 0;
      let tasksWithStats = 0;
      for (const t of tasks) {
        const taskType = t?.taskType || t?.type;
        const s = stats[taskType];
        if (s) {
          totalAvgMs += s.avgMs;
          tasksWithStats++;
        }
      }
      return {
        ...ts,
        avgCompletionMinutes: tasksWithStats > 0
          ? +(totalAvgMs / 60000).toFixed(1)
          : null,
        tasksWithTimingData: tasksWithStats,
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error("GET /api/tasksets-with-timing error:", err);
    res.status(500).json({ error: "Failed to load task sets with timing" });
  }
});

// ------------------------------
// Audio: Direct transcription (no S3 needed)
// Accepts multipart audio upload, runs Whisper + GPT, returns feedback.
// ------------------------------
import multer from "multer";
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.post("/api/audio/transcribe", audioUpload.single("audio"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer || req.file.buffer.length < 500) {
      return res.status(400).json({ ok: false, error: "No audio data or file too small." });
    }

    const oai = getOpenAIInstance();
    const ext = (req.file.mimetype || "").includes("mp3") ? "mp3"
              : (req.file.mimetype || "").includes("wav") ? "wav"
              : "webm";
    const mimeType = ext === "mp3" ? "audio/mpeg" : ext === "wav" ? "audio/wav" : "audio/webm";

    const audioFile = await toFile(req.file.buffer, `recording.${ext}`, { type: mimeType });

    // 1) Whisper transcription
    const whisperResp = await oai.audio.transcriptions.create({
      model: "whisper-1",
      file: audioFile,
      response_format: "text",
    });
    const transcript = (typeof whisperResp === "string" ? whisperResp : whisperResp?.text || "").trim();

    if (!transcript) {
      return res.json({
        ok: true,
        transcript: "",
        feedback: "We couldn't detect any speech in your recording. Try speaking louder and closer to the mic.",
      });
    }

    // 2) AI feedback on the transcript
    const taskPrompt = String(req.body?.taskPrompt || "").trim();
    const rubric = String(req.body?.rubric || "").trim();
    const model = process.env.AI_MODEL || "gpt-4.1-mini";

    const systemMsg = `You are a supportive classroom teacher giving brief feedback on a student's spoken response.
Be encouraging but honest. Keep feedback to 2-3 sentences max.
${rubric ? `\nAssessment criteria: ${rubric}` : ""}`;

    const userMsg = `Task prompt: "${taskPrompt}"

Student's spoken response (transcribed):
"${transcript}"

Give brief, constructive feedback. Start with what was good, then suggest one improvement if needed.`;

    const chatResp = await oai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: userMsg },
      ],
      max_tokens: 200,
      temperature: 0.7,
    });

    const feedback = chatResp.choices?.[0]?.message?.content?.trim() || "";

    return res.json({ ok: true, transcript, feedback });
  } catch (err) {
    console.error("[/api/audio/transcribe] error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Transcription failed." });
  }
});

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
    if (!ownerId) {
      console.warn("[reports] GET /api/reports — empty ownerId. user:", req.user?._id, "guest:", req.user?.guest);
      return res.status(401).json({ ok: false, error: "Unauthorized — no owner identity found. Are you logged in?" });
    }

    // Try exact ownerId match first, then fall back to teacherEmail match
    let rows = await SessionReport.find({ ownerId })
      .sort({ createdAt: -1 })
      .select("_id roomCode className gradeLevel headline createdAt startedAt planTierUsed taskSetName runByPresenterName sharedFromTeacherName sharedFromTeacherEmail classAverageScore classAverageEngagement noiseSummary")
      .lean();

    // If no reports found by ownerId, try matching by teacher email
    if ((!rows || rows.length === 0) && req.user?.email) {
      const email = String(req.user.email).trim().toLowerCase();
      rows = await SessionReport.find({
        $or: [
          { teacherEmail: { $regex: new RegExp(`^${email}$`, "i") } },
          { sharedFromTeacherEmail: { $regex: new RegExp(`^${email}$`, "i") } },
        ],
      })
        .sort({ createdAt: -1 })
        .select("_id roomCode className gradeLevel headline createdAt startedAt planTierUsed taskSetName runByPresenterName sharedFromTeacherName sharedFromTeacherEmail classAverageScore classAverageEngagement noiseSummary")
        .lean();
      if (rows?.length) {
        console.log(`[reports] Found ${rows.length} reports via email fallback for ${email} (ownerId ${ownerId} had 0)`);
      }
    }

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
    if (!ownerId) {
      console.warn("[reports] GET /api/reports/:id — empty ownerId. user:", req.user?._id, "guest:", req.user?.guest);
      return res.status(401).json({ ok: false, error: "Unauthorized — no owner identity found. Are you logged in?" });
    }

    const id = String(req.params.id || "").trim();
    let doc = await SessionReport.findOne({ _id: id, ownerId }).lean();

    // If not found by ownerId, check if the user is the report's sharedFromTeacherEmail
    if (!doc) {
      const email = req.user?.email || "";
      if (email) {
        doc = await SessionReport.findOne({
          _id: id,
          $or: [
            { teacherEmail: email },
            { sharedFromTeacherEmail: email },
          ],
        }).lean();
      }
    }

    if (!doc) {
      console.warn(`[reports] Report ${id} not found for ownerId=${ownerId}`);
      return res.status(404).json({ ok: false, error: "Report not found. It may belong to a different account." });
    }

    return res.json({ ok: true, report: doc });
  } catch (err) {
    console.error("GET /api/reports/:id failed:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ── Grading config: update on a taskset ────────────────────────────
app.patch("/api/tasksets/:id/grading-config", authRequired, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const ts = await TaskSet.findOne({ _id: req.params.id, ownerId });
    if (!ts) return res.status(404).json({ ok: false, error: "Taskset not found" });

    const { enabled, maxGrade, letterGradeScale } = req.body || {};
    ts.gradingConfig = {
      enabled: enabled === true,
      maxGrade: Number(maxGrade) > 0 ? Number(maxGrade) : 100,
      letterGradeScale: Array.isArray(letterGradeScale) && letterGradeScale.length > 0
        ? letterGradeScale
        : ts.gradingConfig?.letterGradeScale || [
            { min: 90, letter: "A" },
            { min: 80, letter: "B" },
            { min: 70, letter: "C" },
            { min: 60, letter: "D" },
            { min: 0, letter: "F" },
          ],
    };
    await ts.save();
    return res.json({ ok: true, gradingConfig: ts.gradingConfig });
  } catch (err) {
    console.error("PATCH grading-config failed:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ── XLSX Gradebook Export ────────────────────────────────────────
app.get("/api/reports/:id/gradebook.xlsx", authRequired, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const doc = await SessionReport.findOne({ _id: req.params.id, ownerId }).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "Report not found" });

    let ExcelJS;
    try {
      ExcelJS = (await import("exceljs")).default;
    } catch {
      return res.status(500).json({ ok: false, error: "ExcelJS not installed. Run: npm i exceljs" });
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "Curriculate";
    wb.created = new Date();

    const ws = wb.addWorksheet("Gradebook");

    // Header info
    ws.mergeCells("A1:G1");
    const titleCell = ws.getCell("A1");
    titleCell.value = `Gradebook — ${doc.className || "Class"} — ${doc.roomCode || ""}`;
    titleCell.font = { size: 14, bold: true };
    titleCell.alignment = { horizontal: "left" };

    ws.mergeCells("A2:G2");
    const dateCell = ws.getCell("A2");
    dateCell.value = `Generated: ${new Date(doc.createdAt || Date.now()).toLocaleDateString()} | Grade Level: ${doc.gradeLevel || "—"}`;
    dateCell.font = { size: 10, italic: true, color: { argb: "FF666666" } };

    const gc = doc.gradingConfig || {};
    const maxGrade = gc.maxGrade || 100;

    ws.mergeCells("A3:G3");
    const scaleCell = ws.getCell("A3");
    scaleCell.value = `Grading Scale: Out of ${maxGrade}`;
    scaleCell.font = { size: 10, bold: true };

    // Column headers (row 5)
    const headers = ["Student", "Team", "Points Earned", "Points Possible", "Percentage", `Grade (/${maxGrade})`, "Letter Grade"];
    const headerRow = ws.getRow(5);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
      cell.alignment = { horizontal: "center" };
      cell.border = {
        bottom: { style: "thin", color: { argb: "FF000000" } },
      };
    });

    // Column widths
    ws.getColumn(1).width = 24;
    ws.getColumn(2).width = 20;
    ws.getColumn(3).width = 14;
    ws.getColumn(4).width = 14;
    ws.getColumn(5).width = 12;
    ws.getColumn(6).width = 14;
    ws.getColumn(7).width = 12;

    // Data rows
    const grades = doc.studentGrades || [];
    grades.forEach((g, i) => {
      const row = ws.getRow(6 + i);
      row.getCell(1).value = g.studentName || "Unknown";
      row.getCell(2).value = g.teamName || "";
      row.getCell(3).value = g.pointsEarned || 0;
      row.getCell(4).value = g.pointsPossible || 0;
      row.getCell(5).value = g.percent != null ? g.percent / 100 : 0;
      row.getCell(5).numFmt = "0.0%";
      row.getCell(6).value = g.scaledGrade ?? 0;
      row.getCell(7).value = g.letterGrade || "—";
      row.getCell(7).alignment = { horizontal: "center" };
      row.getCell(7).font = { bold: true };

      // Alternate row shading
      if (i % 2 === 1) {
        for (let c = 1; c <= 7; c++) {
          row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F7FB" } };
        }
      }
    });

    // Summary row
    if (grades.length > 0) {
      const sumRow = ws.getRow(6 + grades.length + 1);
      sumRow.getCell(1).value = "Class Average";
      sumRow.getCell(1).font = { bold: true };
      const avgPct = grades.reduce((s, g) => s + (g.percent || 0), 0) / grades.length;
      const avgScaled = grades.reduce((s, g) => s + (g.scaledGrade || 0), 0) / grades.length;
      sumRow.getCell(5).value = avgPct / 100;
      sumRow.getCell(5).numFmt = "0.0%";
      sumRow.getCell(5).font = { bold: true };
      sumRow.getCell(6).value = Math.round(avgScaled * 10) / 10;
      sumRow.getCell(6).font = { bold: true };

      // Border above summary
      for (let c = 1; c <= 7; c++) {
        sumRow.getCell(c).border = { top: { style: "medium", color: { argb: "FF000000" } } };
      }
    }

    // Send as download
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="gradebook-${doc.roomCode || "report"}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("GET /api/reports/:id/gradebook.xlsx failed:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Analytics API (protected)
app.get("/analytics/sessions", authRequired, listSessions);
app.get("/analytics/sessions/:id", authRequired, getSessionDetails);

// Admin CRUD routes (imported from routes/adminCrud.js)
app.use("/api/admin", adminCrudRouter);

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Curriculate backend running on port", PORT);
})
