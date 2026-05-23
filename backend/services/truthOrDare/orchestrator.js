// backend/services/truthOrDare/orchestrator.js
//
// Server-side round state machine for Truth-or-Dare. The server is the
// single source of truth — clients only receive snapshots via `tod:state`
// and transition events. All transitions are idempotent: duplicate teacher
// "next" clicks (or any other input) are no-ops once a phase has advanced.
//
// State machine (see TRUTH_OR_DARE_PLAN.md §6):
//   IDLE → SELECTING → CHOOSING → REVEALING → PERFORMING → JUDGING
//        → REWARDING → COOLDOWN → SELECTING (next round) or IDLE (end)
//
// Each room has at most ONE active T-or-D session at a time. The
// orchestrator is held in-memory in a Map keyed by roomCode; persistence
// to MongoDB is async (fire-and-forget on critical events).

import crypto from "node:crypto";
import { generateChallenge } from "./generator.js";
import {
  selectNextTeam, buildSpinReel, applyCooldown,
  escalateTier, demoteTier,
} from "./selector.js";
import { rememberChallenge } from "./recentChallenges.js";

const PHASES = Object.freeze({
  IDLE:       "idle",
  SELECTING:  "selecting",
  CHOOSING:   "choosing",
  REVEALING:  "revealing",
  PERFORMING: "performing",
  JUDGING:    "judging",
  REWARDING:  "rewarding",
  COOLDOWN:   "cooldown",
  ENDED:      "ended",
});

const PHASE_DURATIONS_MS = {
  [PHASES.SELECTING]:  3500,
  [PHASES.CHOOSING]:   10000,
  [PHASES.REVEALING]:  5000,
  // PERFORMING — variable, per-challenge
  [PHASES.JUDGING]:    8000,
  [PHASES.REWARDING]:  4000,
  [PHASES.COOLDOWN]:   2000,
};

// In-memory orchestrators keyed by roomCode
const _rooms = new Map();

/**
 * Create a new orchestrator for a room. Replaces any existing one (with a
 * teardown notice).
 *
 * @param {object} opts
 *   - roomCode (string)
 *   - sessionId (string)
 *   - mode (string)
 *   - config (object)
 *   - teams ([{ teamId, playerName, score }])
 *   - totalRounds (number, default 8)
 *   - emit (function (event, payload)) — server-side socket emitter
 *   - persist (function (state)) — async DB persistence hook
 * @returns Orchestrator
 */
export function createOrchestrator(opts) {
  const { roomCode } = opts;
  if (!roomCode) throw new Error("orchestrator requires roomCode");
  if (_rooms.has(roomCode)) {
    const prior = _rooms.get(roomCode);
    try { prior.stop("replaced"); } catch {}
  }
  const o = new Orchestrator(opts);
  _rooms.set(roomCode, o);
  return o;
}

export function getOrchestrator(roomCode) {
  return _rooms.get(roomCode) || null;
}

export function destroyOrchestrator(roomCode) {
  const o = _rooms.get(roomCode);
  if (o) {
    try { o.stop("destroyed"); } catch {}
    _rooms.delete(roomCode);
  }
}

class Orchestrator {
  constructor({ roomCode, sessionId, mode, config, teams, totalRounds, emit, persist }) {
    this.roomCode = String(roomCode).toUpperCase();
    this.sessionId = sessionId || null;
    this.mode = mode || "individual";
    this.config = config || {};
    this.teams = Array.isArray(teams) ? teams.slice() : [];
    this.totalRounds = Math.max(1, Math.min(20, Number(totalRounds) || 8));
    this.emit = typeof emit === "function" ? emit : () => {};
    this.persist = typeof persist === "function" ? persist : async () => {};

    this.phase = PHASES.IDLE;
    this.roundIndex = -1;
    this.selectedTeamId = "";
    this.selectedPlayerName = "";
    this.choice = null;
    this.challenge = null;
    this.challengeQueue = []; // pre-generated challenges
    this.cooldownsBy = new Map();
    this.tierByTeam = new Map();
    this.successesByTeam = new Map();
    this.participationByTeam = new Map(); // teamId → roundsSinceParticipated
    this.lastReactionByTeam = new Map();  // teamId → roundsSinceReacted
    this.audienceVotes = new Map();       // teamId → "pass"|"fail"|"retry"
    this.audienceReactions = [];          // recent emoji floats
    this.stealAttemptedBy = "";
    this.stealVerdict = null;
    this.stopped = false;
    this._timers = new Set();
    this._performStartedAt = 0;
    this._performEndedAt = 0;
    this._roundLog = [];
    this._teacherPeekApproved = false;
    this._performTimeBudgetMs = 30000;
  }

