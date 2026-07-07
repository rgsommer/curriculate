// student-app/src/components/tasks/types/TruthOrDareTask.jsx
//
// Truth or Dare — full student renderer. See TRUTH_OR_DARE_PLAN.md §5 + §6.
//
// Two modes:
//   1. LIVE (socket): server is the source of truth. We subscribe to
//      tod:state, tod:spotlight:spin, tod:spotlight:land, tod:challenge:reveal,
//      tod:perform:tick, tod:audience:reaction, tod:steal:open,
//      tod:verdict, tod:cooldown:set, tod:session:end and render whatever
//      phase we're in.
//   2. PRACTICE (no socket): we drive the whole 6-stage loop locally with a
//      tiny in-component state machine so solo players can experience the
//      flow end-to-end without a teacher launching a session. Challenges
//      come from a small local pool (cfg.seedChallenges) rather than the AI.
//
// The renderer is intentionally chunky — 6 phases × visual components.
// Sub-components live in this single file to keep the bundle small.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getPlayerName } from "../../../utils/playerName";
import { useServerEventTimeout } from "../useServerEventTimeout.js";

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

const TIER_META = {
  sprout: { emoji: "🌱", label: "Sprout" },
  stem:   { emoji: "🌿", label: "Stem"   },
  big:    { emoji: "🌳", label: "Big"    },
};

const CATEGORY_ICONS = {
  recall:   "🧠",
  explain:  "💬",
  defend:   "⚔️",
  mime:     "🤹",
  persuade: "📣",
  roleplay: "🎭",
  improv:   "🎤",
  draw:     "✏️",
  narrate:  "📖",
  compose:  "🎵",
  reflect:  "💭",
  predict:  "🔮",
};

// ---------- Practice mode local engine -------------------------------------

const PRACTICE_DEFAULT_SEEDS = [
  {
    id: "p-truth-1",
    type: "truth",
    tier: "sprout",
    category: "recall",
    prompt: "Name one thing you learned today that surprised you.",
    teacherHint: "Any thoughtful answer earns the points.",
    timeSeconds: 20,
    judgmentMode: "teacher",
    rewardTier: "small",
  },
  {
    id: "p-dare-1",
    type: "dare",
    tier: "sprout",
    category: "mime",
    prompt: "Mime a verb from today's lesson without using sound — see if the class can guess.",
    teacherHint: "Any clear, on-topic mime earns full points.",
    timeSeconds: 30,
    judgmentMode: "class-vote",
    rewardTier: "medium",
  },
  {
    id: "p-truth-2",
    type: "truth",
    tier: "stem",
    category: "explain",
    prompt: "Explain one idea from today in your own words, like you're teaching a younger sibling.",
    teacherHint: "Reward clarity, not perfection.",
    timeSeconds: 30,
    judgmentMode: "teacher",
    rewardTier: "medium",
  },
  {
    id: "p-dare-2",
    type: "dare",
    tier: "stem",
    category: "narrate",
    prompt: "Narrate a 30-second 'documentary' about something you learned, in your best documentary voice.",
    teacherHint: "Bonus marks for confident voice.",
    timeSeconds: 45,
    judgmentMode: "class-vote",
    rewardTier: "medium",
  },
];

