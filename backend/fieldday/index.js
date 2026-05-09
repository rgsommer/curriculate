/**
 * Field Day backend module — single export.
 *
 * Mount in your main backend/index.js with:
 *
 *     const fielddayRouter = require("./fieldday");
 *     app.use("/fieldday/api", fielddayRouter);
 *
 * That single line wires up all routes documented in BACKEND.md and
 * matched by the client's api.js.
 *
 * If you want to override the email transport with your own sender:
 *
 *     const { setTransport } = require("./fieldday/email");
 *     setTransport(({ from, fromName, to, subject, text, html }) => myMailer.send(...));
 */
const express = require("express");
const cookieParser = require("cookie-parser");

const { requireSession } = require("./auth");
const authRoutes    = require("./routes/auth");
const stateRoutes   = require("./routes/state");
const eventRoutes   = require("./routes/events");
const recordRoutes  = require("./routes/records");

const router = express.Router();
router.use(express.json({ limit: "10mb" })); // workbook imports can be sizable
router.use(cookieParser());

// Routes that DON'T need a session (sign-in, leader join, public lookups)
router.use("/", authRoutes);

// Everything below requires an authenticated session
router.use("/", requireSession, stateRoutes);
router.use("/", requireSession, eventRoutes);
router.use("/", requireSession, recordRoutes);

// Health check — handy for uptime monitors
router.get("/health", (req, res) => res.json({ ok: true, service: "fieldday", ts: Date.now() }));

module.exports = router;
