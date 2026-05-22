// backend/controllers/overlayReportSummary.js
//
// Builds the `overlayModeSummary` block that ships with every SessionReport
// snapshot. Reads the three overlay state collections (EscapeRoom, Mystery,
// Quest) and condenses each into a small per-team summary suitable for the
// PDF report + the email body.
//
// All three blocks are independently optional. A session that had no overlay
// in play returns the shape { active: false } so the renderer can render
// nothing without extra null-checks.
import EscapeRoomTeamState from "../models/EscapeRoomTeamState.js";
import MysterySession from "../models/MysterySession.js";
import TeamQuestState from "../models/TeamQuestState.js";

const safe = (v, dflt = "") => (v == null ? dflt : v);

/**
 * Returns:
 * {
 *   active: boolean,                  // true iff any overlay was on
 *   escapeRoom?: { enabled, teams[], finalCipherStatus, durationMs },
 *   whodunnit?:  { enabled, suspectName, accusations: { correct[], incorrect[] }, totalClues },
 *   quest?:      { enabled, teams[], unlockedBonus, unlockedHidden },
 * }
 */
export async function buildOverlayModeSummary({ taskset, room, roomCode }) {
  const teamsMap = (room && typeof room.teams === "object" && room.teams) || {};
  const teamName = (teamId) => {
    const t = teamsMap[teamId] || {};
    return safe(t.teamName || t.name || `Team-${String(teamId || "").slice(-4)}`);
  };

  const out = { active: false };

  // ── Escape Room ───────────────────────────────────────────────────────────
  try {
    const escapeEnabled =
      !!(taskset?.escapeRoomEnabled || taskset?.escapeRoom?.enabled || room?.escapeRoomActive);
    if (escapeEnabled) {
      const states = await EscapeRoomTeamState.find({ roomCode }).lean().exec();
      const teamSummaries = states.map((s) => {
        const keys = (s.keysEarned || []).length;
        const fragments = (s.fragmentsEarned || []).length;
        const opened = (s.locksOpened || []).length;
        const done = !!s.completedAt;
        return {
          teamId: s.teamId,
          teamName: teamName(s.teamId),
          keysEarned: keys,
          fragmentsEarned: fragments,
          locksOpened: opened,
          hintsUsed: s.hintsUsed || 0,
          escaped: done,
          escapeTimeMs: s.escapeTimeMs || null,
        };
      });
      const someoneEscaped = teamSummaries.some((t) => t.escaped);
      out.active = true;
      out.escapeRoom = {
        enabled: true,
        themeName: safe(taskset?.escapeRoom?.themeName || taskset?.escapeTheme || ""),
        teams: teamSummaries,
        anyEscaped: someoneEscaped,
        finalCipherStatus: someoneEscaped ? "cracked" : "in-progress",
      };
    }
  } catch (e) {
    // never block a report on overlay enrichment
    out.escapeRoom = { enabled: true, error: String(e?.message || e) };
  }

  // ── Whodunnit (Mystery) ───────────────────────────────────────────────────
  try {
    const mysteryEnabled = !!(taskset?.whodunnitEnabled || taskset?.mysteryEnabled || room?.mysteryActive);
    if (mysteryEnabled) {
      const m = await MysterySession.findOne({ roomCode }).lean().exec();
      if (m) {
        const suspectId = m.suspectPlayerId;
        let suspectName = "(unknown)";
        for (const team of Object.values(teamsMap)) {
          const players = (team && Array.isArray(team.players) ? team.players : []) || [];
          const hit = players.find((p) => String(p?.id || p?._id) === String(suspectId));
          if (hit) {
            suspectName = safe(hit.name || hit.displayName || hit.studentName, "(unnamed player)");
            break;
          }
        }
        const accusations = Array.isArray(m.accusations) ? m.accusations : [];
        const correct = accusations.filter((a) => a.correct).map((a) => teamName(a.teamId));
        const incorrect = accusations.filter((a) => !a.correct).map((a) => teamName(a.teamId));
        out.active = true;
        out.whodunnit = {
          enabled: true,
          themeRole: m.themeRole || "spy",
          difficulty: m.difficulty || "medium",
          suspectName,
          suspectPlayerId: String(suspectId),
          accusations: { correct, incorrect },
          totalClues: Array.isArray(m.clues) ? m.clues.length : 0,
        };
      } else {
        out.whodunnit = { enabled: true, missingState: true };
      }
    }
  } catch (e) {
    out.whodunnit = { enabled: true, error: String(e?.message || e) };
  }

  // ── LevelUp summary ──────────────────────────────────────────────────────
  try {
    const luState = room?.levelUpState || {};
    const luTeams = Object.entries(luState)
      .filter(([, st]) => Array.isArray(st?.history) && st.history.length > 0)
      .map(([tid, st]) => {
        const upgrades = st.history.map((h) => ({
          originalTaskIndex: h.originalTaskIndex,
          originalScore: h.originalScore,
          retryScore: h.retryScore,
          kept: h.kept,
          improved: !!h.improved,
          masteryBonus: h.masteryBonus || 0,
        }));
        const improvedCount = upgrades.filter((u) => u.improved).length;
        return {
          teamId: tid,
          teamName: teamName(tid),
          attempts: Number(st.attempts) || upgrades.length,
          improvedCount,
          totalMasteryBonus: upgrades.reduce((a, u) => a + (u.masteryBonus || 0), 0),
          upgrades,
        };
      });
    if (luTeams.length) {
      out.active = true;
      out.levelUp = {
        enabled: true,
        teams: luTeams,
        totalAttempts: luTeams.reduce((a, t) => a + t.attempts, 0),
        totalImproved: luTeams.reduce((a, t) => a + t.improvedCount, 0),
      };
    }
  } catch (e) {
    out.levelUp = { enabled: true, error: String(e?.message || e) };
  }

  // ── Quest Mode ────────────────────────────────────────────────────────────
  try {
    const questEnabled = !!(taskset?.questModeEnabled || taskset?.questMode?.enabled);
    if (questEnabled) {
      const states = await TeamQuestState.find({ roomCode }).lean().exec();
      const teamSummaries = states.map((s) => ({
        teamId: s.teamId,
        teamName: teamName(s.teamId),
        coinsEarned: Number(s.coinsEarned || s.totalCoins || 0),
        coinsSpent: Number(s.coinsSpent || 0),
        unlockedBonus: Array.isArray(s.bonusTasksUnlocked) ? s.bonusTasksUnlocked.length : 0,
        unlockedHidden: Array.isArray(s.hiddenTasksUnlocked) ? s.hiddenTasksUnlocked.length : 0,
        trades: Array.isArray(s.trades) ? s.trades.length : 0,
      }));
      out.active = true;
      out.quest = {
        enabled: true,
        teams: teamSummaries,
        totalBonusUnlocked: teamSummaries.reduce((a, t) => a + t.unlockedBonus, 0),
        totalHiddenUnlocked: teamSummaries.reduce((a, t) => a + t.unlockedHidden, 0),
      };
    }
  } catch (e) {
    out.quest = { enabled: true, error: String(e?.message || e) };
  }

  return out;
}

/**
 * Plain-text one-line summary suitable for the email subject or top of the
 * email body. Returns "" if no overlay was active.
 */
export function overlayHeadline(overlay) {
  if (!overlay || !overlay.active) return "";
  const bits = [];
  if (overlay.escapeRoom?.enabled) {
    const t = overlay.escapeRoom.teams || [];
    const escaped = t.filter((x) => x.escaped).length;
    bits.push(`Escape Room: ${escaped}/${t.length} team(s) escaped`);
  }
  if (overlay.whodunnit?.enabled && overlay.whodunnit.suspectName) {
    const c = overlay.whodunnit.accusations?.correct?.length || 0;
    bits.push(`Whodunnit: suspect was ${overlay.whodunnit.suspectName} (${c} correct accusations)`);
  }
  if (overlay.quest?.enabled) {
    bits.push(`Quest Mode: ${overlay.quest.totalBonusUnlocked + overlay.quest.totalHiddenUnlocked} extra task(s) unlocked`);
  }
  if (overlay.levelUp?.enabled) {
    bits.push(`LevelUp: ${overlay.levelUp.totalImproved}/${overlay.levelUp.totalAttempts} retries improved`);
  }
  return bits.join(" · ");
}