function pickPracticeChallenge(pool, kindHint, prevIds) {
  const filtered = pool.filter((c) => {
    if (kindHint && kindHint !== "either" && c.type !== kindHint) return false;
    if (prevIds && prevIds.has(c.id)) return false;
    return true;
  });
  const fallback = pool.filter((c) => !prevIds || !prevIds.has(c.id));
  const arr = filtered.length ? filtered : (fallback.length ? fallback : pool);
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- The big component ---------------------------------------------

export default function TruthOrDareTask({
  task,
  onSubmit,
  disabled,
  socket,
  roomCode,
  teamId,
  taskIndex,
  practiceMode = false,
}) {
  const cfg = task?.config || {};
  const isLive = !!(socket && roomCode && teamId) && !practiceMode;

  // The player's own name drives the practice spotlight + roster (tester:
  // "always include the player's name as one of the names"). Falls back to
  // "You" if unknown.
  const ME = getPlayerName();

  // ------------- Live mode: subscribe to server -----------------------------

  const [livePhase, setLivePhase]               = useState(PHASES.IDLE);
  const [liveRoundIndex, setLiveRoundIndex]     = useState(0);
  const [liveTotalRounds, setLiveTotalRounds]   = useState(Number(cfg.totalRounds) || 6);
  const [liveSelectedTeamId, setLiveSelectedTeamId] = useState("");
  const [liveSelectedPlayer, setLiveSelectedPlayer] = useState("");
  const [liveChoice, setLiveChoice]             = useState(null);
  const [liveChallenge, setLiveChallenge]       = useState(null);
  const [liveReel, setLiveReel]                 = useState([]);
  const [liveTickMs, setLiveTickMs]             = useState(0);
  const [liveReactions, setLiveReactions]       = useState([]);
  const [liveStealOpen, setLiveStealOpen]       = useState(false);
  const [liveVerdict, setLiveVerdict]           = useState(null);
  const [liveEnded, setLiveEnded]               = useState(false);

  // ── P1 safety: don't sit in a server-gated phase forever ──────────────
  // Live mode advances only when the server drives the spotlight. If those
  // events never arrive (no teacher orchestrating, too few players, a dropped
  // event), IDLE renders an empty shell with no way forward. Nudge the server
  // once, then surface a clear "Continue" so the student is never trapped.
  const [liveStuck, setLiveStuck] = useState(false);
  useServerEventTimeout({
    armed: isLive && livePhase === PHASES.IDLE && !liveStuck,
    timeoutMs: 12000,
    resetKey: liveRoundIndex,
    onTimeout: () => {
      try { socket?.emit?.("tod:requestState", { roomCode, teamId }); } catch { /* noop */ }
      setLiveStuck(true);
    },
  });
  // Clear the stuck state whenever the server does move us forward.
  useEffect(() => {
    if (livePhase !== PHASES.IDLE && liveStuck) setLiveStuck(false);
  }, [livePhase, liveRoundIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isLive) return;
    let alive = true;

    const onState = (s) => {
      if (!alive || !s) return;
      setLivePhase(s.phase || PHASES.IDLE);
      setLiveRoundIndex(s.roundIndex ?? 0);
      setLiveTotalRounds(s.totalRounds ?? liveTotalRounds);
      setLiveSelectedTeamId(s.selectedTeamId || "");
      setLiveSelectedPlayer(s.selectedPlayerName || "");
      setLiveChoice(s.choice || null);
      if (s.challenge) setLiveChallenge(s.challenge);
    };
    const onSpin   = ({ reel = [] }) => { setLiveReel(reel); };
    const onLand   = ({ teamId: tid, playerName }) => {
      setLiveSelectedTeamId(tid);
      setLiveSelectedPlayer(playerName || "");
    };
    const onReveal = ({ challenge }) => { setLiveChallenge(challenge); };
    const onTick   = ({ msRemaining }) => { setLiveTickMs(Number(msRemaining) || 0); };
    const onReact  = (r) => {
      setLiveReactions((prev) => [...prev.slice(-12), { ...r, key: Date.now() + Math.random() }]);
    };
    const onSteal  = () => setLiveStealOpen(true);
    const onVerdict = (v) => { setLiveVerdict(v); setLiveStealOpen(false); };
    const onEnd     = () => { setLiveEnded(true); };

    socket.on("tod:state", onState);
    socket.on("tod:spotlight:spin", onSpin);
    socket.on("tod:spotlight:land", onLand);
    socket.on("tod:challenge:reveal", onReveal);
    socket.on("tod:perform:tick", onTick);
    socket.on("tod:audience:reaction", onReact);
    socket.on("tod:steal:open", onSteal);
    socket.on("tod:verdict", onVerdict);
    socket.on("tod:session:end", onEnd);
    socket.emit("tod:requestState", { roomCode }, () => {});

    return () => {
      alive = false;
      socket.off("tod:state", onState);
      socket.off("tod:spotlight:spin", onSpin);
      socket.off("tod:spotlight:land", onLand);
      socket.off("tod:challenge:reveal", onReveal);
      socket.off("tod:perform:tick", onTick);
      socket.off("tod:audience:reaction", onReact);
      socket.off("tod:steal:open", onSteal);
      socket.off("tod:verdict", onVerdict);
      socket.off("tod:session:end", onEnd);
    };
  }, [isLive, socket, roomCode]);

  // ------------- Practice mode: local state machine -------------------------

  const [practicePhase, setPracticePhase]         = useState(PHASES.SELECTING);
  const [practiceRound, setPracticeRound]         = useState(0);
  const [practiceChoice, setPracticeChoice]       = useState(null);
  const [practiceChallenge, setPracticeChallenge] = useState(null);
  const [practiceTickMs, setPracticeTickMs]       = useState(0);
  const [practiceVerdict, setPracticeVerdict]     = useState(null);
  const [practicePoints, setPracticePoints]       = useState(0);
  const practiceSeenRef = useRef(new Set());
  const practiceTimerRef = useRef(null);

  const practicePool = useMemo(() => {
    const seeds = Array.isArray(cfg.seedChallenges) && cfg.seedChallenges.length
      ? cfg.seedChallenges
      : PRACTICE_DEFAULT_SEEDS;
    return seeds.map((s, i) => ({
      id: s.id || `seed-${i}`,
      type: s.type === "dare" ? "dare" : "truth",
      tier: ["sprout", "stem", "big"].includes(s.tier) ? s.tier : "sprout",
      category: s.category || "recall",
      prompt: s.prompt || "Tell us one thing you remember from today's lesson.",
      teacherHint: s.teacherHint || "",
      timeSeconds: Math.max(15, Math.min(90, Number(s.timeSeconds) || 30)),
      judgmentMode: s.judgmentMode || "teacher",
      rewardTier: s.rewardTier || "small",
    }));
  }, [cfg.seedChallenges]);

  // Named "bots" so solo practice feels like a real round and the spotlight
  // clearly names who's up (tester: "show bots in practice mode, and identify
  // which player is to do the truth/dare"). The spotlight rotates You → bots.
  const PRACTICE_ROSTER = [ME, "Ada", "Newton", "Maya"];
  const [practiceSpotlight, setPracticeSpotlight] = useState(ME);
  const isBotTurn = practiceMode && practiceSpotlight !== ME;

  // Practice flow: SELECTING → CHOOSING → REVEALING → PERFORMING → JUDGING → REWARDING → next
  useEffect(() => {
    if (!practiceMode) return;
    if (practicePhase === PHASES.SELECTING) {
      // Land the spotlight on the next player in rotation (You first each cycle).
      setPracticeSpotlight(PRACTICE_ROSTER[practiceRound % PRACTICE_ROSTER.length]);
      const t = setTimeout(() => setPracticePhase(PHASES.CHOOSING), 2000);
      return () => clearTimeout(t);
    }
    if (practicePhase === PHASES.CHOOSING) {
      // Bot turn → the bot auto-picks after a beat. Your turn → wait for you.
      if (practiceSpotlight !== ME) {
        const t = setTimeout(() => handleChoice(Math.random() < 0.5 ? "truth" : "dare"), 1600);
        return () => clearTimeout(t);
      }
      return;
    }
    if (practicePhase === PHASES.REVEALING) {
      const t = setTimeout(() => setPracticePhase(PHASES.PERFORMING), 2000);
      return () => clearTimeout(t);
    }
    if (practicePhase === PHASES.PERFORMING && practiceChallenge) {
      // Bot "performs" quickly so the round keeps moving.
      if (practiceSpotlight !== ME) {
        const t = setTimeout(() => setPracticePhase(PHASES.JUDGING), 2500);
        return () => clearTimeout(t);
      }
      const budget = practiceChallenge.timeSeconds * 1000;
      const startedAt = Date.now();
      setPracticeTickMs(budget);
      practiceTimerRef.current && clearInterval(practiceTimerRef.current);
      practiceTimerRef.current = setInterval(() => {
        const remaining = Math.max(0, budget - (Date.now() - startedAt));
        setPracticeTickMs(remaining);
        if (remaining <= 0) {
          clearInterval(practiceTimerRef.current);
          setPracticePhase(PHASES.JUDGING);
        }
      }, 250);
      return () => {
        if (practiceTimerRef.current) clearInterval(practiceTimerRef.current);
      };
    }
    if (practicePhase === PHASES.JUDGING) {
      // Bot turn → auto-judge (the bot "nails it"); your turn → you self-judge.
      if (practiceSpotlight !== ME) {
        const t = setTimeout(() => {
          setPracticeVerdict("pass");
          setPracticePoints((p) => p + 10);
          setPracticePhase(PHASES.REWARDING);
        }, 1500);
        return () => clearTimeout(t);
      }
      // Solo: player self-judges via Pass / Try Again / Fail buttons
      return;
    }
    if (practicePhase === PHASES.REWARDING) {
      const t = setTimeout(() => {
        if (practiceRound + 1 >= 4) {
          setPracticePhase(PHASES.ENDED);
        } else {
          setPracticeRound((r) => r + 1);
          setPracticeChoice(null);
          setPracticeChallenge(null);
          setPracticeVerdict(null);
          setPracticePhase(PHASES.SELECTING);
        }
      }, 2400);
      return () => clearTimeout(t);
    }
  }, [practicePhase, practiceMode, practiceChallenge, practiceRound, practiceSpotlight]);

  // ------------- Unified phase + data view (live vs practice) --------------

  const phase            = practiceMode ? practicePhase           : livePhase;
  const roundIndex       = practiceMode ? practiceRound           : liveRoundIndex;
  const totalRounds      = practiceMode ? 4                       : liveTotalRounds;
  const challenge        = practiceMode ? practiceChallenge       : liveChallenge;
  const tickMs           = practiceMode ? practiceTickMs          : liveTickMs;
  const reactions        = practiceMode ? []                      : liveReactions;
  const verdictPayload   = practiceMode
    ? (practiceVerdict ? { result: practiceVerdict, awardedPoints: practicePoints, awardedCoins: 0 } : null)
    : liveVerdict;
  const selectedPlayer   = practiceMode ? practiceSpotlight       : liveSelectedPlayer;
  const isMySelectedTurn = practiceMode ? (practiceSpotlight === ME) : (teamId && liveSelectedTeamId === teamId);

  // ------------- Handlers ---------------------------------------------------

  function handleChoice(choice) {
    if (practiceMode) {
      const kind = choice === "double-dare" ? "dare" : choice === "pass" ? null : choice;
      if (choice === "pass") {
        setPracticeChoice("pass");
        setPracticeVerdict("skip");
        setPracticePhase(PHASES.REWARDING);
        return;
      }
      const next = pickPracticeChallenge(practicePool, kind, practiceSeenRef.current);
      if (next) {
        practiceSeenRef.current.add(next.id);
        setPracticeChallenge(next);
      }
      setPracticeChoice(choice);
      setPracticePhase(PHASES.REVEALING);
      return;
    }
    socket?.emit("tod:player:choice", { roomCode, choice, teamId }, () => {});
  }

  function handleDone() {
    if (practiceMode) {
      if (practiceTimerRef.current) clearInterval(practiceTimerRef.current);
      setPracticePhase(PHASES.JUDGING);
      return;
    }
    socket?.emit("tod:player:done", { roomCode, teamId }, () => {});
  }

  function handleReact(emoji) {
    if (!practiceMode && socket && roomCode && teamId) {
      socket.emit("tod:audience:react", { roomCode, teamId, emoji }, () => {});
    }
  }

  function handleVote(verdict) {
    if (practiceMode) {
      // Solo self-judge
      const tierBase = challenge?.tier === "big" ? 30 : challenge?.tier === "stem" ? 20 : 10;
      const pts = verdict === "pass" ? tierBase : verdict === "retry" ? Math.round(tierBase * 0.4) : 0;
      setPracticeVerdict(verdict);
      setPracticePoints((p) => p + pts);
      setPracticePhase(PHASES.REWARDING);
      return;
    }
    socket?.emit("tod:audience:vote", { roomCode, teamId, verdict }, () => {});
  }

  function handleSteal() {
    if (!practiceMode && socket && roomCode && teamId) {
      socket.emit("tod:steal:request", { roomCode, teamId }, () => {});
    }
  }

  function handleFinishPractice() {
    if (typeof onSubmit === "function") {
      onSubmit({ points: practicePoints, completedRounds: practiceRound + 1, practiceMode: true });
    }
  }

  // ------------- UI ---------------------------------------------------------

  const ended = practiceMode ? phase === PHASES.ENDED : liveEnded;

  return (
    <div style={styles.shell}>
      <Header
        roundIndex={roundIndex}
        totalRounds={totalRounds}
        challenge={challenge}
        phase={phase}
      />

      {!ended && isLive && phase === PHASES.IDLE && liveStuck && (
        <div style={{ textAlign: "center", padding: "20px 16px" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>
            Waiting for your teacher to start the round…
          </div>
          <div style={{ opacity: 0.75, fontSize: "0.9rem", marginBottom: 14 }}>
            This is taking longer than usual — you can keep going.
          </div>
          <button
            type="button"
            onClick={() => { try { onSubmit?.({ skipped: true, reason: "tod-idle-timeout" }); } catch { /* noop */ } }}
            style={{
              padding: "11px 24px", borderRadius: 999, border: "none", fontWeight: 800,
              background: "linear-gradient(135deg,#fb923c,#ea580c)", color: "#fff", cursor: "pointer",
            }}
          >
            Continue →
          </button>
        </div>
      )}

      {!ended && phase === PHASES.SELECTING && (
        <SpotlightWheel reel={liveReel} selectedPlayer={selectedPlayer} practiceMode={practiceMode} me={ME} />
      )}

      {!ended && phase === PHASES.CHOOSING && (
        <ChoicePhase
          isMyTurn={isMySelectedTurn}
          selectedPlayer={selectedPlayer}
          onChoice={handleChoice}
          disabled={disabled}
        />
      )}

      {!ended && (phase === PHASES.REVEALING || phase === PHASES.PERFORMING || phase === PHASES.JUDGING) && challenge && (
        <ChallengeCard
          challenge={challenge}
          tickMs={tickMs}
          phase={phase}
          isMyTurn={isMySelectedTurn}
          onDone={handleDone}
          onReact={handleReact}
          onVote={handleVote}
          onSteal={handleSteal}
          stealOpen={liveStealOpen && !isMySelectedTurn}
          reactions={reactions}
        />
      )}

      {!ended && phase === PHASES.REWARDING && (
        <RewardReveal verdict={verdictPayload} challenge={challenge} />
      )}

      {ended && (
        <EndPanel
          totalPoints={practiceMode ? practicePoints : 0}
          practiceMode={practiceMode}
          onFinish={handleFinishPractice}
        />
      )}
    </div>
  );
}

// ---------- Sub-components -------------------------------------------------

function Header({ roundIndex, totalRounds, challenge, phase }) {
  return (
    <div style={styles.header}>
      <div style={styles.tag}>Truth or Dare</div>
      <div style={styles.roundLabel}>Round {Math.min(roundIndex + 1, totalRounds)} / {totalRounds}</div>
      {challenge && (
        <div style={styles.tierBadge}>
          {TIER_META[challenge.tier || "sprout"].emoji} {TIER_META[challenge.tier || "sprout"].label}
        </div>
      )}
      <div style={styles.phaseLabel}>{prettyPhase(phase)}</div>
    </div>
  );
}

function SpotlightWheel({ reel = [], selectedPlayer = "", practiceMode = false, me = "You" }) {
  // Slot-machine "blur" of avatars. We rotate display names every 120ms for
  // ~2.5s, then settle on the chosen player.
  const [tickIdx, setTickIdx] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTickIdx((n) => n + 1), 130);
    return () => clearInterval(i);
  }, []);
  // Blur through the roster, then settle on whoever's actually up (You or a bot).
  const PRACTICE_REEL = [me, "Ada", "Newton", "Maya"];
  const displayed = practiceMode
    ? (tickIdx < 14 ? PRACTICE_REEL[tickIdx % PRACTICE_REEL.length] : (selectedPlayer || me))
    : (reel.length
        ? reel[tickIdx % reel.length]?.playerName || "…"
        : (selectedPlayer || "…"));
  return (
    <div style={styles.spotlight}>
      <div style={styles.spotlightFrame}>
        <div style={styles.spotlightLabel}>Picking someone…</div>
        <div style={styles.spotlightName}>{displayed || "…"}</div>
        <div style={styles.spotlightSub}>🥁 drumroll 🥁</div>
      </div>
    </div>
  );
}

