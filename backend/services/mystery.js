// backend/services/mystery.js
//
// Whodunnit engine — suspect assignment, accusation arbitration, anti-toxicity guards.
// Real-gameplay-driven clue generation is in a follow-up (uses the existing event log).
//
// Locked-in safety constraints from WHODUNNIT_PLAN.md §11:
//   - theme labels restricted to spy/saboteur/infiltrator/smuggler/double-agent
//   - wrong accusations NEVER publicly name the accused
//   - suspect identity NEVER leaks to non-suspect sockets
//   - identity clue properties restricted to (first letter / length / team color)
import MysterySession from "../models/MysterySession.js";

/**
 * Enable the mystery layer for a room. Picks a random player from the room's teams.
 * Returns { ok, session, suspectPlayerId } — caller MUST emit `mystery:youAreSuspect`
 * to the suspect's socket only.
 */
export async function enableMystery({ roomCode, room, themeRole = "spy", difficulty = "medium" }) {
  const code = String(roomCode || "").toUpperCase();
  if (!code || !room) return { ok: false, error: "Missing roomCode/room" };

  // Collect all distinct player names across all teams. For MVP we use player names
  // as the suspect identifier; a real Player model could later be passed in.
  const allPlayers = [];
  for (const team of Object.values(room.teams || {})) {
    const members = Array.isArray(team?.members) ? team.members : [];
    for (const m of members) {
      const name = typeof m === "string" ? m : m?.name || m?.playerName;
      if (typeof name === "string" && name.trim()) allPlayers.push(name.trim());
    }
  }
  if (allPlayers.length < 2) {
    return { ok: false, error: "Need at least 2 players to enable Whodunnit" };
  }
  const suspectPlayerId = allPlayers[Math.floor(Math.random() * allPlayers.length)];

  // Upsert per-room session — replace any existing one so a teacher can re-enable freshly.
  const session = await MysterySession.findOneAndUpdate(
    { roomCode: code },
    {
      roomCode: code,
      enabled: true,
      themeRole,
      difficulty,
      suspectPlayerId,
      suspectAssignedAt: new Date(),
      cluesReleased: [],
      cluesPurchasedByTeam: new Map(),
      accusations: [],
      ended: false,
      endedAt: null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return { ok: true, session, suspectPlayerId };
}

export async function getSession(roomCode) {
  const code = String(roomCode || "").toUpperCase();
  if (!code) return null;
  return MysterySession.findOne({ roomCode: code });
}

/**
 * Snapshot for non-teacher sockets. CRITICALLY omits `suspectPlayerId` — the
 * teacher dashboard uses `getTeacherSnapshot` instead.
 */
export function getPublicSnapshot(session) {
  if (!session) return null;
  return {
    enabled:    !!session.enabled,
    themeRole:  session.themeRole,
    difficulty: session.difficulty,
    cluesReleased: session.cluesReleased || [],
    accusationsHistory: (session.accusations || []).map((a) => ({
      teamId: a.teamId,
      correct: a.correct,
      ts: a.ts,
    })),
    ended: !!session.ended,
  };
}

export function getTeacherSnapshot(session) {
  if (!session) return null;
  return {
    ...getPublicSnapshot(session),
    suspectPlayerId: session.suspectPlayerId,
    cluesPurchasedByTeam: session.cluesPurchasedByTeam instanceof Map
      ? Object.fromEntries(session.cluesPurchasedByTeam)
      : (session.cluesPurchasedByTeam || {}),
    accusations: session.accusations || [],
  };
}

/**
 * Submit an accusation. Applies all anti-toxicity guards:
 *   - max accusations per team
 *   - cooldown since this team's last accusation
 *   - server-arbitrated correctness (suspectPlayerId never crosses the wire)
 *
 * Returns: { ok: true, correct, suspectRevealed?: string, penalty? } — `suspectRevealed`
 * is ONLY filled when correct=true (whole-class reveal moment).
 */
export async function submitAccusation({ roomCode, teamId, accusedPlayerId }) {
  const code = String(roomCode || "").toUpperCase();
  if (!code || !teamId || !accusedPlayerId) return { ok: false, error: "Missing fields" };
  const session = await getSession(code);
  if (!session || !session.enabled) return { ok: false, error: "Mystery not active" };
  if (session.ended) return { ok: false, error: "Round already over" };

  const cap = session.accusationConfig?.maxAccusationsPerTeam ?? 2;
  const cooldownMs = session.accusationConfig?.accusationCooldownMs ?? 5 * 60 * 1000;
  const teamPast = (session.accusations || []).filter((a) => a.teamId === teamId);
  if (teamPast.length >= cap) {
    return { ok: false, error: `Team has used max accusations (${cap})` };
  }
  const lastTs = teamPast[teamPast.length - 1]?.ts;
  if (lastTs && Date.now() - new Date(lastTs).getTime() < cooldownMs) {
    const remainSec = Math.ceil((cooldownMs - (Date.now() - new Date(lastTs).getTime())) / 1000);
    return { ok: false, error: `Accusation cooldown (${remainSec}s remaining)` };
  }

  const correct = String(accusedPlayerId).trim().toLowerCase() === String(session.suspectPlayerId).trim().toLowerCase();
  const reward = correct ? (session.accusationConfig?.correctReward ?? 200) : 0;
  const penalty = correct ? 0 : (session.accusationConfig?.wrongPenalty ?? 30);

  await MysterySession.findOneAndUpdate(
    { roomCode: code },
    {
      $push: {
        accusations: { teamId, accusedPlayerId, correct, ts: new Date() },
      },
      ...(correct ? { $set: { ended: true, endedAt: new Date() } } : {}),
    },
  );

  return {
    ok: true,
    correct,
    reward,
    penalty,
    suspectRevealed: correct ? session.suspectPlayerId : null,
  };
}

/**
 * Teacher-only: end the round and reveal the suspect to everyone (kill-switch).
 */
export async function endRound({ roomCode, reason = "teacher-ended" }) {
  const code = String(roomCode || "").toUpperCase();
  const session = await MysterySession.findOneAndUpdate(
    { roomCode: code },
    { $set: { ended: true, endedAt: new Date() } },
    { new: true },
  );
  if (!session) return { ok: false };
  return { ok: true, reason, suspectPlayerId: session.suspectPlayerId };
}

export default { enableMystery, getSession, getPublicSnapshot, getTeacherSnapshot, submitAccusation, endRound };