  // -------- lifecycle --------

  async start() {
    if (this.stopped) return;
    // Pre-generate first challenge in background
    this._refillQueue().catch(() => {});
    await this._enterPhase(PHASES.SELECTING);
  }

  stop(reason = "stop") {
    this.stopped = true;
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
    this.phase = PHASES.ENDED;
    this._broadcastState({ reason });
    this.emit("tod:session:end", { summary: this._buildSummary(), reason });
  }

  // -------- phase machine --------

  async _enterPhase(next, payload = {}) {
    if (this.stopped) return;
    this.phase = next;

    if (next === PHASES.SELECTING) {
      this.roundIndex += 1;
      if (this.roundIndex >= this.totalRounds) {
        this.stop("complete");
        return;
      }
      await this._handleSelecting();
    } else if (next === PHASES.CHOOSING) {
      this._handleChoosing();
    } else if (next === PHASES.REVEALING) {
      await this._handleRevealing();
    } else if (next === PHASES.PERFORMING) {
      this._handlePerforming();
    } else if (next === PHASES.JUDGING) {
      this._handleJudging();
    } else if (next === PHASES.REWARDING) {
      this._handleRewarding(payload);
    } else if (next === PHASES.COOLDOWN) {
      this._handleCooldown();
    }

    this._broadcastState();
    this._persistAsync();
  }

  // -------- handlers --------

  async _handleSelecting() {
    // Compute candidates with participation/score/reaction context
    const candidates = this.teams.map((t) => ({
      teamId: t.teamId,
      playerName: t.playerName || "",
      score: t.score || 0,
      roundsSinceParticipated: this.participationByTeam.get(t.teamId),
      roundsSinceReacted:      this.lastReactionByTeam.get(t.teamId),
    }));
    const { teamId, playerName, ranking } = selectNextTeam(candidates, {
      currentRound: this.roundIndex,
      cooldownsBy: this.cooldownsBy,
      quietMode: this.config.quietMode === true,
      forceTeamId: this._forceTeamId || null,
    });
    this._forceTeamId = null;
    this.selectedTeamId = teamId;
    this.selectedPlayerName = playerName;

    // Slot-machine reel + spin animation
    const reel = buildSpinReel(candidates, teamId);
    this.emit("tod:spotlight:spin", {
      candidateTeamIds: ranking.map((r) => r.teamId),
      durationMs: PHASE_DURATIONS_MS[PHASES.SELECTING],
      reel,
    });

    this._scheduleTimer(PHASE_DURATIONS_MS[PHASES.SELECTING], () => {
      this.emit("tod:spotlight:land", { teamId, playerName });
      this._enterPhase(PHASES.CHOOSING).catch(() => {});
    });
  }

  _handleChoosing() {
    this.choice = null;
    this._scheduleTimer(PHASE_DURATIONS_MS[PHASES.CHOOSING], () => {
      if (this.phase !== PHASES.CHOOSING) return;
      // Default: 50/50 random truth/dare if no input received
      this.choice = Math.random() < 0.5 ? "truth" : "dare";
      this._enterPhase(PHASES.REVEALING).catch(() => {});
    });
  }

  async _handleRevealing() {
    // Pop a challenge matching the current choice & team tier
    const tier = this.tierByTeam.get(this.selectedTeamId) || "sprout";
    const kindHint = (this.choice === "double-dare" ? "dare" : this.choice) || "either";
    let challenge = this._popQueuedChallenge({ tier, kindHint });
    if (!challenge) {
      const { challenge: gen } = await generateChallenge({
        roomCode: this.roomCode,
        subject: this.config.subject,
        unitName: this.config.unitName,
        gradeLevel: this.config.gradeLevel,
        tier,
        kindHint,
        physicalIntensityMax: this.config.physicalIntensityMax,
        socialIntensityMax: this.config.socialIntensityMax,
        movementAllowed: this.config.movementAllowed,
        noiseAllowed: this.config.noiseAllowed,
        worldview: this.config.worldview,
      });
      challenge = gen;
    }

    // Double-dare bumps the reward but keeps the same prompt — flag it
    if (this.choice === "double-dare") {
      challenge = { ...challenge, rewardTier: "large", _doubleDare: true };
    }

    this.challenge = challenge;
    this._performTimeBudgetMs = Math.max(15, Math.min(90, challenge.timeSeconds || 30)) * 1000;

    // Refill queue in the background for the NEXT round
    this._refillQueue().catch(() => {});

    // Teacher peek (1.5s) before student broadcast — sent only to teacher
    this.emit("tod:challenge:ready", { challenge, roundIndex: this.roundIndex });
    this._scheduleTimer(1500, () => {
      // If teacher didn't override during peek, broadcast to all
      if (this.phase !== PHASES.REVEALING) return;
      this._broadcastReveal();
    });
  }