function ChoicePhase({ isMyTurn, selectedPlayer, onChoice, disabled }) {
  if (!isMyTurn) {
    return (
      <div style={styles.waitCard}>
        <div style={styles.waitMain}>{selectedPlayer || "A teammate"} is choosing…</div>
        <div style={styles.waitSub}>Sit tight — the challenge drops in a few seconds.</div>
      </div>
    );
  }
  return (
    <div style={styles.choiceWrap}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChoice("truth")}
        style={{ ...styles.choiceBtn, ...styles.choiceTruth }}
      >
        <div style={styles.choiceEmoji}>💬</div>
        <div style={styles.choiceLabel}>TRUTH</div>
        <div style={styles.choiceSub}>Answer a question</div>
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChoice("dare")}
        style={{ ...styles.choiceBtn, ...styles.choiceDare }}
      >
        <div style={styles.choiceEmoji}>🔥</div>
        <div style={styles.choiceLabel}>DARE</div>
        <div style={styles.choiceSub}>Perform a challenge</div>
      </button>
      <div style={styles.choiceMinorRow}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChoice("double-dare")}
          style={{ ...styles.choiceMinorBtn, background: "#7c1d22", color: "#fff" }}
        >
          ⚡ DOUBLE DARE
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChoice("pass")}
          style={{ ...styles.choiceMinorBtn, background: "#444", color: "#fff" }}
        >
          🪙 PASS
        </button>
      </div>
    </div>
  );
}

