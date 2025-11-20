// backend/routes/sessions.js
import express from "express";
import crypto from "crypto";
import Session from "../models/Session.js";
import TaskSet from "../models/TaskSet.js";
import { authRequired } from "../middleware/authRequired.js";
import { endSession } from "../controllers/sessionController.js";

const router = express.Router();

// Some nice default station colours
const DEFAULT_STATION_COLORS = [
  "#e53935", // red
  "#1e88e5", // blue
  "#43a047", // green
  "#fdd835", // yellow
  "#8e24aa", // purple
  "#fb8c00", // orange
];

// Generate a short random session code (e.g. "A7FQ")
function generateSessionCode(length = 4) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Token for QR codes
function generateQrToken() {
  return crypto.randomBytes(8).toString("hex"); // 16 hex chars
}

/**
 * POST /sessions
 * Create a new session.
 * body: { taskSetId, hostId?, code?, stationCount?, stationColors? }
 */
router.post("/", async (req, res) => {
  try {
    let {
      code,
      taskSetId,
      hostId,
      stationCount = 0,
      stationColors,
    } = req.body || {};

    if (!taskSetId) {
      return res.status(400).json({ error: "taskSetId is required" });
    }

    const taskSet = await TaskSet.findById(taskSetId);
    if (!taskSet) {
      return res.status(404).json({ error: "TaskSet not found" });
    }

    // Generate unique code if not provided
    if (!code) {
      let unique = false;
      let attempts = 0;
      while (!unique && attempts < 20) {
        const candidate = generateSessionCode(4);
        // eslint-disable-next-line no-await-in-loop
        const existing = await Session.findOne({ code: candidate });
        if (!existing) {
          code = candidate;
          unique = true;
        }
        attempts++;
      }
      if (!unique) {
        return res
          .status(500)
          .json({ error: "Failed to generate unique session code" });
      }
    }

    const upperCode = code.toString().toUpperCase();
    const existingCode = await Session.findOne({ code: upperCode });
    if (existingCode) {
      return res.status(409).json({ error: "Session code already exists" });
    }

    // Build initial stations if requested
    const stations = [];
    const colors = stationColors && stationColors.length
      ? stationColors
      : DEFAULT_STATION_COLORS;

    for (let i = 0; i < stationCount; i++) {
      stations.push({
        label: `Station ${i + 1}`,
        color: colors[i % colors.length],
        qrToken: generateQrToken(),
      });
    }

    const session = await Session.create({
      code: upperCode,
      hostId: hostId || null,
      taskSet: taskSet._id,
      state: "lobby",
      currentTaskIndex: -1,
      teams: [],
      stations,
    });

    res.status(201).json(session);
  } catch (err) {
    console.error("Error creating session:", err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

/**
 * GET /sessions/:code
 * Fetch session by room code (uppercase)
 */
router.get("/:code", async (req, res) => {
  try {
    const upperCode = (req.params.code || "").toUpperCase();
    const session = await Session.findOne({ code: upperCode }).populate(
      "taskSet"
    );
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json(session);
  } catch (err) {
    console.error("Error fetching session:", err);
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

/**
 * GET /sessions/by-station-token/:token
 * Used when a device scans a QR code at a colour station.
 * Returns session code + station info.
 */
router.get("/by-station-token/:token", async (req, res) => {
  try {
    const token = req.params.token;
    const session = await Session.findOne({ "stations.qrToken": token });
    if (!session) {
      return res.status(404).json({ error: "Station not found" });
    }

    const station = session.stations.find((s) => s.qrToken === token);
    if (!station) {
      return res.status(404).json({ error: "Station not found" });
    }

    res.json({
      sessionId: session._id,
      sessionCode: session.code,
      station: {
        _id: station._id,
        label: station.label,
        color: station.color,
        qrToken: station.qrToken,
        currentTeamId: station.currentTeamId || null,
      },
    });
  } catch (err) {
    console.error("Error resolving station token:", err);
    res.status(500).json({ error: "Failed to resolve station token" });
  }
});

/**
 * POST /sessions/:code/teams
 * Add a team to a session.
 * body: { name, color?, members? }
 */
router.post("/:code/teams", async (req, res) => {
  try {
    const upperCode = (req.params.code || "").toUpperCase();
    const { name, color, members } = req.body || {};

    if (!name) {
      return res.status(400).json({ error: "Team name is required" });
    }

    const session = await Session.findOne({ code: upperCode });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const team = {
      name,
      color: color || null,
      members: Array.isArray(members) ? members : [],
      score: 0,
    };

    session.teams.push(team);
    await session.save();

    const newTeam = session.teams[session.teams.length - 1];

    res.status(201).json({
      sessionId: session._id,
      team: newTeam,
    });
  } catch (err) {
    console.error("Error adding team:", err);
    res.status(500).json({ error: "Failed to add team" });
  }
});

/**
 * POST /sessions/:code/stations/bootstrap
 * Create or replace stations (with QR tokens) for a session.
 * body: { count, colors?, labels? }
 */
router.post("/:code/stations/bootstrap", async (req, res) => {
  try {
    const upperCode = (req.params.code || "").toUpperCase();
    const { count = 6, colors, labels } = req.body || {};

    const session = await Session.findOne({ code: upperCode });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const palette = colors && colors.length ? colors : DEFAULT_STATION_COLORS;

    const stations = [];
    for (let i = 0; i < count; i++) {
      stations.push({
        label:
          (labels && labels[i]) ||
          `Station ${i + 1}`,
        color: palette[i % palette.length],
        qrToken: generateQrToken(),
      });
    }

    session.stations = stations;
    await session.save();

    res.status(201).json(session.stations);
  } catch (err) {
    console.error("Error bootstrapping stations:", err);
    res.status(500).json({ error: "Failed to bootstrap stations" });
  }
});

/**
 * PATCH /sessions/:code/state
 * Update session state (e.g. lobby → running, etc.)
 * body: { state, currentTaskIndex? }
 */
router.patch("/:code/state", async (req, res) => {
  try {
    const upperCode = (req.params.code || "").toUpperCase();
    const { state, currentTaskIndex } = req.body || {};

    const session = await Session.findOne({ code: upperCode });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (state) session.state = state;
    if (typeof currentTaskIndex === "number") {
      session.currentTaskIndex = currentTaskIndex;
    }

    await session.save();
    res.json(session);
  } catch (err) {
    console.error("Error updating session state:", err);
    res.status(500).json({ error: "Failed to update session" });
  }
});

// End a session and compute analytics
router.post("/:id/end", authRequired, endSession);

export default router;
