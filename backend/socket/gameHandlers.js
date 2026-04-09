/**
 * Game and specialized socket handlers for Curriculate
 * Extracted from index.js to separate concerns and improve modularity
 */

// Global state for game handlers
const raceWinner = {};
const teamClues = new Map(); // Store for mystery clues by teamId

/**
 * Helper function: Check if two arrays are deeply equal
 */
function arraysDeepEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (e) {
    return false;
  }
}

/**
 * Helper function: Shuffle array
 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Helper function: Get or create collaboration state for a task
 */
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

/**
 * Helper function: Get or create Tic-Tac-Toe game state
 */
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

/**
 * Register all game and specialized socket handlers
 * @param {Socket} socket - Socket.io socket instance
 * @param {Object} context - Injected context
 * @param {Object} context.io - Socket.io instance
 * @param {Object} context.rooms - Rooms map
 * @param {Function} context.updateTeamScore - Function to update team scores
 * @param {Function} context.generateAIScore - Function to generate AI score
 * @param {Function} context.buildRoomState - Function to build room state
 */
function registerGameHandlers(socket, { io, rooms, updateTeamScore, generateAIScore, buildRoomState }) {

  // ─────────────────────────────────────────────
  // Speed Draw (race-based, first correct wins)
  // ─────────────────────────────────────────────
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

  // ──────────────────────────────────────────────────────────────
  // Collaboration task: Random pairing + bonus for quality replies
  // Current team model: room.teams = { [teamId]: { teamName, members, ... } }
  // Uses teamId socket rooms (socket.join(teamId) already happens on join)
  // ──────────────────────────────────────────────────────────────

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
  // Live debate (teamId-based, alternating turns)
  // ─────────────────────────────────────────────
  // In-memory debate state keyed by "roomCode:taskId"
  const debates = {};

  socket.on("start-live-debate", ({ roomCode, postulate, taskId }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) return;

    const teamIds = Object.keys(room.teams || {});
    if (teamIds.length === 0) return;

    const ordered = shuffle(teamIds);
    const tid = taskId || "default";

    // Pair teams up: [0,1], [2,3], [4,5], ...
    // Any leftover odd team gets no mySide → client runs intra-team mode
    for (let i = 0; i + 1 < ordered.length; i += 2) {
      const forTeamId = ordered[i];
      const againstTeamId = ordered[i + 1];
      const pairIndex = Math.floor(i / 2);
      const debateKey = `${code}:${tid}:${pairIndex}`;

      // Track debate state for this pair
      debates[debateKey] = {
        roomCode: code,
        taskId: tid,
        postulate,
        teams: {
          for: { teamId: forTeamId, name: room.teams[forTeamId]?.teamName || `Team-${String(forTeamId).slice(-4)}` },
          against: { teamId: againstTeamId, name: room.teams[againstTeamId]?.teamName || `Team-${String(againstTeamId).slice(-4)}` },
        },
        responses: [],
        currentTurn: "for",
        turnsPerTeam: 3,
        forCount: 0,
        againstCount: 0,
      };

      // Notify each paired team with their side assignment
      [forTeamId, againstTeamId].forEach((teamId) => {
        const side = teamId === forTeamId ? "for" : "against";
        const team = room.teams[teamId];
        const opponentId = side === "for" ? againstTeamId : forTeamId;
        const opponent = room.teams[opponentId];
        io.to(teamId).emit("debate-start", {
          type: "live-debate",
          taskId: tid,
          debateKey,
          postulate,
          mySide: side,
          myTeamId: teamId,
          myTeamName: team?.teamName || `Team-${String(teamId).slice(-4)}`,
          opponentName: opponent?.teamName || `Team-${String(opponentId).slice(-4)}`,
          teamMembers: Array.isArray(team?.members) && team.members.length > 0
            ? team.members
            : ["Member 1", "Member 2", "Member 3"],
          responses: [],
          currentTurn: "for",
          turnsPerTeam: 3,
        });
      });
    }

    // Odd team out: no opponent — emit without mySide so client runs intra-team
    if (ordered.length % 2 === 1) {
      const soloTeamId = ordered[ordered.length - 1];
      const team = room.teams[soloTeamId];
      io.to(soloTeamId).emit("debate-start", {
        type: "live-debate",
        taskId: tid,
        postulate,
        // mySide intentionally omitted → client detects solo mode
        myTeamId: soloTeamId,
        myTeamName: team?.teamName || `Team-${String(soloTeamId).slice(-4)}`,
        teamMembers: Array.isArray(team?.members) && team.members.length > 0
          ? team.members
          : ["Member 1", "Member 2", "Member 3"],
        responses: [],
        turnsPerTeam: 3,
      });
    }
  });

  socket.on("debate-response", async (data = {}) => {
    const code = (data.roomCode || "").toUpperCase();
    if (!code) return;

    // Try the explicit debateKey from the client first, then fall back to legacy format
    const debateKey = data.debateKey || `${code}:${data.taskId || "default"}:0`;
    const debate = debates[debateKey] || debates[`${code}:${data.taskId || "default"}`];

    if (debate) {
      const { side, text, speaker } = data;

      // Enforce turn order — reject if it's not this team's turn
      if (side !== debate.currentTurn) {
        socket.emit("debate-error", { message: "It's not your team's turn yet!" });
        return;
      }

      const turnNumber = side === "for" ? debate.forCount : debate.againstCount;
      const entry = { side, teamName: data.teamName, speaker, text, turnNumber };
      debate.responses.push(entry);

      if (side === "for") debate.forCount++;
      else debate.againstCount++;

      // Alternate turns
      debate.currentTurn = debate.currentTurn === "for" ? "against" : "for";

      // Broadcast the new response + updated turn to the whole room
      io.to(code).emit("debate-new-response", {
        ...entry,
        currentTurn: debate.currentTurn,
        forCount: debate.forCount,
        againstCount: debate.againstCount,
      });

      // Check if debate is over (both teams used all turns)
      if (debate.forCount >= debate.turnsPerTeam && debate.againstCount >= debate.turnsPerTeam) {
        io.to(code).emit("debate-complete", {
          taskId: debate.taskId,
          responses: debate.responses,
          postulate: debate.postulate,
        });
        delete debates[debateKey];
      }
    } else {
      // No tracked state — just broadcast (fallback for legacy)
      io.to(code).emit("debate-new-response", data);
    }
  });
}

export { registerGameHandlers };
export default registerGameHandlers;