function ChallengeCard({ challenge, tickMs, phase, isMyTurn, onDone, onReact, onVote, onSteal, stealOpen, reactions = [] }) {
  const seconds = Math.ceil(tickMs / 1000);
  const totalSec = challenge?.timeSeconds || 30;
  const pct = Math.max(0, Math.min(100, (seconds / totalSec) * 100));
  return (
    <div style={styles.challengeCard}>
      <div style={styles.challengeTopRow}>
        <span style={styles.catBadge}>
          {CATEGORY_ICONS[challenge?.category] || "✨"} {challenge?.category || "challenge"}
        </span>
        <span style={styles.typeBadge}>{(challenge?.type || "challenge").toUpperCase()}</span>
      </div>

      <div style={styles.challengePrompt}>{challenge?.prompt || "Loading…"}</div>

      {(phase === PHASES.PERFORMING) && (
        <div style={styles.timerBar}>
          <div style={{ ...styles.timerFill, width: `${pct}%` }} />
          <div style={styles.timerLabel}>{seconds}s</div>
        </div>
      )}

      {phase === PHASES.PERFORMING && isMyTurn && (
        <button type="button" style={styles.doneBtn} onClick={onDone}>
          ✓ I'm done
        </button>
      )}

      {phase === PHASES.PERFORMING && !isMyTurn && (
        <ReactionStrip onReact={onReact} reactions={reactions} />
      )}

      {phase === PHASES.JUDGING && !isMyTurn && (
        <VotingBar onVote={onVote} stealOpen={stealOpen} onSteal={onSteal} />
      )}

      {phase === PHASES.JUDGING && isMyTurn && (
        // Solo / practice: the performer self-judges
        <VotingBar onVote={onVote} stealOpen={false} onSteal={() => {}} solo />
      )}
    </div>
  );
}

