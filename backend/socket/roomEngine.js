// ====================================================================
//  Room Engine – Extracted from index.js
//  Handles all room state, team management, task sequencing, and scoring
// ====================================================================

import crypto from "crypto";
import Session from "../models/Session.js";
import TeamSession from "../models/TeamSession.js";
import { TASK_TYPE_META, TASK_TYPES } from "../../shared/taskTypes.js";
import { COLORS } from "../../shared/colors.js";
import { assessTaskPlayability } from "../../shared/taskPlayability.js";
import { recordNoiseSample, computeNoiseSummary } from "../utils/noiseTelemetry.js";

// ================================
// CONSTANTS
// ================================
const OFFLINE_TIMEOUT_MS = 1000 * 60 * 30; // 30 minutes
const NEXT_TASK_DELAY_MS = 15000;
const POST_SUBMIT_SECONDS = Number(process.env.POST_SUBMIT_SECONDS || 10);

// ================================
// MAIN FACTORY FUNCTION
// ================================
export function createRoomEngine(io, deps = {}) {
  // Optional deps injected by backend/index.js so the live-debate bot fallback
  // can record the real team's bonus when it beats the bot. We accept null
  // here — the bot timer guards on typeof addBonusSubmission === "function".
  const _addBonusSubmission = typeof deps.addBonusSubmission === "function"
    ? deps.addBonusSubmission
    : null;
  const rooms = {}; // rooms["AB"] = { teacherSocketId, teams, stations, taskset, ... }

  // ================================
  // Teacher Instance Pruning
  // ================================
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

  // ================================
  // Keep-alive server interval
  // ================================
  const keepAliveInterval = setInterval(() => {
    const now = Date.now();

    // ── Auto-end sweep: any active room whose teacher-declared endsAt has
    //    passed gets a session:complete emit (same handler the natural-
    //    completion + explicit "End now" paths already use on the student
    //    side). autoEndFiredAt guards against double-firing if the teacher
    //    edited endsAt and it's already past. Runs BEFORE the availability
    //    emit so a room that just ended is reported as inactive.
    for (const r of Object.values(rooms)) {
      if (!r || !r.isActive) continue;
      const endsAt = Number(r.endsAt);
      if (!endsAt || endsAt > now) continue;
      if (r.autoEndFiredAt && r.autoEndFiredAt >= endsAt) continue;
      r.autoEndFiredAt = now;
      r.isActive = false;
      // Mark how far through the taskset we actually got. The reporting
      // pipeline reads this to scale the engagement-score denominator —
      // a class that ran out of time on task 6 of 10 shows 6/6 (100%)
      // for engagement, not 6/10 (60%). Without this every auto-ended
      // session looked like a class-wide failure on the report.
      const totalTasks = (r.taskset?.tasks?.length) || 0;
      const reached = Number.isInteger(r.taskIndex) ? r.taskIndex : -1;
      if (totalTasks > 0 && reached + 1 < totalTasks) {
        r.endedEarly = true;
        r.endedEarlyAtTaskIndex = reached;
      }
      try {
        io.to(r.code).emit("session:autoEndingNow", { roomCode: r.code, reason: "endTimeReached" });
        io.to(r.code).emit("session:complete");
      } catch (e) {
        console.warn(`[roomEngine] auto-end emit failed for ${r.code}:`, e?.message);
      }
    }

    const available = Object.values(rooms)
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

  // ================================
  // Core Room Functions
  // ================================
  function shuffle(array) {
    const a = [...array];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function createRoom(roomCode, teacherSocketId, locationCode = "Classroom") {
    const stations = {};
    const NUM_STATIONS = 8;
    // IMPORTANT: Do NOT shuffle — the client-side normalizeStationId uses a
    // hardcoded index (station-1 = COLORS[0], station-2 = COLORS[1], etc.)
    // and the QR posters embed color names. Shuffling creates a mismatch
    // between what the student sees and what the server expects.
    const shuffledColors = [...COLORS];
    for (let i = 1; i <= NUM_STATIONS; i++) {
      const id = `station-${i}`;
      stations[id] = {
        id,
        assignedTeamId: null,
        color: shuffledColors[i - 1] || null,
        // Device Mode Support — Phase 2b (QR payload token hardening).
        // Per-room, per-station opaque token that lets a scanned QR
        // resolve to a station without exposing the visible color in
        // the payload URL. Session-scoped: rotates every createRoom
        // so a photo of a poster is only useful for that session.
        // See docs/device-mode-architecture.md §4.5.
        qrToken: crypto.randomBytes(6).toString("hex"),
      };
    }

    const room = {
      code: roomCode,
      teacherSocketId,
      createdAt: Date.now(),
      // Heartbeat/availability
      lastTeacherSeenAt: Date.now(),
      expiresAt: Date.now() + 1000 * 60 * 60, // 1 hour rolling expiry
      // Teacher-declared auto-end. When set, the keep-alive ticker auto-emits
      // session:complete once `endsAt` passes — so the teacher can leave the
      // device alone and the session ends cleanly at the bell. `autoEndFiredAt`
      // prevents the ticker from firing twice for the same end time.
      endsAt: null,
      autoEndFiredAt: null,
      teams: {},
      stations,
      taskset: null,
      taskIndex: -1,
      submissions: [],
      startedAt: null,
      isActive: false,
      locationCode, // e.g. "Classroom"

      // Device Mode Support — see docs/device-mode-architecture.md.
      // Default preserves current behavior (tablets play everything).
      // Teacher can change it via `teacher:setDeviceMode` before
      // launch. In Phase 1b this drives silent substitution of
      // motion-required tasks for laptop / mixed rooms.
      deviceMode: "tablet_only",

      // Random-treats state
      treatsConfig: {
        enabled: true,
        total: 2,
        given: 0,
      },
      pendingTreats: {}, // teamId -> true
      treatedTeamIds: new Set(), // teams that already got a treat this session

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
      brainstormBattles: {
        // [taskKey]: {
        //   taskKey,
        //   startedAt,
        //   ideasByTeam: { [teamId]: string[] }
        // }
      },

      // ==== MAD DASH SEQUENCE STATE ====
      madDashSequence: null,
      diffDetectiveRace: null,
      flashcardsRace: null,
      hangmanDuel: null, // Hangman Duel per-team sync state

      // ==== GUESS WHO (YES/NO DEDUCTION) STATE ====
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

    // Build initial round-robin assignment
    const assignment = {}; // teamId -> stationId
    sortedTeams.forEach((teamId, index) => {
      const stationIdx = (index + room._stationRound) % stationIds.length;
      assignment[teamId] = stationIds[stationIdx];
    });

    // Guarantee movement: if any team is assigned the station they're already at
    // (e.g. they were left there after a PMC correct-answer scan), swap them with
    // the next team in the sorted list so everyone has to walk somewhere new.
    if (sortedTeams.length > 1) {
      for (let i = 0; i < sortedTeams.length; i++) {
        const teamId = sortedTeams[i];
        const team = room.teams[teamId];
        if (!team) continue;
        // "already at" means currentStationId OR the last PMC correct-answer station
        const stuckAt = team.currentStationId || team.lastScannedStationId || null;
        if (stuckAt && assignment[teamId] === stuckAt) {
          // Swap with the next team (wrapping)
          const swapIdx = (i + 1) % sortedTeams.length;
          const swapId = sortedTeams[swapIdx];
          const tmp = assignment[teamId];
          assignment[teamId] = assignment[swapId];
          assignment[swapId] = tmp;
        }
      }
    }

    // Apply assignment
    sortedTeams.forEach((teamId) => {
      const stationId = assignment[teamId];
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

  function reassignStationForTeam(room, teamId) {
    const stationIds = Object.keys(room.stations || {});
    if (stationIds.length === 0) return;

    const team = room.teams?.[teamId];
    if (!team) return;

    const current = team.currentStationId || null;
    const lastScanned = team.lastScannedStationId || null;

    // Helper: check if a station ID matches a given station reference (ID or color name)
    const stationMatches = (stationId, ref) => {
      if (!ref) return false;
      if (stationId === ref) return true;
      // Also compare by color — handles the case where lastScanned was stored as a color name
      const stationColor = String(room.stations?.[stationId]?.color || "").toLowerCase();
      return stationColor && stationColor === ref.toLowerCase();
    };

    // Stations occupied by OTHER teams
    const occupiedByOthers = new Set(
      Object.entries(room.stations || {})
        .filter(([id, s]) => s.assignedTeamId && s.assignedTeamId !== teamId)
        .map(([id]) => id)
    );

    // Best candidates:
    // - not current (by ID or color)
    // - not last scanned (by ID or color — covers PMC correct-answer color fallback)
    // - not occupied by others
    let candidates = stationIds.filter(
      (id) =>
        !stationMatches(id, current) &&
        !stationMatches(id, lastScanned) &&
        !occupiedByOthers.has(id)
    );

    // Fallback 1: allow lastScanned if needed, but still not current
    if (candidates.length === 0) {
      candidates = stationIds.filter(
        (id) =>
          !stationMatches(id, current) &&
          !occupiedByOthers.has(id)
      );
    }

    // Fallback 2: anything except current
    if (candidates.length === 0) {
      candidates = stationIds.filter((id) => !stationMatches(id, current));
    }

    // Final fallback
    const nextStationId =
      candidates.length > 0
        ? candidates[Math.floor(Math.random() * candidates.length)]
        : stationIds[0];

    console.log("[reassignStationForTeam result]", {
      teamId,
      current,
      lastScanned,
      nextStationId,
    });

    // Clear old station assignment (for this team)
    if (
      current &&
      room.stations[current] &&
      room.stations[current].assignedTeamId === teamId
    ) {
      room.stations[current].assignedTeamId = null;
    }

    // Set new station
    team.previousStationId = current;
    team.currentStationId = nextStationId;
    team.lastScannedStationId = null; // clear only after using it as an exclusion

    if (!room.stations[nextStationId]) {
      room.stations[nextStationId] = { id: nextStationId, assignedTeamId: null };
    }

    room.stations[nextStationId].assignedTeamId = teamId;

    // Multi-room roaming hunt: the ROOM is part of the station identity. Pick a
    // room too (avoid repeating the team's current room when possible) so teams
    // genuinely roam between rooms, and set the expected room used to gate scans.
    // No-op for single-room sessions (room is ignored entirely there).
    if (Array.isArray(room.selectedRooms) && room.selectedRooms.length > 1) {
      const slugify = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "-");
      const classroomSlug = slugify(room.locationCode || "Classroom");
      const ring = room.selectedRooms.map(slugify).filter((s) => s && s !== classroomSlug);
      const pool = ring.length ? ring : room.selectedRooms.map(slugify).filter(Boolean);
      if (pool.length) {
        const prev = team.locationSlug || null;
        let choices = pool.filter((s) => s !== prev);
        if (choices.length === 0) choices = pool;
        team.locationSlug = choices[Math.floor(Math.random() * choices.length)];
      }
    }
  }

  // ================================
  // Transcript & Reporting
  // ================================
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
      behaviorDings: Array.isArray(room.behaviorDings) ? room.behaviorDings : [],
      questTrades: Array.isArray(room.questTrades) ? room.questTrades : [],
    };
  }

  function computePerParticipantStats(room, transcript) {
    const tasks = transcript.tasks || [];
    const totalTasks = tasks.length;

    // Build per-team stats from submissions
    const teamStats = {};

    for (const sub of room.submissions) {
      const tid = sub.teamId;
      if (!teamStats[tid]) {
        teamStats[tid] = {
          teamId: tid,
          teamName: sub.teamName || "",
          attempts: 0,
          correctCount: 0,
          pointsEarned: 0,
          taskIndices: new Set(),
        };
      }
      const entry = teamStats[tid];
      entry.attempts += 1;
      if (sub.correct) entry.correctCount += 1;
      entry.pointsEarned += sub.points ?? 0;
      if (Number.isFinite(sub.taskIndex) && sub.taskIndex >= 0) {
        entry.taskIndices.add(sub.taskIndex);
      }
    }

    // Compute pointsPossible per team using the same formula as scoring:
    //   basePoints = (task.points ?? 100) * 10
    // so that percentages come out correctly (submissions store 10× multiplied points).
    for (const ts of Object.values(teamStats)) {
      let possible = 0;
      for (const idx of ts.taskIndices) {
        const t = tasks[idx];
        const rawPts = t ? (t.points ?? 100) : 100;
        possible += rawPts * 10; // match the 10× scoring multiplier in index.js
      }
      ts.pointsPossible = possible;
    }

    // Expand team stats into per-student entries using team members list.
    // If a team has no recorded members, fall back to a single "Team X" entry.
    const teamsMap = room.teams && typeof room.teams === "object" ? room.teams : {};
    const results = [];

    for (const ts of Object.values(teamStats)) {
      const team = teamsMap[ts.teamId];
      const members = Array.isArray(team?.members) ? team.members.filter(Boolean) : [];

      if (members.length === 0) {
        // No individual members recorded — use team name
        results.push({
          teamId: ts.teamId,
          teamName: ts.teamName,
          studentName: ts.teamName || "Unknown",
          members: [],
          attempts: ts.attempts,
          correctCount: ts.correctCount,
          pointsEarned: ts.pointsEarned,
          pointsPossible: ts.pointsPossible,
          engagementPercent: totalTasks > 0 ? Math.round((ts.taskIndices.size / totalTasks) * 100) : 0,
          finalPercent: ts.pointsPossible > 0 ? Math.round((ts.pointsEarned / ts.pointsPossible) * 100) : 0,
        });
      } else {
        // Create one entry per member, sharing the team's stats
        for (const memberName of members) {
          results.push({
            teamId: ts.teamId,
            teamName: ts.teamName,
            studentName: memberName,
            members,
            attempts: ts.attempts,
            correctCount: ts.correctCount,
            pointsEarned: ts.pointsEarned,
            pointsPossible: ts.pointsPossible,
            engagementPercent: totalTasks > 0 ? Math.round((ts.taskIndices.size / totalTasks) * 100) : 0,
            finalPercent: ts.pointsPossible > 0 ? Math.round((ts.pointsEarned / ts.pointsPossible) * 100) : 0,
          });
        }
      }
    }

    return results;
  }

  // ================================
  // Helper: Track room-level task progress
  // ================================
  function getRoomTaskProgress(room) {
    if (!room || !room.teams) {
      return {
        maxJoinedTaskIndex: -1,
        minJoinedTaskIndex: -1,
        totalTasks: 0,
      };
    }

    const taskCount = Array.isArray(room.taskset?.tasks) ? room.taskset.tasks.length : 0;
    const joinedTeams = Object.values(room.teams).filter(t => typeof t.taskIndex === "number" && t.taskIndex >= 0);

    if (joinedTeams.length === 0) {
      return {
        maxJoinedTaskIndex: -1,
        minJoinedTaskIndex: -1,
        totalTasks: taskCount,
      };
    }

    const taskIndices = joinedTeams.map(t => t.taskIndex);
    return {
      maxJoinedTaskIndex: Math.max(...taskIndices),
      minJoinedTaskIndex: Math.min(...taskIndices),
      totalTasks: taskCount,
    };
  }

  // ================================
  // Room State Builder
  // ================================
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
        playerScores: [],
        taskIndex: -1,
        startedAt: null,
        isActive: false,

        treatsConfig: {
          enabled: true,
          total: 2,
          given: 0,
        },
        pendingTreatTeams: [],
        treatedTeamIds: [],

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

    // Build per-player scores from submissions (for individual leaderboard)
    const playerScoreMap = {};
    for (const sub of room.submissions || []) {
      // 1) If the submission carries per-player breakdown (game tasks), use it
      const ps = sub.aiScore?.playerScores || sub.answer?.playerScores;
      if (Array.isArray(ps) && ps.length > 0) {
        for (const p of ps) {
          const pName = String(p.name || "").trim();
          if (!pName) continue;
          if (!playerScoreMap[pName]) {
            playerScoreMap[pName] = { name: pName, teamId: sub.teamId, teamName: sub.teamName, pts: 0, tasks: 0 };
          }
          playerScoreMap[pName].pts += Number(p.points) || 0;
          playerScoreMap[pName].tasks += 1;
        }
        continue; // skip the generic path — we already attributed per-player
      }

      // 2) If the submission has a playerId, attribute points to that player
      const playerId = sub.playerId || null;
      if (playerId) {
        if (!playerScoreMap[playerId]) {
          playerScoreMap[playerId] = { name: playerId, teamId: sub.teamId, teamName: sub.teamName, pts: 0, tasks: 0 };
        }
        playerScoreMap[playerId].pts += sub.points ?? 0;
        playerScoreMap[playerId].tasks += 1;
        continue;
      }

      // 3) Fallback: split points evenly among team members
      const team = (room.teams || {})[sub.teamId];
      const members = Array.isArray(team?.members) ? team.members.filter(Boolean) : [];
      if (members.length > 0) {
        const share = Math.round((sub.points ?? 0) / members.length);
        for (const m of members) {
          const mName = typeof m === "string" ? m : m?.name || m?.playerName || "";
          if (!mName) continue;
          if (!playerScoreMap[mName]) {
            playerScoreMap[mName] = { name: mName, teamId: sub.teamId, teamName: sub.teamName, pts: 0, tasks: 0 };
          }
          playerScoreMap[mName].pts += share;
          playerScoreMap[mName].tasks += 1;
        }
      }
    }
    const playerScores = Object.values(playerScoreMap).sort((a, b) => b.pts - a.pts);

    // Detect a one-off Quick Task "taskset" so it doesn't turn on the
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

    // ==== BRAINSTORM STATE SUMMARY FOR LIVESTREAM / UI ====
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
      // Device Mode Support (Phase 1a). Clients read this off room:state.
      deviceMode: room.deviceMode || "tablet_only",
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

            // team selfie (for banner display)
            selfieUrl: t.selfieUrl || null,
            themedSelfieUrl: t.themedSelfieUrl || null,

            // Device Mode Support (Phase 2a). Advisory device profile
            // reported by the student at join. Used by the teacher's
            // dashboard chip; safe to be null.
            clientDeviceInfo: t.clientDeviceInfo || null,
          };
        }
        return out;
      })(),

      stations: stationsArray,
      scores,
      playerScores,
      taskIndex: overallTaskIndex,
      totalTasks: Array.isArray(room.taskset?.tasks) ? room.taskset.tasks.length : 0,
      tasksetName: (room.taskset?.name || room.taskset?.title || "").replace(/^taskset:\s*/i, "").trim(),
      startedAt: room.startedAt || null,
      isActive: !!room.isActive,
      // Teacher-declared auto-end (epoch ms) — null if unset. Included in
      // room state so late joiners + reconnects pick up the countdown
      // without needing a follow-up emit.
      endsAt: room.endsAt || null,
      // Quest Mode flag — mirrors TaskSet.questModeEnabled so the student
      // app can decide whether to mount the QuestHud.
      questModeEnabled: !!room.taskset?.questModeEnabled,
      // Escape Room flag + minimal config (the renderer wants to know how many locks exist).
      // Full escapeRoomConfig (keys/fragments/lock answers) is INTENTIONALLY not exposed
      // here — clients only need the lock count for progress display.
      escapeRoomEnabled: !!room.taskset?.escapeRoomConfig,
      escapeRoomConfig: room.taskset?.escapeRoomConfig
        ? {
            totalLocks: Array.isArray(room.taskset.escapeRoomConfig.locks) ? room.taskset.escapeRoomConfig.locks.length : 0,
            // Strip secret answers / fragment revealValues — those go through the per-team state.
            // Locks: expose title/narrativeText/hint/type but NOT synthesisAnswer.
            locks: (room.taskset.escapeRoomConfig.locks || []).map((l) => ({
              id: l.id,
              title: l.title,
              narrativeText: l.narrativeText,
              hint: l.hint,
              type: l.type,
              requires: l.requires,
              unlocks: { roomCompleted: !!l.unlocks?.roomCompleted },
            })),
            // Fragments: expose id/type/position/gridPos/assetUrl/narrativeText.
            // revealValue is INCLUDED for client display only when the team has earned it
            // (escape:requestState returns earned IDs; the client cross-references).
            fragments: (room.taskset.escapeRoomConfig.fragments || []).map((f) => ({
              id: f.id,
              type: f.type,
              position: f.position,
              gridPos: f.gridPos,
              assetUrl: f.assetUrl,
              narrativeText: f.narrativeText,
              // revealValue is broadcast — clients show it only if state.fragmentsEarned includes the id
              revealValue: f.revealValue,
            })),
          }
        : null,
      // Whodunnit overlay — surfaced when the room has an enabled MysterySession.
      // We expose ONLY a boolean here; full state goes through mystery:requestState.
      mysteryEnabled: !!(room.taskset?.mysteryEnabled || room.mysteryActive),
      selectedRooms: Array.isArray(room.selectedRooms) ? room.selectedRooms : [],
      enforceLocation: !!room.enforceLocation,
      locationOptions: Array.isArray(room.locationOptions) ? room.locationOptions : [],
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
      treatedTeamIds: room.treatedTeamIds ? Array.from(room.treatedTeamIds) : [],

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

      // ── Class roster binding (Mode B) ──
      // Surfaced to the student-app so its join screen can render a name
      // dropdown sourced from the bound class. Only first/last names + IDs
      // are exposed; other PII (email, etc.) stays server-side.
      classBound: !!room.classBound,
      className: room.className || (room.classRoster?.className || ""),
      classRoster: room.classRoster && Array.isArray(room.classRoster.students)
        ? {
            id: room.classRoster.id || String(room.classRosterId || ""),
            className: room.classRoster.className || "",
            students: room.classRoster.students.map((s) => ({
              firstName: s.firstName || "",
              lastName: s.lastName || "",
              edsbyId: s.edsbyId || "",
              studentId: s.studentId || "",
            })),
          }
        : null,

      // Paper mode: when enabled, text-heavy tasks show a camera for paper-based work
      minimizeOnScreen: !!room.minimizeOnScreen,

      // Room-level task progress for pacing and catch-up mechanics
      ...(() => {
        const progress = getRoomTaskProgress(room);
        return {
          maxTaskIndex: progress.maxJoinedTaskIndex,
          minTaskIndex: progress.minJoinedTaskIndex,
          totalTasks: progress.totalTasks,
        };
      })(),

      // Average task progress across all teams (works for both linear and mystery modes)
      avgTaskProgress: (() => {
        const teamEntries = Object.values(room.teams || {});
        if (teamEntries.length === 0) return null;
        const totalTasks = Array.isArray(room.taskset?.tasks) ? room.taskset.tasks.length : 0;
        if (totalTasks === 0) return null;

        if (room.navigationMode === "mystery" && room.mysteryBox?.teamBoxes) {
          // Mystery box: use completed box count per team
          const boxes = room.mysteryBox.teamBoxes;
          const boxTotal = room.mysteryBox.taskCount || totalTasks;
          let sum = 0, count = 0;
          for (const tb of Object.values(boxes)) {
            sum += (tb.completed?.length || 0) / boxTotal;
            count++;
          }
          return count > 0 ? { avgPct: Math.round((sum / count) * 100), teamCount: count, totalTasks: boxTotal } : null;
        }

        // Linear: use team.taskIndex (index of task they're ON; completed = taskIndex)
        // taskIndex >= totalTasks means finished all; taskIndex 0 means on first task (0 completed)
        let sum = 0, count = 0;
        for (const t of teamEntries) {
          if (typeof t.taskIndex !== "number" || t.taskIndex < 0) continue;
          const completed = Math.min(t.taskIndex, totalTasks);
          sum += completed / totalTasks;
          count++;
        }
        return count > 0 ? { avgPct: Math.round((sum / count) * 100), teamCount: count, totalTasks } : null;
      })(),

      // Mystery box mode
      navigationMode: room.navigationMode || "linear",
      mysteryBox: room.mysteryBox ? {
        enabled: true,
        taskCount: room.mysteryBox.taskCount,
        globalTimerEnd: room.mysteryBox.globalTimerEnd,
        globalTimerMs: room.mysteryBox.globalTimerMs,
        // Per-team completion counts for teacher progress view
        teamProgress: Object.entries(room.mysteryBox.teamBoxes || {}).reduce((acc, [tid, tb]) => {
          acc[tid] = { completed: tb.completed.length, total: room.mysteryBox.taskCount };
          return acc;
        }, {}),
      } : null,
    };
  }

  // ================================
  // Task Assignment & Advancement
  // ================================
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

    // ── Serve-time playability gate ──────────────────────────────────
    // Never present a defective task to a student. If this task is missing
    // its essential parts, skip it and serve the next playable one. This is
    // the runtime backstop behind generation-time validation: even if a bad
    // task somehow reaches a live room, a kid never sees it — the session
    // just moves on. (current-events is an intentional shell resolved just
    // below at launch time, so it's exempt.)
    if (task.taskType !== "current-events" && task.taskType !== TASK_TYPES?.CURRENT_EVENTS) {
      try {
        const play = assessTaskPlayability(task);
        if (play && play.playable === false) {
          console.warn(
            `[playability-gate] room ${room.code}: skipping unplayable task #${index} ` +
              `(${task.taskType}) — ${(play.issues || []).join("; ")}`
          );
          room.teams[teamId].taskIndex = index + 1;
          return sendTaskToTeam(room, teamId, index + 1);
        }
      } catch (e) {
        // Never let the gate itself break serving — if assessment throws,
        // fall through and serve the task rather than trap the team.
        console.warn("[playability-gate] assessment error, serving task:", e?.message || e);
      }
    }

    // ── Current Events: lazily resolve at launch time ──
    // The persisted task is only a SHELL (lessonTopic / subject / grade / region / worldview).
    // Real content is fetched from a live web search + AI generation pipeline. We:
    //   1. Send a placeholder "Loading…" task to the team immediately.
    //   2. Kick off the resolver asynchronously.
    //   3. When the resolver returns, mutate task.config.resolved and re-call sendTaskToTeam.
    if (task.taskType === "current-events" && !task?.config?.resolved) {
      // Send a quick placeholder so the student device doesn't sit idle
      io.to(teamId).emit("task:launch", {
        taskIndex: index,
        index,
        task: {
          ...task,
          title: task.title || "Today's Story",
          prompt: "Loading today's connection to the lesson…",
          config: { ...(task.config || {}), loading: true },
        },
        timeLimitSeconds: null,
        totalTasks: tasks.length,
      });

      const shellCfg = task.config || {};
      const resolverPromise = import("../services/currentEventsResolver.js").then(({ resolveCurrentEvents }) =>
        resolveCurrentEvents({
          lessonTopic: shellCfg.lessonTopic || room.taskset?.topicLabel || "",
          subject: shellCfg.subject || room.taskset?.subject || "General",
          gradeLevel: Number(shellCfg.gradeLevel) || Number(room.taskset?.gradeLevel) || 7,
          region: shellCfg.region || "Canada",
          worldviewProfile: shellCfg.worldviewProfile || "general",
          preferredCategories: Array.isArray(shellCfg.preferredCategories) ? shellCfg.preferredCategories : undefined,
        }),
      );

      resolverPromise
        .then((result) => {
          if (!result?.ok || !result.resolved) return;
          // Mutate the in-memory task so subsequent calls (and roomState payloads) include the resolved content
          task.config = { ...(task.config || {}), resolved: result.resolved, loading: false };
          // Recurse — second pass takes the normal code path since resolved is now set
          try { sendTaskToTeam(room, teamId, index); } catch (e) { console.warn("[currentEvents] re-emit failed:", e?.message); }
        })
        .catch((err) => {
          console.error("[currentEvents] resolver failed:", err?.message);
          // Send a final fallback so the team isn't stuck
          task.config = { ...(task.config || {}), resolved: { eventSummary: "Today's story couldn't be fetched. Discuss any recent news the class has heard related to today's topic.", discussionQuestions: ["What's one news story you've heard this week?", "Could it connect to today's lesson?"], teacherNotes: "Resolver failure fallback.", estimatedMinutes: 8 }, loading: false };
          try { sendTaskToTeam(room, teamId, index); } catch {}
        });

      return; // exit; the recursion will emit the real task
    }

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

    let timeLimitSeconds =
      typeof task.timeLimitSeconds === "number" && task.timeLimitSeconds > 0
        ? task.timeLimitSeconds
        : typeof task.time_limit === "number" && task.time_limit > 0
        ? task.time_limit
        : null;

    // Fallback: 4 minutes when the AI didn't set a timer.
    // TODO: replace with actual per-type average completion times from analytics.
    if (!timeLimitSeconds) {
      timeLimitSeconds = 240;
    }

    // Determine if team is in catch-up mode
    const progress = getRoomTaskProgress(room);
    const isCatchingUp = index < progress.maxJoinedTaskIndex;

    // For PMC tasks: include the next task's station color so PMC can
    // exclude it from the last question's correct-answer color mapping
    let nextStationColor = null;
    if (
      (task.taskType === "physical-multiple-choice") &&
      index + 1 < tasks.length
    ) {
      const nextTask = tasks[index + 1];
      nextStationColor =
        nextTask?.stationColor || nextTask?.config?.stationColor || null;
    }

    // Runtime sanitiser: ensure Connect Four / TF TicTacToe tasks have statements
    // in the top-level `task.statements` array (may be nested in config from older tasks).
    if (task.taskType === "true-false-connect-four" || task.taskType === "true-false-tictactoe") {
      if (!Array.isArray(task.statements) || task.statements.length === 0) {
        const sources = [
          task.config?.statements, task.items, task.config?.items,
          task.clues, task.config?.clues,
        ];
        for (const src of sources) {
          if (Array.isArray(src) && src.length > 0) {
            task.statements = src;
            break;
          }
        }
      }
    }

    // Runtime sanitiser: ensure draw-mime clues are short (1-5 words each, ≥3 chars).
    // Older tasks in the DB may have long instruction text in prompt/clues.
    if (task.taskType === "draw-mime") {
      const MIN_C = 3, MAX_W = 5, MAX_C = 40;
      const STOP = new Set(["i","a","an","the","or","and","of","to","in","on","at","is","it","be","do","no","so","if","up","by","my","we","he","she","me"]);
      const ok = (s) => { const t = (s || "").trim(); return t && t.length >= MIN_C && t.length <= MAX_C && t.split(/\s+/).length <= MAX_W; };
      const instrRe = /^(draw|mime|act|sort|arrange|include|be sure|make|write|read|explain|describe|list|for each|pictures|illustrate|create|show|depict|sketch|put|the following|each|required|label|annotation)/i;
      const extract = (text) => (text || "")
        .split(/[,;\n•\-\d+\.\)]+/)
        .map((s) => s.replace(/^[\s:]+|[\s.!?]+$/g, "").trim())
        .filter((s) => s.length >= MIN_C && s.length <= MAX_C && s.split(/\s+/).length <= MAX_W && !instrRe.test(s))
        .filter((s) => !s.split(/\s+/).every((w) => STOP.has(w.toLowerCase())))
        .slice(0, 4);

      let clues = Array.isArray(task.clues) ? task.clues.map(String).map(s => s.trim()).filter(ok) : [];
      if (!clues.length && task.prompt && ok(task.prompt) && !instrRe.test(task.prompt)) clues = [task.prompt];
      if (!clues.length && task.prompt) clues = extract(task.prompt);
      if (!clues.length && task.title) clues = ok(task.title) && !instrRe.test(task.title) ? [task.title] : extract(task.title);
      if (!clues.length) clues = ["Draw or Mime"];
      task.clues = clues.slice(0, 4);
      task.prompt = task.clues[0];
    }

    // Runtime sanitiser: ensure matching tasks have leftItems/rightItems populated.
    // Older tasks in the DB may have been saved with empty items/options arrays.
    if (task.taskType === "matching") {
      const cfg = task.config && typeof task.config === "object" ? task.config : {};
      const hasLeft = Array.isArray(task.leftItems) && task.leftItems.length > 0;
      const hasRight = Array.isArray(task.rightItems) && task.rightItems.length > 0;

      if (!hasLeft || !hasRight) {
        // Try to extract from config.pairs or config.leftItems/rightItems
        const normItem = (x, prefix, i) => {
          if (typeof x === "string") return { id: `${prefix}${i + 1}`, text: x.trim() };
          if (x && typeof x === "object") {
            const text = String(x.text || x.label || x.term || x.name || x.value || "").trim();
            return { id: String(x.id || `${prefix}${i + 1}`), text };
          }
          return { id: `${prefix}${i + 1}`, text: "" };
        };

        if (Array.isArray(cfg.pairs) && cfg.pairs.length > 0) {
          task.leftItems = cfg.pairs.map((p, i) => ({ id: `L${i + 1}`, text: String(p.left || p.leftLabel || p.term || "").trim() })).filter(x => x.text);
          task.rightItems = cfg.pairs.map((p, i) => ({ id: `R${i + 1}`, text: String(p.right || p.rightLabel || p.definition || "").trim() })).filter(x => x.text);
          const cm = {};
          for (let i = 0; i < Math.min(task.leftItems.length, task.rightItems.length); i++) cm[task.leftItems[i].id] = task.rightItems[i].id;
          task.correctMatches = cm;
        } else if (Array.isArray(cfg.leftItems) && cfg.leftItems.length > 0) {
          task.leftItems = cfg.leftItems.map((x, i) => normItem(x, "L", i)).filter(x => x.text);
          task.rightItems = (Array.isArray(cfg.rightItems) ? cfg.rightItems : []).map((x, i) => normItem(x, "R", i)).filter(x => x.text);
          if (!task.correctMatches || typeof task.correctMatches !== "object") task.correctMatches = {};
        }

        // Pad to at least 5 items so the frontend doesn't show an error
        while (!Array.isArray(task.leftItems)) task.leftItems = [];
        while (!Array.isArray(task.rightItems)) task.rightItems = [];
        while (task.leftItems.length < 5) {
          const i = task.leftItems.length + 1;
          task.leftItems.push({ id: `L${i}`, text: `Term ${i}` });
        }
        while (task.rightItems.length < 5) {
          const i = task.rightItems.length + 1;
          task.rightItems.push({ id: `R${i}`, text: `Definition ${i}` });
        }
        if (!task.correctMatches || typeof task.correctMatches !== "object") {
          task.correctMatches = {};
          for (let i = 0; i < Math.min(task.leftItems.length, task.rightItems.length); i++) {
            task.correctMatches[task.leftItems[i].id] = task.rightItems[i].id;
          }
        }
        console.warn("[roomEngine] Matching task had empty leftItems/rightItems – patched at runtime", { taskId: task._id || task.id });
      }
    }

    // ── Mystery Clues: mark isFinal on the last mystery-clues task in the set ──
    if (task.taskType === "mystery-clues" || task.taskType === "physical-mystery-clues") {
      // Find the last mystery-clues task index in the entire set
      let lastMysteryIdx = -1;
      for (let mi = tasks.length - 1; mi >= 0; mi--) {
        const mt = tasks[mi];
        if (mt && (mt.taskType === "mystery-clues" || mt.taskType === "physical-mystery-clues")) {
          lastMysteryIdx = mi;
          break;
        }
      }
      task.isFinal = (index === lastMysteryIdx);

      // For the final task, compile all clues from earlier mystery-clues tasks
      if (task.isFinal) {
        const allClues = [];
        for (let mi = 0; mi < tasks.length; mi++) {
          const mt = tasks[mi];
          if (mi === index) continue; // skip self
          if (mt && (mt.taskType === "mystery-clues" || mt.taskType === "physical-mystery-clues")) {
            const clues = mt.clues || mt.clueCards || mt.config?.clues || [];
            allClues.push(...clues);
          }
        }
        task.allRevealedClues = allClues; // client can use for verification
      }
    }

    // ── Live Debate: pair teams head-to-head as they ARRIVE at this task ──
    // Self-paced tasksets send tasks per-team, so we pair on arrival: the first
    // team to reach this index waits; the next team to arrive is paired with it
    // (FOR vs AGAINST). Pairing is broadcast via `debate-start` to BOTH teams so
    // the waiting team upgrades from its "waiting for an opponent" screen.
    // Debate state lives on room.debate (shared) so debate-response can enforce
    // turns + score.
    //
    // BOT FALLBACK: If no real opponent arrives within 2 minutes, the waiting
    // team is paired with a 🤖 Practice Bot that AI-plays its turns. That way
    // a lone team or a slow second team never gets stuck on a waiting screen.
    let debateInject = null;
    if (task.taskType === "live-debate" && teamId) {
      if (!room.debateLobbies) room.debateLobbies = {};
      if (!room.debateLobbyTimers) room.debateLobbyTimers = {};
      if (!room.debate) room.debate = {};
      const postulate =
        task.postulate || task.config?.postulate || task.config?.resolution ||
        task.config?.topic || task.prompt || "";
      const turnsPerTeam = Number(task.config?.turnsPerTeam) > 0 ? Number(task.config.turnsPerTeam) : 3;
      const label = (tid) => room.teams[tid]?.teamName || `Team ${String(tid).slice(-4)}`;
      const lobbyKey = String(index);

      // Avatar resolver — real opponents get their themed/team selfie (if
      // they took one), the bot gets Curru's SVG.  Same field name regardless
      // of who's on the other side so the renderer doesn't branch.
      const teamAvatar = (tid) =>
        room.teams[tid]?.themedSelfieUrl ||
        room.teams[tid]?.selfieUrl ||
        null;

      // Already paired at this index (reconnect / catch-up re-send)? Re-attach.
      const existing = Object.values(room.debate).find(
        (d) => d && d.taskId === String(index) &&
          (d.teams?.for?.teamId === teamId || d.teams?.against?.teamId === teamId)
      );
      if (existing) {
        const side = existing.teams.for.teamId === teamId ? "for" : "against";
        const oppSide = side === "for" ? "against" : "for";
        const opp = existing.teams[oppSide];
        debateInject = {
          debateKey: existing.debateKey,
          postulate: existing.postulate,
          mySide: side,
          myTeamName: side === "for" ? existing.teams.for.name : existing.teams.against.name,
          myAvatarUrl: teamAvatar(existing.teams[side].teamId),
          opponentName: opp.name,
          opponentAvatarUrl: opp.isBot ? opp.avatarUrl : teamAvatar(opp.teamId),
          opponentIsBot: !!opp.isBot,
          currentTurn: existing.currentTurn,
          turnsPerTeam: existing.turnsPerTeam,
          awaitingOpponent: false,
          vsBot: !!(existing.teams.for.isBot || existing.teams.against.isBot),
        };
      } else {
        const waitingTeamId = room.debateLobbies[lobbyKey];
        if (waitingTeamId && waitingTeamId !== teamId && room.teams[waitingTeamId]) {
          const forId = waitingTeamId, againstId = teamId;
          const debateKey = `${room.code}:${index}:${forId}-${againstId}`;
          room.debate[debateKey] = {
            debateKey, taskId: String(index), postulate, turnsPerTeam,
            teams: { for: { teamId: forId, name: label(forId) }, against: { teamId: againstId, name: label(againstId) } },
            responses: [], currentTurn: "for", forCount: 0, againstCount: 0,
          };
          // Real opponent showed up — cancel the bot-fallback timer if it
          // was armed for the waiting team.
          if (room.debateLobbyTimers[lobbyKey]) {
            clearTimeout(room.debateLobbyTimers[lobbyKey]);
            delete room.debateLobbyTimers[lobbyKey];
          }
          room.debateLobbies[lobbyKey] = null;
          // Upgrade the WAITING team to paired (it already has the task on screen).
          io.to(forId).emit("debate-start", {
            debateKey, postulate, mySide: "for", myTeamName: label(forId),
            myAvatarUrl: teamAvatar(forId),
            opponentName: label(againstId),
            opponentAvatarUrl: teamAvatar(againstId),
            opponentIsBot: false,
            currentTurn: "for", turnsPerTeam,
          });
          // Embed pairing into THIS team's task:launch so it starts paired.
          debateInject = {
            debateKey, postulate, mySide: "against", myTeamName: label(againstId),
            myAvatarUrl: teamAvatar(againstId),
            opponentName: label(forId),
            opponentAvatarUrl: teamAvatar(forId),
            opponentIsBot: false,
            currentTurn: "for", turnsPerTeam, awaitingOpponent: false,
          };
        } else {
          // No opponent yet → this team waits (client shows a waiting screen).
          // Arm the 2-minute bot-fallback timer.  If a real opponent shows up
          // first, the pairing branch above clears the timer.
          room.debateLobbies[lobbyKey] = teamId;
          if (!room.debateLobbyTimers[lobbyKey]) {
            const armedFor = teamId;
            room.debateLobbyTimers[lobbyKey] = setTimeout(async () => {
              try {
                delete room.debateLobbyTimers[lobbyKey];
                // Re-check: still the same waiting team, still no opponent.
                if (room.debateLobbies?.[lobbyKey] !== armedFor) return;
                if (!room.teams?.[armedFor]) return;
                const { makeBotTeam, autoplayBotIfNeeded, CURRU_AVATAR_URL } = await import("./debateBot.js");
                const { scoreDebateResponses } = await import("./gameHandlers.js");
                const bot = makeBotTeam(`${room.code}-${index}`);
                const debateKey = `${room.code}:${index}:${armedFor}-${bot.teamId}`;
                room.debate[debateKey] = {
                  debateKey,
                  taskId: String(index),
                  postulate,
                  turnsPerTeam,
                  teams: {
                    for:     { teamId: armedFor, name: label(armedFor) },
                    against: { teamId: bot.teamId, name: bot.name, isBot: true, avatarUrl: CURRU_AVATAR_URL },
                  },
                  responses: [],
                  currentTurn: "for",
                  forCount: 0,
                  againstCount: 0,
                };
                room.debateLobbies[lobbyKey] = null;
                io.to(armedFor).emit("debate-start", {
                  debateKey,
                  postulate,
                  mySide: "for",
                  myTeamName: label(armedFor),
                  myAvatarUrl: teamAvatar(armedFor),
                  opponentName: bot.name,
                  opponentAvatarUrl: CURRU_AVATAR_URL,
                  opponentIsBot: true,
                  currentTurn: "for",
                  turnsPerTeam,
                  vsBot: true,
                });
                // Real team speaks first ("for"); the bot autoplay will fire
                // after they submit their first argument. No-op call here for
                // future-proofing in case turn order changes.
                autoplayBotIfNeeded(io, room, debateKey, { scoreDebateResponses, addBonusSubmission: _addBonusSubmission });
              } catch (err) {
                console.warn(`[debate-lobby] bot fallback failed for ${room.code}:${index}:`, err?.message);
              }
            }, 120_000); // 2 minutes
          }
          debateInject = { awaitingOpponent: true, postulate, turnsPerTeam };
        }
      }
    }

    const payload = {
      taskIndex: index, // preferred
      index,            // legacy
      task: {
        ...task,
        minimizeOnScreen: !!room?.minimizeOnScreen || false,
        ...(nextStationColor ? { nextStationColor } : {}),
        ...(debateInject || {}),
      },
      timeLimitSeconds,
      totalTasks: tasks.length,
      catchUp: isCatchingUp,
      catchUpReviewSeconds: isCatchingUp ? 4 : undefined,
    };

    io.to(teamId).emit("task:launch", payload);
    io.to(teamId).emit("task:assigned", payload);
  }

  // ================================
  // Helpers: treats + noise
  // ================================
  function ensureTreatsConfig(room) {
    if (!room.treatsConfig) {
      room.treatsConfig = {
        enabled: true,
        total: 2,
        given: 0,
      };
    }
    if (!room.pendingTreats) {
      room.pendingTreats = {};
    }
    // Track which teams have already received a treat (never same group twice)
    if (!room.treatedTeamIds) {
      room.treatedTeamIds = new Set();
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

    // Never give a treat to the same group more than once per session
    if (room.treatedTeamIds.has(teamId)) return;

    // 30% completion gate — use THIS team's actual progress, not room-level index
    const totalTasks = Array.isArray(room.taskset?.tasks) ? room.taskset.tasks.length : 0;
    const teamCompleted = (() => {
      // Mystery box: count completed boxes for this team
      const tb = room.mysteryBox?.teamBoxes?.[teamId];
      if (tb) return tb.completed?.length || 0;
      // Linear: use team's taskIndex (= number of tasks completed)
      const team = room.teams?.[teamId];
      return typeof team?.taskIndex === "number" ? team.taskIndex : 0;
    })();
    if (totalTasks > 0 && teamCompleted < Math.ceil(totalTasks * 0.3)) return;

    // Simple probability model:
    const remaining = cfg.total - cfg.given;
    const base = Math.min(0.15 * remaining, 0.6); // 0.15, 0.3, 0.45, 0.6...
    const alreadyPending = room.pendingTreats && room.pendingTreats[teamId];
    const chance = alreadyPending ? base * 0.25 : base;

    if (Math.random() > chance) return;

    cfg.given += 1;
    room.pendingTreats[teamId] = true;
    room.treatedTeamIds.add(teamId);

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

  // ================================
  // Scoring Functions
  // ================================
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

  // ================================
  // Noise Control
  // ================================
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
  // Task Advancement
  // ================================
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

  // ================================
  // Flashcards Race Helpers
  // ================================
  function _fcNormalizeAnswer(text) {
    return String(text || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "");
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

  function _fcRecordWinSubmission(room, teamId, taskIndex, cardIndex, answerText, award, card) {
    try {
      if (!room || !room.teams || !room.teams[teamId]) return false;

      const pts = Number(award) || 0;
      if (!Number.isFinite(pts) || pts < 0) return false;

      // Legacy per-team score field (some older UIs still read this)
      const team = room.teams[teamId];
      if (team) {
        team.score = (team.score || 0) + pts;
      }

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

  // ================================
  // RETURN EXPORTED OBJECT
  // ================================
  return {
    // Room storage
    rooms,

    // Teacher instance management
    normalizeTeacherInstanceId,
    pruneTeacherRoomsByInstance,

    // Room creation & station management
    shuffle,
    createRoom,
    reassignStations,
    reassignStationForTeam,

    // Transcript & reporting
    buildTranscript,
    computePerParticipantStats,

    // Room state
    buildRoomState,
    getRoomTaskProgress,

    // Task management
    sendTaskToTeam,
    scheduleNextTask,
    cancelScheduledNextTask,
    advanceTaskNow,

    // Treats & noise
    ensureTreatsConfig,
    isMultiRoomRoom,
    normalizeSlug,
    displayRoomLabel,
    formatGoTo,
    maybeAwardTreat,
    ensureNoiseControl,
    updateNoiseDerivedState,

    // Scoring
    arraysDeepEqual,
    scoreMatchingTask,
    scoreVennSortTask,

    // Flashcards race (internal helpers)
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

    // Constants
    OFFLINE_TIMEOUT_MS,
    NEXT_TASK_DELAY_MS,
    POST_SUBMIT_SECONDS,

    // Keep-alive interval (for cleanup if needed)
    keepAliveInterval,
  };
}

export default createRoomEngine;
