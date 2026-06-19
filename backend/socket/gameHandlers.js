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
 * Rule-based debate scorer (server-side, authoritative). Mirrors the client's
 * coach heuristic: argument length + evidence cues + rebuttal cues per side.
 * Returns per-side scores, the winning side, and points to award each team.
 */
function scoreDebateResponses(responses, turnsPerTeam = 3) {
  const arr = Array.isArray(responses) ? responses : [];
  const evidenceTerms = ["because", "since", "for example", "for instance", "evidence", "research", "studies", "data", "according to"];
  const rebuttalTerms = ["however", "but", "in contrast", "on the other hand", "actually", "while", "whereas"];
  const sides = { for: 0, against: 0 };
  for (const r of arr) {
    const side = r?.side === "against" ? "against" : "for";
    const text = String(r?.text || "").trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    const words = text.split(/\s+/).filter(Boolean).length;
    const lengthScore = Math.min(20, Math.floor(words / 3));
    const ev = evidenceTerms.reduce((s, t) => s + (lower.includes(t) ? 1 : 0), 0);
    const rb = rebuttalTerms.reduce((s, t) => s + (lower.includes(t) ? 1 : 0), 0);
    sides[side] += lengthScore + ev * 5 + rb * 3;
  }
  const winningSide = sides.for === sides.against ? "tie" : (sides.for > sides.against ? "for" : "against");
  // Participation points scale with quality; winner gets a bonus.
  const PARTICIPATION = 10;
  const WINNER_BONUS = 15;
  const quality = (n) => Math.max(0, Math.min(20, Math.round(n / 3)));
  const award = {
    for: PARTICIPATION + quality(sides.for) + (winningSide === "for" ? WINNER_BONUS : 0),
    against: PARTICIPATION + quality(sides.against) + (winningSide === "against" ? WINNER_BONUS : 0),
  };
  return { forScore: sides.for, againstScore: sides.against, winningSide, award };
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
function registerGameHandlers(socket, { io, rooms, updateTeamScore, addBonusSubmission, generateAIScore, buildRoomState }) {

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

    // Prefer the SHARED debate state stored on the room (set by teacherLaunchTask
    // when it pairs teams). Fall back to the per-connection `debates` map (legacy
    // start-live-debate path).
    const room = rooms[code];
    const debateKey = data.debateKey || `${code}:${data.taskId || "default"}:0`;
    const debate =
      (room?.debate && room.debate[debateKey]) ||
      debates[debateKey] ||
      debates[`${code}:${data.taskId || "default"}`];

    if (debate) {
      const { side, text, speaker } = data;
      const turnsPerTeam = debate.turnsPerTeam || 3;

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

      const payload = {
        ...entry,
        currentTurn: debate.currentTurn,
        forCount: debate.forCount,
        againstCount: debate.againstCount,
      };

      // Broadcast ONLY to the two paired teams (isolates concurrent pairs in the
      // same room). Falls back to room-wide if we don't know the team ids.
      const forId = debate.teams?.for?.teamId;
      const againstId = debate.teams?.against?.teamId;
      if (forId && againstId) {
        io.to(forId).emit("debate-new-response", payload);
        io.to(againstId).emit("debate-new-response", payload);
      } else {
        io.to(code).emit("debate-new-response", payload);
      }

      // If the new current turn belongs to a 🤖 Practice Bot, kick it off.
      // The bot helper inserts a ~3s "thinking" pause before its response.
      const nextMeta = debate.teams?.[debate.currentTurn];
      if (nextMeta?.isBot) {
        try {
          const { autoplayBotIfNeeded } = await import("./debateBot.js");
          autoplayBotIfNeeded(io, room, debateKey, {
            scoreDebateResponses,
            addBonusSubmission,
          });
        } catch (botErr) {
          console.warn("[debate-response] bot autoplay start failed:", botErr?.message);
        }
      }

      // Check if debate is over (both teams used all turns)
      if (debate.forCount >= turnsPerTeam && debate.againstCount >= turnsPerTeam) {
        // Server-side scoring (authoritative). Award points to BOTH teams and
        // surface the verdict so the client can show who won + standings.
        const verdict = scoreDebateResponses(debate.responses, turnsPerTeam);
        const forName = debate.teams?.for?.name;
        const againstName = debate.teams?.against?.name;
        const awarded = {};
        if (typeof addBonusSubmission === "function" && room) {
          if (forId && verdict.award.for > 0) {
            addBonusSubmission(room, forId, verdict.award.for, "live-debate", {
              side: "for", winningSide: verdict.winningSide, postulate: debate.postulate,
            });
            awarded[forId] = verdict.award.for;
          }
          if (againstId && verdict.award.against > 0) {
            addBonusSubmission(room, againstId, verdict.award.against, "live-debate", {
              side: "against", winningSide: verdict.winningSide, postulate: debate.postulate,
            });
            awarded[againstId] = verdict.award.against;
          }
        }
        const completePayload = {
          taskId: debate.taskId,
          responses: debate.responses,
          postulate: debate.postulate,
          winningSide: verdict.winningSide,
          forScore: verdict.forScore,
          againstScore: verdict.againstScore,
          forTeamName: forName,
          againstTeamName: againstName,
          awarded,
        };
        if (forId && againstId) {
          io.to(forId).emit("debate-complete", completePayload);
          io.to(againstId).emit("debate-complete", completePayload);
        } else {
          io.to(code).emit("debate-complete", completePayload);
        }
        // Refresh the live scoreboard for the whole room.
        try {
          const rs = buildRoomState && buildRoomState(room);
          if (rs) io.to(code).emit("roomState", rs);
        } catch {}
        if (room?.debate) delete room.debate[debateKey];
        delete debates[debateKey];
      }
    } else {
      // No tracked state — just broadcast (fallback for legacy)
      io.to(code).emit("debate-new-response", data);
    }
  });
}

export { registerGameHandlers, scoreDebateResponses };
export default registerGameHandlers;