function ReactionStrip({ onReact, reactions = [] }) {
  const emojis = ["🔥", "🙂", "🤔", "👏", "💡"];
  return (
    <div style={styles.reactStrip}>
      <div style={styles.reactRow}>
        {emojis.map((e) => (
          <button key={e} type="button" style={styles.reactBtn} onClick={() => onReact(e)}>
            {e}
          </button>
        ))}
      </div>
      <div style={styles.reactFloats}>
        {reactions.map((r) => (
          <span key={r.key} style={styles.reactFloat}>{r.emoji}</span>
        ))}
      </div>
    </div>
  );
}

function VotingBar({ onVote, stealOpen, onSteal, solo = false }) {
  return (
    <div style={styles.voteBar}>
      <div style={styles.voteHeader}>{solo ? "How'd you do?" : "Class vote — was it a hit?"}</div>
      <div style={styles.voteRow}>
        <button type="button" style={{ ...styles.voteBtn, background: "#1f6f3a" }} onClick={() => onVote("pass")}>
          ✓ Pass
        </button>
        <button type="button" style={{ ...styles.voteBtn, background: "#a36b00" }} onClick={() => onVote("retry")}>
          ↻ Try Again
        </button>
        <button type="button" style={{ ...styles.voteBtn, background: "#7a1f1f" }} onClick={() => onVote("fail")}>
          ✗ Fail
        </button>
      </div>
      {stealOpen && (
        <button type="button" style={styles.stealBtn} onClick={onSteal}>
          🗡 Steal this one
        </button>
      )}
    </div>
  );
}