  _broadcastReveal() {
    if (this.stopped || this.phase !== PHASES.REVEALING) return;
    const startsAt = Date.now() + PHASE_DURATIONS_MS[PHASES.REVEALING];
    this.emit("tod:challenge:reveal", {
      challenge: this.challenge,
      startsAt,
      timeBudgetMs: this._performTimeBudgetMs,
    });
    this._scheduleTimer(PHASE_DURATIONS_MS[PHASES.REVEALING], () => {
      this._enterPhase(PHASES.PERFORMING).catch(() => {});
    });
  }

  _handlePerforming() {
    this._performStartedAt = Date.now();
    this._performEndedAt = 0;
    this.audienceReactions = [];
    this.audienceVotes = new Map();
    this.stealAttemptedBy = "";

    // 1Hz tick
    const tickEvery = 1000;
    const startedAt = this._performStartedAt;
    const budget = this._performTimeBudgetMs;
    const tickFn = () => {
      if (this.phase !== PHASES.PERFORMING) return;
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, budget - elapsed);
      this.emit("tod:perform:tick", { msRemaining: remaining });
      if (remaining <= 0) {
        this._performEndedAt = Date.now();
        this._enterPhase(PHASES.JUDGING).catch(() => {});
      } else {
        this._scheduleTimer(tickEvery, tickFn);
      }
    };
    this._scheduleTimer(tickEvery, tickFn);
  }

  _handleJudging() {
    // Open class vote window — verdict comes via voteReceived or teacherVerdict
    this.emit("tod:steal:open", { windowMs: 10000 });

    const judge = this.config.judgmentMode || this.challenge?.judgmentMode || "teacher";
    if (judge === "ai" && this.choice === "truth") {
      // Best-effort AI judging is a v2 follow-on; for v1 we treat AI as teacher
      // and let the teacher tap a verdict.
    }

    this._scheduleTimer(PHASE_DURATIONS_MS[PHASES.JUDGING], () => {
      if (this.phase !== PHASES.JUDGING) return;
      // Auto-decide based on majority audience vote, or default to "pass"
      // (we err generous — fail-without-explicit-feedback discourages risk)
      const tally = { pass: 0, fail: 0, retry: 0 };
      for (const v of this.audienceVotes.values()) {
        if (tally[v] != null) tally[v] += 1;
      }
      let verdict = "pass";
      let verdictBy = "auto";
      if (tally.fail > tally.pass && tally.fail > tally.retry) verdict = "fail";
      else if (tally.retry > tally.pass) verdict = "retry";
      this._enterPhase(PHASES.REWARDING, { verdict, verdictBy }).catch(() => {});
    });
  }

  _handleRewarding({ verdict, verdictBy }) {
    const v = verdict || "pass";
    const teamId = this.selectedTeamId;

    // Compute reward
    const tier = this.tierByTeam.get(teamId) || "sprout";
    const tierPts = tier === "big" ? 30 : tier === "stem" ? 20 : 10;
    const rewardMult = this.challenge?.rewardTier === "large" ? 2
                    : this.challenge?.rewardTier === "medium" ? 1.5
                    : 1;
    const doubleDareMult = this.challenge?._doubleDare ? 1.5 : 1;
    const pts = v === "pass" ? Math.round(tierPts * rewardMult * doubleDareMult)
              : v === "retry" ? Math.round(tierPts * 0.4)
              : 0;
    const coins = v === "pass" ? Math.round(pts / 3) : 0;
    const specialItem = (v === "pass" && Math.random() < 0.07) ? "shield" : "";

    // Tier escalation/demotion
    const prevSuccesses = this.successesByTeam.get(teamId) || 0;
    let nextSuccesses = prevSuccesses;
    let nextTier = tier;
    if (v === "pass") {
      nextSuccesses = prevSuccesses + 1;
      nextTier = escalateTier(tier, nextSuccesses);
    } else if (v === "fail") {
      nextSuccesses = 0;
      nextTier = demoteTier(tier);
    } else if (v === "retry") {
      // No change — student gets a second shot
    }
    this.successesByTeam.set(teamId, nextSuccesses);
    this.tierByTeam.set(teamId, nextTier);

    // Participation updates
    for (const [k, val] of this.participationByTeam) {
      this.participationByTeam.set(k, (val || 0) + 1);
    }
    this.participationByTeam.set(teamId, 0);

    // Update score (mutate local team copy)
    const team = this.teams.find((t) => t.teamId === teamId);
    if (team) team.score = (team.score || 0) + pts;

    // Cooldown
    this.cooldownsBy = applyCooldown(this.cooldownsBy, teamId, this.roundIndex, 2);

    // Log
    this._roundLog.push({
      roundIndex: this.roundIndex,
      teamId,
      playerName: this.selectedPlayerName,
      choice: this.choice,
      challengeId: this.challenge?.id || "",
      prompt: this.challenge?.prompt || "",
      verdict: v,
      verdictBy,
      pointsAwarded: pts,
      coinsAwarded: coins,
      specialItem,
    });

    // Remember the prompt so future rounds don't repeat it
    if (this.challenge?.prompt) {
      rememberChallenge(this.roomCode, {
        id: this.challenge.id,
        prompt: this.challenge.prompt,
      });
    }

    this.emit("tod:verdict", {
      roundIndex: this.roundIndex,
      result: v,
      verdictBy,
      awardedPoints: pts,
      awardedCoins: coins,
      specialItem,
      newTier: nextTier,
    });

    this._scheduleTimer(PHASE_DURATIONS_MS[PHASES.REWARDING], () => {
      this._enterPhase(PHASES.COOLDOWN).catch(() => {});
    });
  }

  _handleCooldown() {
    this.emit("tod:cooldown:set", {
      teamId: this.selectedTeamId,
      cooldownRounds: 2,
    });
    this._scheduleTimer(PHASE_DURATIONS_MS[PHASES.COOLDOWN], () => {
      this._enterPhase(PHASES.SELECTING).catch(() => {});
    });
  }

  // -------- inbound events from sockets --------

  setPlayerChoice(choice) {
    if (this.phase !== PHASES.CHOOSING) return false;
    const allowed = ["truth", "dare", "double-dare", "pass"];
    if (!allowed.includes(choice)) return false;
    this.choice = choice;
    this._clearTimers();
    this._enterPhase(PHASES.REVEALING).catch(() => {});
    return true;
  }

  setPlayerDone() {
    if (this.phase !== PHASES.PERFORMING) return false;
    this._performEndedAt = Date.now();
    this._clearTimers();
    this._enterPhase(PHASES.JUDGING).catch(() => {});
    return true;
  }

  recordAudienceReaction(teamId, emoji) {
    if (!teamId || !emoji) return;
    this.audienceReactions.push({ teamId, emoji, ts: Date.now() });
    this.lastReactionByTeam.set(teamId, 0);
    this.emit("tod:audience:reaction", { teamId, emoji });
  }

  recordAudienceVote(teamId, verdict) {
    if (this.phase !== PHASES.JUDGING) return false;
    const allowed = ["pass", "fail", "retry"];
    if (!allowed.includes(verdict)) return false;
    if (teamId === this.selectedTeamId) return false; // can't vote on self
    this.audienceVotes.set(teamId, verdict);
    return true;
  }

  recordStealRequest(teamId) {
    if (this.phase !== PHASES.JUDGING && this.phase !== PHASES.PERFORMING) return false;
    if (this.stealAttemptedBy) return false;        // first-in wins
    if (teamId === this.selectedTeamId) return false;
    this.stealAttemptedBy = teamId;
    this.emit("tod:steal:locked", { teamId });
    return true;
  }

  teacherPeekDecision(action, newText = "") {
    if (this.phase !== PHASES.REVEALING) return false;
    if (action === "approve") {
      this._teacherPeekApproved = true;
      this._clearTimers();
      this._broadcastReveal();
      return true;
    }
    if (action === "reroll") {
      this._clearTimers();
      this.challenge = null;
      this._handleRevealing(); // generates a fresh challenge
      return true;
    }
    if (action === "edit" && typeof newText === "string" && newText.trim()) {
      this.challenge = { ...this.challenge, prompt: newText.trim(), sourceProvenance: "teacher-injected" };
      this._clearTimers();
      this._broadcastReveal();
      return true;
    }
    return false;
  }

  teacherOverride(action) {
    if (["skip"].includes(action)) {
      this._clearTimers();
      this._enterPhase(PHASES.REWARDING, { verdict: "skip", verdictBy: "teacher" }).catch(() => {});
      return true;
    }
    if (action === "force-pass") {
      this._clearTimers();
      this._enterPhase(PHASES.REWARDING, { verdict: "pass", verdictBy: "teacher" }).catch(() => {});
      return true;
    }
    if (action === "force-fail") {
      this._clearTimers();
      this._enterPhase(PHASES.REWARDING, { verdict: "fail", verdictBy: "teacher" }).catch(() => {});
      return true;
    }
    if (action === "force-redo") {
      this._clearTimers();
      this._enterPhase(PHASES.PERFORMING).catch(() => {});
      return true;
    }
    if (action === "force-select") {
      // No-op without teamId — see teacherForceSelect
      return false;
    }
    return false;
  }

  teacherForceSelect(teamId) {
    this._forceTeamId = teamId || null;
    if (this.phase === PHASES.IDLE || this.phase === PHASES.COOLDOWN) {
      this._clearTimers();
      this._enterPhase(PHASES.SELECTING).catch(() => {});
    }
    return true;
  }

  teacherInject(challenge) {
    // Manual injection — queue this challenge at the front
    if (!challenge || !challenge.prompt) return false;
    const injected = { ...challenge, sourceProvenance: "teacher-injected", _manual: true };
    this.challengeQueue.unshift(injected);
    return true;
  }

  updateConfig(delta = {}) {
    this.config = { ...this.config, ...delta };
    this._broadcastState();
  }

  // -------- queue management --------

  async _refillQueue() {
    if (this.stopped) return;
    if (this.challengeQueue.length >= 2) return;
    const tier = "sprout"; // we don't know which team comes next; default conservative
    try {
      const { challenge } = await generateChallenge({
        roomCode: this.roomCode,
        subject: this.config.subject,
        unitName: this.config.unitName,
        gradeLevel: this.config.gradeLevel,
        tier,
        kindHint: "either",
        physicalIntensityMax: this.config.physicalIntensityMax,
        socialIntensityMax: this.config.socialIntensityMax,
        movementAllowed: this.config.movementAllowed,
        noiseAllowed: this.config.noiseAllowed,
        worldview: this.config.worldview,
      });
      if (challenge) this.challengeQueue.push(challenge);
    } catch (e) {
      console.warn("[T-or-D orchestrator] queue refill failed:", e?.message || e);
    }
  }

  _popQueuedChallenge({ tier, kindHint }) {
    // Pop the first queued challenge that matches kindHint (if any). Tier is
    // soft-matched (we accept the queued tier even if it differs).
    for (let i = 0; i < this.challengeQueue.length; i++) {
      const c = this.challengeQueue[i];
      if (kindHint === "either" || !kindHint || c.type === kindHint) {
        this.challengeQueue.splice(i, 1);
        return c;
      }
    }
    return null;
  }

  // -------- helpers --------

  _scheduleTimer(ms, fn) {
    const t = setTimeout(() => {
      this._timers.delete(t);
      if (this.stopped) return;
      try { fn(); } catch (e) {
        console.warn("[T-or-D orchestrator] timer fn threw:", e?.message || e);
      }
    }, ms);
    this._timers.add(t);
  }

  _clearTimers() {
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
  }

  _broadcastState(extra = {}) {
    this.emit("tod:state", {
      roomCode: this.roomCode,
      phase: this.phase,
      roundIndex: this.roundIndex,
      totalRounds: this.totalRounds,
      selectedTeamId: this.selectedTeamId,
      selectedPlayerName: this.selectedPlayerName,
      choice: this.choice,
      challenge: this._publicChallenge(),
      mode: this.mode,
      ...extra,
    });
  }

  _publicChallenge() {
    if (!this.challenge) return null;
    // Strip teacherHint from public broadcasts
    const { teacherHint, ...pub } = this.challenge;
    return pub;
  }

  _buildSummary() {
    return {
      roomCode: this.roomCode,
      sessionId: this.sessionId,
      totalRoundsRun: this._roundLog.length,
      rounds: this._roundLog,
      finalScores: this.teams.map((t) => ({ teamId: t.teamId, playerName: t.playerName, score: t.score || 0 })),
    };
  }

  _persistAsync() {
    if (!this.sessionId || !this.persist) return;
    Promise.resolve().then(() => this.persist({
      sessionId: this.sessionId,
      phase: this.phase,
      roundIndex: this.roundIndex,
      lastRound: this._roundLog[this._roundLog.length - 1] || null,
    })).catch((e) => {
      console.warn("[T-or-D orchestrator] persist failed:", e?.message || e);
    });
  }
}

export const TOD_PHASES = PHASES;
export const TOD_PHASE_DURATIONS_MS = PHASE_DURATIONS_MS;

// Useful re-export so consumers can hash prompts the same way the moderator does
export function hashPrompt(text) {
  return crypto.createHash("sha1")
    .update(String(text || "").toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex")
    .slice(0, 12);
}
