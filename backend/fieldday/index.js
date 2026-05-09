/**
 * Field Day backend module — single export.
 *
 * Mount in your main backend/index.js with:
 *
 *     import fielddayRouter from "./fieldday.js";
 *     app.use("/fieldday/api", fielddayRouter);
 *
 * That single line wires up all routes documented in BACKEND.md and
 * matched by the client's api.js.
 *
 * If you want to override the email transport with your own sender:
 *
 *     import { setTransport } from "./fieldday/email.js";
 *     setTransport(({ from, fromName, to, subject, text, html }) => myMailer.send(...));
 */
import express from "express";
import cookieParser from "cookie-parser";

import { requireSession } from "./auth.js";
import authRoutes from "./routes/auth.js";
import stateRoutes from "./routes/state.js";
import eventRoutes from "./routes/events.js";
import recordRoutes from "./routes/records.js";
import referRoutes from "./routes/refer.js";
import backupRoutes from "./routes/backups.js";
import adminStatsRoutes from "./routes/admin-stats.js";
import timerRoutes from "./routes/timer.js";

const router = express.Router();
router.use(express.json({ limit: "10mb" })); // workbook imports can be sizable
router.use(cookieParser());

// Routes that DON'T need a session (sign-in, leader join, public lookups, refer)
router.use("/", authRoutes);
router.use("/", referRoutes);

// Curriculate-internal admin stats — guarded by FIELDDAY_ADMIN_TOKEN env var
router.use("/admin", adminStatsRoutes);

// Everything below requires an authenticated session
router.use("/", requireSession, stateRoutes);
router.use("/", requireSession, eventRoutes);
router.use("/", requireSession, recordRoutes);
router.use("/", requireSession, backupRoutes);
router.use("/", requireSession, timerRoutes);

// Health check — handy for uptime monitors
router.get("/health", (req, res) => res.json({ ok: true, service: "fieldday", ts: Date.now() }));

export default router;