function RewardReveal({ verdict, challenge }) {
  if (!verdict) {
    return (
      <div style={styles.rewardCard}>
        <div style={styles.rewardMain}>Wrapping up…</div>
      </div>
    );
  }
  const result = verdict.result;
  const icon = result === "pass" ? "🎉" : result === "retry" ? "↻" : result === "fail" ? "💛" : "⏭";
  const headline =
    result === "pass" ? "Glory earned!" :
    result === "retry" ? "Another shot next round." :
    result === "fail" ? "No worries — that's how we grow." :
    "Skipped.";
  return (
    <div style={styles.rewardCard}>
      <div style={styles.rewardIcon}>{icon}</div>
      <div style={styles.rewardHeadline}>{headline}</div>
      <div style={styles.rewardPoints}>
        +{verdict.awardedPoints || 0} pts
        {verdict.awardedCoins ? `  ·  +${verdict.awardedCoins} 🪙` : ""}
      </div>
      {verdict.specialItem && (
        <div style={styles.rewardItem}>Special: {verdict.specialItem}</div>
      )}
      {challenge?.teacherHint && (
        <div style={styles.rewardHint}>Teacher hint: {challenge.teacherHint}</div>
      )}
    </div>
  );
}

function EndPanel({ totalPoints, practiceMode, onFinish }) {
  return (
    <div style={styles.endPanel}>
      <div style={styles.endIcon}>🏁</div>
      <div style={styles.endHeadline}>That's a wrap!</div>
      {practiceMode && (
        <>
          <div style={styles.endPoints}>You earned {totalPoints} points.</div>
          <button type="button" style={styles.endBtn} onClick={onFinish}>Finish task →</button>
        </>
      )}
      {!practiceMode && (
        <div style={styles.endNote}>Waiting for the teacher to move on…</div>
      )}
    </div>
  );
}

// ---------- Helpers --------------------------------------------------------

function prettyPhase(p) {
  switch (p) {
    case PHASES.SELECTING:  return "Picking someone…";
    case PHASES.CHOOSING:   return "Truth or Dare?";
    case PHASES.REVEALING:  return "Here it comes…";
    case PHASES.PERFORMING: return "Performing!";
    case PHASES.JUDGING:    return "Time to judge.";
    case PHASES.REWARDING:  return "Reward!";
    case PHASES.COOLDOWN:   return "Resetting…";
    case PHASES.ENDED:      return "Complete";
    default: return "";
  }
}

// ---------- Inline styles --------------------------------------------------

const styles = {
  shell: {
    display: "flex", flexDirection: "column", gap: 16,
    padding: 16, color: "#f3f3f3",
    background: "linear-gradient(160deg, #1f1d3c 0%, #2c2750 50%, #3a1d4c 100%)",
    borderRadius: 16, minHeight: 460,
  },
  header: {
    display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
  },
  tag: {
    background: "#ffd166", color: "#222",
    padding: "4px 10px", borderRadius: 999, fontWeight: 700, fontSize: 13,
  },
  roundLabel: { opacity: 0.85, fontSize: 14 },
  tierBadge: {
    background: "#3a3a6e", padding: "4px 10px", borderRadius: 999, fontSize: 13,
  },
  phaseLabel: { marginLeft: "auto", opacity: 0.6, fontSize: 13, fontStyle: "italic" },

  spotlight: {
    minHeight: 220,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  spotlightFrame: {
    background: "rgba(0,0,0,0.35)",
    border: "2px dashed rgba(255,255,255,0.4)",
    borderRadius: 16, padding: "28px 36px",
    textAlign: "center", minWidth: 280,
  },
  spotlightLabel: { fontSize: 13, opacity: 0.8, marginBottom: 6 },
  spotlightName:  { fontSize: 30, fontWeight: 800, letterSpacing: 1 },
  spotlightSub:   { fontSize: 12, opacity: 0.7, marginTop: 6 },

  waitCard: {
    background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: 24, textAlign: "center",
  },
  waitMain: { fontSize: 22, fontWeight: 700, marginBottom: 6 },
  waitSub:  { fontSize: 14, opacity: 0.7 },

  choiceWrap: { display: "flex", flexDirection: "column", gap: 12 },
  choiceBtn: {
    flex: 1, padding: "28px 16px", borderRadius: 16, border: "none", cursor: "pointer",
    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
    fontFamily: "inherit",
  },
  choiceTruth: { background: "#2a7fff", color: "#fff" },
  choiceDare:  { background: "#ff4d6d", color: "#fff" },
  choiceEmoji: { fontSize: 40 },
  choiceLabel: { fontSize: 24, fontWeight: 800, letterSpacing: 1 },
  choiceSub:   { fontSize: 13, opacity: 0.85 },
  choiceMinorRow: { display: "flex", gap: 10 },
  choiceMinorBtn: {
    flex: 1, padding: "12px 14px", borderRadius: 10, border: "none",
    cursor: "pointer", fontWeight: 700, fontFamily: "inherit", fontSize: 14,
  },

  challengeCard: {
    background: "rgba(0,0,0,0.35)", borderRadius: 14, padding: 18,
    display: "flex", flexDirection: "column", gap: 14,
  },
  challengeTopRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  catBadge: { background: "#3a3a6e", padding: "4px 10px", borderRadius: 999, fontSize: 13 },
  typeBadge: { background: "#ff4d6d", color: "#fff", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700 },
  challengePrompt: { fontSize: 20, lineHeight: 1.35, fontWeight: 600 },
  timerBar: {
    position: "relative", height: 14, background: "rgba(255,255,255,0.1)", borderRadius: 8, overflow: "hidden",
  },
  timerFill: {
    position: "absolute", top: 0, left: 0, bottom: 0,
    background: "linear-gradient(90deg, #ffd166 0%, #ff4d6d 100%)",
    transition: "width 0.25s linear",
  },
  timerLabel: {
    position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
    color: "#fff", fontSize: 11, fontWeight: 700, textShadow: "0 0 4px rgba(0,0,0,0.6)",
  },
  doneBtn: {
    background: "#2a7fff", color: "#fff", border: "none", padding: "14px 18px",
    borderRadius: 10, fontSize: 18, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  },

  reactStrip: { position: "relative" },
  reactRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  reactBtn: {
    flex: 1, minWidth: 50, padding: "10px 8px", borderRadius: 10,
    background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.18)",
    color: "#fff", fontSize: 20, cursor: "pointer", fontFamily: "inherit",
  },
  reactFloats: {
    position: "absolute", inset: 0, pointerEvents: "none",
    display: "flex", flexWrap: "wrap", gap: 4, padding: 8,
  },
  reactFloat: {
    fontSize: 22, animation: "todFloat 1.6s ease-out forwards",
  },

  voteBar: { display: "flex", flexDirection: "column", gap: 10 },
  voteHeader: { fontSize: 14, opacity: 0.85, textAlign: "center" },
  voteRow: { display: "flex", gap: 8 },
  voteBtn: {
    flex: 1, padding: "14px 8px", borderRadius: 10, border: "none",
    color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  },
  stealBtn: {
    background: "#7c4d1d", color: "#fff", border: "1px solid #c98a3f",
    padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 700,
    fontFamily: "inherit",
  },

  rewardCard: {
    background: "rgba(0,0,0,0.35)", borderRadius: 14, padding: 24, textAlign: "center",
  },
  rewardIcon: { fontSize: 48, marginBottom: 6 },
  rewardHeadline: { fontSize: 22, fontWeight: 800, marginBottom: 6 },
  rewardPoints: { fontSize: 20, color: "#ffd166", marginBottom: 6 },
  rewardItem:  { fontSize: 14, color: "#aef1ff" },
  rewardHint:  { fontSize: 13, opacity: 0.75, marginTop: 10, fontStyle: "italic" },

  endPanel: {
    background: "rgba(0,0,0,0.35)", borderRadius: 14, padding: 24, textAlign: "center",
  },
  endIcon: { fontSize: 48, marginBottom: 6 },
  endHeadline: { fontSize: 22, fontWeight: 800, marginBottom: 6 },
  endPoints: { fontSize: 18, color: "#ffd166", marginBottom: 14 },
  endBtn: {
    background: "#2a7fff", color: "#fff", border: "none", padding: "12px 22px",
    borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  },
  endNote: { fontSize: 14, opacity: 0.75 },
};
