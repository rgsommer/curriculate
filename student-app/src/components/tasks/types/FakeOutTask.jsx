// student-app/src/components/tasks/types/FakeOutTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * FakeOutTask (Balderdash-style, intra-team only)
 * - One "Reader" holds the device and reads the statement aloud.
 * - The team LISTENS; Reader records each player's vote.
 * - AI provides 3 "given" options (2 clever fakes + 1 correct) and (optionally) a clearly silly one.
 * - Any blank option slots are for the Reader to make up aloud (Balderdash-style).
 *
 * Reporting payload: onSubmit({ type:"fake-out", roundIndex, statement, options, correctIndex, votes, playerNames, readerIndex, correctPlayers, fooledPlayers, points, ... })
 */

function normStr(x) {
  return String(x ?? "").trim();
}

// deterministic shuffle (stable per task/round) so joke option isn't always #4
function seededShuffle(array, seedStr) {
  const copy = [...array];

  let seed = 0;
  const s = String(seedStr || "");
  for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) >>> 0;

  const rand = () => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >> 17;
    seed >>>= 0;
    seed ^= seed << 5;
    seed >>>= 0;
    return (seed >>> 0) / 4294967296;
  };

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Generate a random salt once per component instance so option order
// varies between play-throughs but stays stable during a single game.
const useStableSalt = () => {
  const ref = React.useRef(null);
  if (ref.current === null) ref.current = String(Math.random()).slice(2, 10);
  return ref.current;
};

const FakeOutTask = ({ task, onSubmit, disabled = false, readOnly = false, memberNames = [] }) => {
  const shuffleSalt = useStableSalt();
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  // Use real team size when we have real names; fall back to config
  const realNames = Array.isArray(memberNames) ? memberNames.filter(Boolean) : [];
  const playerCount = Math.max(2, Math.min(8,
    realNames.length > 0 ? realNames.length : (Number(cfg.playerCount) || 4)
  ));
  const playerNames = useMemo(() => {
    const cfgNames = Array.isArray(cfg.playerNames) ? cfg.playerNames : [];
    const cleaned = [];
    for (let i = 0; i < playerCount; i++) {
      const real = String(realNames[i] ?? "").trim();
      const cfg_ = String(cfgNames[i] ?? "").trim();
      cleaned.push(real || cfg_ || `Player ${i + 1}`);
    }
    return cleaned;
  }, [memberNames, cfg.playerNames, playerCount]);

  const rounds = useMemo(() => {
    // Prefer cfg.rounds (normal shape), but accept several fallback shapes.
    // This is important because generators sometimes put rounds in task.rounds / task.items / task.questions.
    const r =
      (Array.isArray(cfg.rounds) && cfg.rounds) ||
      (Array.isArray(task?.rounds) && task.rounds) ||
      (Array.isArray(task?.items) && task.items) ||
      (Array.isArray(task?.questions) && task.questions) ||
      [];

    const taskKey = String(task?._id || task?.id || "fakeout");

    const built = r
      .map((x, idx) => {
        const rawStatement = normStr(
          x?.statement ?? x?.prompt ?? x?.question ?? x?.text ?? ""
        );

        const statement =
          !rawStatement ||
          /^(placeholder|tbd|question goes here|insert question|n\/a)$/i.test(rawStatement)
            ? ""
            : rawStatement;

        // ----- Accept multiple shapes for options -----
        // Preferred: x.options (array)
        // Also accept: x.providedOptions / x.choices / x.answers
        const raw =
          (Array.isArray(x?.options) && x.options) ||
          (Array.isArray(x?.providedOptions) && x.providedOptions) ||
          (Array.isArray(x?.choices) && x.choices) ||
          (Array.isArray(x?.answers) && x.answers) ||
          [];

        // ----- Canonical FakeOut model with semantic roles -----
        // Always 4 options, all randomized:
        // - 2 "real" options (one correct, one plausible false)
        // - 1 obvious-false joke
        // - 1 bluff slot (blank => UI shows "make up and say ____")

        // Deduplicate options (case-insensitive) — AI sometimes generates duplicates
        const seen = new Set();
        const cleaned = raw.map((o) => normStr(o)).filter(Boolean).filter((o) => {
          const key = o.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Two real options (AI should provide these)
        const realA = cleaned[0] || "Option A";
        const realB = cleaned[1] || "Option B";

        // Obvious-false joke (explicit or synthesized)
        const explicitJoke = normStr(x?.jokeOption ?? x?.obviousFake ?? x?.funnyOption ?? "");
        const jokeText =
          explicitJoke || "Obviously false: a flying potato wrote the textbook.";

        // Determine which REAL option is correct (only 0 or 1)
        let correctRealIndex = Number(x?.correctIndex);
        if (correctRealIndex !== 0 && correctRealIndex !== 1) {
          const truth = normStr(x?.correctAnswer ?? x?.answer ?? x?.truth ?? "");
          if (truth) {
            if (truth === normStr(realB)) correctRealIndex = 1;
            else correctRealIndex = 0;
          } else {
            correctRealIndex = 0;
          }
        }

        // Build semantic options (objects), then shuffle safely
        let semantic = [
          { text: realA, role: "real", isCorrect: correctRealIndex === 0 },
          { text: realB, role: "real", isCorrect: correctRealIndex === 1 },
          { text: jokeText, role: "joke", isCorrect: false },
          { text: "", role: "bluff", isCorrect: false },
        ];

        semantic = seededShuffle(semantic, `${taskKey}:round:${idx}:${shuffleSalt}:${statement}`);

        // Extract for UI
        const options = semantic.map((o) => o.text);
        const newCorrectIndex = semantic.findIndex((o) => o.isCorrect);
        const newJokeIndex = semantic.findIndex((o) => o.role === "joke");

        const safeCorrectIndex =
          Number.isFinite(newCorrectIndex) && newCorrectIndex >= 0 && newCorrectIndex <= 3
            ? newCorrectIndex
            : 0;

        return {
          statement,
          options,
          correctIndex: safeCorrectIndex,
          jokeIndex: newJokeIndex,
          blanks: semantic.map((o) => o.role === "bluff"), // ONLY the bluff slot is blank
        };
      })
      .filter((x) => x.statement);

    // Last-resort fallback: if we can at least show ONE round, do so.
    // (This prevents the UI from hard-failing with "No rounds provided" when the task payload is slightly off.)
    if (built.length > 0) return built;

    const fallbackStatement = normStr(task?.prompt ?? task?.title ?? "");
    const fallbackOptionsRaw =
      (Array.isArray(task?.options) && task.options) ||
      (Array.isArray(task?.choices) && task.choices) ||
      (Array.isArray(task?.answers) && task.answers) ||
      [];
    const fallbackOptions = fallbackOptionsRaw.map((o) => normStr(o)).filter(Boolean).slice(0, 4);
    while (fallbackOptions.length < 4) fallbackOptions.push("");

    if (!fallbackStatement) return [];
    return [
      {
        statement: fallbackStatement,
        options: fallbackOptions,
        correctIndex: 0,
        jokeIndex: -1,
        blanks: fallbackOptions.map((o) => !normStr(o)),
      },
    ];
  }, [cfg.rounds, task?._id, task?.id, shuffleSalt]);

  const pointsPerCorrect = Math.max(1, Math.min(50, Number(cfg.pointsPerCorrect) || 10));
  const readerBonusPoints = Math.max(0, Math.min(50, Number(cfg.readerBonusPoints) || 5));

  // Phase flow: "intro" → "pass" → "game"
  // "intro" shows what Fake Out is; "pass" gates the reader taking the device; "game" is gameplay
  const [phase, setPhase] = useState("intro");

  const [roundIndex, setRoundIndex] = useState(0);
  const [readerIndex, setReaderIndex] = useState(0); // 0-based
  const [votes, setVotes] = useState(Array(playerCount).fill(null)); // null or 0..3
  const [revealed, setRevealed] = useState(false);

  // overlay countdown between rounds (keeps the "big reveal" moment consistent with Curriculate style)
  const [overlaySeconds, setOverlaySeconds] = useState(0);
  const overlayRef = useRef(null);

  const round = rounds[roundIndex];

  useEffect(() => {
    // reset state on round change — go to "pass" phase so reader takes device
    setVotes(Array(playerCount).fill(null));
    setRevealed(false);
    setOverlaySeconds(0);
    if (overlayRef.current) {
      clearInterval(overlayRef.current);
      overlayRef.current = null;
    }
    // After the first intro, subsequent rounds go straight to pass
    if (roundIndex > 0) setPhase("pass");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundIndex, readerIndex, playerCount]);

  const setPlayerVote = (playerIdx, optionIdx) => {
    if (revealed) return;
    if (disabled || readOnly) return;
    if (playerIdx === readerIndex) return; // Reader doesn't vote
    setVotes((prev) => {
      const next = [...prev];
      next[playerIdx] = optionIdx;
      return next;
    });
  };

  const allNonReaderVoted = useMemo(() => {
    return votes.every((v, idx) => idx === readerIndex || v !== null);
  }, [votes, readerIndex]);

  const computeOutcome = () => {
    const correctIndex = round?.correctIndex ?? 0;

    const correctPlayers = [];
    const fooledPlayers = [];
    for (let i = 0; i < playerCount; i++) {
      if (i === readerIndex) continue;
      const v = votes[i];
      if (v === null || v === undefined) continue;
      if (v === correctIndex) correctPlayers.push(i);
      else fooledPlayers.push(i);
    }

    const teamPoints = correctPlayers.length * pointsPerCorrect;
    const readerBonus = fooledPlayers.length > 0 ? readerBonusPoints : 0;

    return { correctIndex, correctPlayers, fooledPlayers, teamPoints, readerBonus };
  };

  // Accumulate round results internally — only call onSubmit once at the end
  const roundResultsRef = useRef([]);

  const submitAndReveal = () => {
    if (!round) return;
    if (!allNonReaderVoted) return;
    if (disabled || readOnly) return;

    const { correctIndex, correctPlayers, fooledPlayers, teamPoints, readerBonus } = computeOutcome();
    setRevealed(true);

    // Store this round's result locally
    roundResultsRef.current.push({
      roundIndex,
      readerIndex,
      readerName: playerNames[readerIndex],
      statement: round.statement,
      options: round.options,
      correctIndex,
      jokeIndex: round?.jokeIndex ?? -1,
      votes: [...votes],
      correctPlayers,
      fooledPlayers,
      teamPoints,
      readerBonus,
    });

    // Big reveal overlay timer
    startOverlayTimer();
  };

  const startOverlayTimer = () => {
    const seconds = 4;
    setOverlaySeconds(seconds);
    if (overlayRef.current) clearInterval(overlayRef.current);
    overlayRef.current = setInterval(() => {
      setOverlaySeconds((s) => {
        const next = s - 1;
        if (next <= 0) {
          if (overlayRef.current) clearInterval(overlayRef.current);
          overlayRef.current = null;
          goNext();
          return 0;
        }
        return next;
      });
    }, 1000);
  };

  const goNext = () => {
    if (!rounds.length) return;

    // Last round → submit everything at once
    if (roundIndex >= rounds.length - 1) {
      const allResults = roundResultsRef.current;
      const totalTeamPoints = allResults.reduce((s, r) => s + (r.teamPoints || 0), 0);
      const totalReaderBonus = allResults.reduce((s, r) => s + (r.readerBonus || 0), 0);

      onSubmit?.({
        type: "fake-out",
        taskType: "fake-out",
        taskId: task?._id || task?.id || undefined,
        title: task?.title || "Fake Out",
        gameComplete: true,
        completed: true,
        playerNames,
        totalRounds: rounds.length,
        rounds: allResults,
        totalTeamPoints,
        totalReaderBonus,
        pointsPerCorrect,
        readerBonusPoints,
        interTeamEnabled: false,
        intraTeamEnabled: true,
        submittedAt: new Date().toISOString(),
      });
      return;
    }

    // More rounds to go — advance internally (no onSubmit)
    setRoundIndex((r) => r + 1);
    setReaderIndex((ri) => (ri + 1) % playerCount);
  };

  if (!rounds.length || !round) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ fontWeight: 900, fontSize: 20 }}>Fake Out</div>
        <div style={{ marginTop: 8, color: "#64748b" }}>
          No rounds were provided for this task. Regenerate to try again.
        </div>
      </div>
    );
  }

  const { correctIndex, correctPlayers, fooledPlayers, teamPoints, readerBonus } = revealed
    ? computeOutcome()
    : {
        correctIndex: round.correctIndex,
        correctPlayers: [],
        fooledPlayers: [],
        teamPoints: 0,
        readerBonus: 0,
      };

  const readerName = playerNames[readerIndex] || `Player ${readerIndex + 1}`;

  // ─── Shared styles ───
  const bigBtn = (bg = "#22c55e", color = "#fff") => ({
    padding: "16px 28px",
    borderRadius: 999,
    border: "none",
    background: bg,
    color,
    fontWeight: 900,
    fontSize: "1.3rem",
    cursor: "pointer",
    boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
  });

  const phaseContainer = {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: 32,
    gap: 20,
  };

  // ─── INTRO PHASE: explain the game ───
  if (phase === "intro") {
    return (
      <div style={phaseContainer}>
        <div style={{ fontSize: "4rem" }}>🃏</div>
        <div style={{ fontSize: "2.2rem", fontWeight: 900, color: "#0f172a" }}>Fake Out!</div>
        <div
          style={{
            background: "linear-gradient(135deg, #eef2ff, #f0fdf4)",
            borderRadius: 20,
            padding: "20px 28px",
            maxWidth: 420,
            width: "100%",
            textAlign: "left",
            fontSize: "1.1rem",
            lineHeight: 1.7,
            border: "2px solid #e2e8f0",
            color: "#1e293b",
          }}
        >
          <div>📣 One person is the <strong>Reader</strong> each round</div>
          <div style={{ marginTop: 10 }}>📱 The Reader takes the device and reads the question + answers aloud</div>
          <div style={{ marginTop: 10 }}>🤫 Everyone else listens — <strong>no peeking at the screen!</strong></div>
          <div style={{ marginTop: 10 }}>🗳️ Each player tells the Reader their answer — the Reader taps it in</div>
          <div style={{ marginTop: 10 }}>🎉 After everyone votes, reveal who got tricked!</div>
        </div>
        <div style={{ fontSize: "0.95rem", color: "#64748b", marginTop: 4 }}>
          {rounds.length} round{rounds.length !== 1 ? "s" : ""} • Reader rotates each round
        </div>
        <button
          type="button"
          style={bigBtn("#2563eb")}
          onClick={() => setPhase("pass")}
        >
          Let's go! →
        </button>
      </div>
    );
  }

  // ─── PASS PHASE: hand the device to the reader ───
  if (phase === "pass") {
    return (
      <div style={phaseContainer}>
        <div style={{ fontSize: "1.3rem", color: "#64748b" }}>
          Round {roundIndex + 1} of {rounds.length}
        </div>
        <div style={{ fontSize: "1.5rem", color: "#334155" }}>📱 Hand the device to:</div>
        <div style={{ fontSize: "2.8rem", fontWeight: 900, color: "#0f172a", textShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
          {readerName}
        </div>
        <div style={{ fontSize: "1rem", color: "#64748b", maxWidth: 340 }}>
          {readerName}, you'll read the question and all the answer options out loud.
          Everyone else — <strong>look away from the screen!</strong>
        </div>
        <button
          type="button"
          style={bigBtn("#f59e0b", "#000")}
          onClick={() => setPhase("game")}
        >
          I'm {readerName} — I'm ready! →
        </button>
      </div>
    );
  }

  // ─── GAME PHASE: reading + voting ───
  return (
    <div style={{ padding: 20, height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header chips */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ padding: "6px 10px", borderRadius: 999, border: "2px solid #cbd5e1", fontWeight: 900 }}>
            🃏 Round {roundIndex + 1} / {rounds.length}
          </div>
          <div style={{ padding: "6px 10px", borderRadius: 999, border: "2px solid #cbd5e1", fontWeight: 900 }}>
            📣 Reader: {readerName}
          </div>
        </div>

        <button
          onClick={submitAndReveal}
          disabled={!allNonReaderVoted || revealed || disabled || readOnly}
          style={{
            padding: "10px 14px",
            borderRadius: 999,
            border: "none",
            background: revealed ? "#0f172a" : allNonReaderVoted ? "#16a34a" : "#9ca3af",
            color: "#fff",
            fontWeight: 900,
            cursor: !allNonReaderVoted || revealed || disabled || readOnly ? "not-allowed" : "pointer",
            opacity: disabled || readOnly ? 0.7 : 1,
          }}
          title={
            readOnly
              ? "Review mode"
              : revealed
              ? "Revealed"
              : allNonReaderVoted
              ? "Reveal the correct answer"
              : "Record all votes first"
          }
        >
          {revealed ? "Revealed" : "Reveal & Score"}
        </button>
      </div>

      {/* Statement card — Reader reads this aloud */}
      <div
        style={{
          marginTop: 14,
          padding: 16,
          borderRadius: 16,
          border: "2px solid #e2e8f0",
          background: "linear-gradient(135deg, #ffffff, #eef2ff)",
        }}
      >
        <div style={{ fontWeight: 900, color: "#334155", fontSize: 14 }}>
          📣 {readerName}, read the question aloud:
        </div>
        <div
          style={{
            marginTop: 8,
            fontWeight: 1000,
            fontSize: 18,
            lineHeight: 1.25,
            color: "#b91c1c",
          }}
        >
          {round.statement}
        </div>
        <div style={{ marginTop: 8, color: "#475569", fontSize: 13 }}>
          Now read each option aloud. After everyone picks, tap their name under their choice.
        </div>
      </div>

      {/* Options list */}
      <div style={{ flex: 1, overflow: "auto", marginTop: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {round.options.map((opt, i) => {
            const isCorrect = revealed && i === correctIndex;
            const isJoke = Number.isInteger(round?.jokeIndex) && round.jokeIndex === i;

            const isBlank = Array.isArray(round?.blanks) ? !!round.blanks[i] : !normStr(opt);

            const displayText = isBlank
              ? `🎭 Make something up! Say it with a straight face...`
              : opt;

            return (
              <div
                key={i}
                style={{
                  padding: 18,
                  background: "#fff",
                  borderRadius: 16,
                  border: isCorrect ? "3px solid #16a34a" : "3px solid #e2e8f0",
                  boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ fontWeight: 900, color: "#b91c1c" }}>
                    Read: "Option {i + 1}{!isBlank ? ":" : ""}"
                  </div>
                  {isJoke && (
                    <div
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: "#fff7ed",
                        border: "2px solid #fdba74",
                        color: "#9a3412",
                        fontWeight: 900,
                        fontSize: 12,
                        whiteSpace: "nowrap",
                      }}
                    >
                      🤪 Silly one
                    </div>
                  )}
                  {isBlank && (
                    <div
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: "#fef3c7",
                        border: "2px solid #fcd34d",
                        color: "#92400e",
                        fontWeight: 900,
                        fontSize: 12,
                        whiteSpace: "nowrap",
                      }}
                    >
                      🎭 You invent this one!
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 8, fontSize: 16, lineHeight: 1.25, color: isBlank ? "#92400e" : "#b91c1c", fontWeight: 900, fontStyle: isBlank ? "italic" : "normal" }}>
                  {displayText}
                </div>

                {/* Per-player vote chips */}
                <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {playerNames.map((name, pIdx) => {
                    const voted = votes[pIdx] === i;
                    const isReader = pIdx === readerIndex;

                    return (
                      <button
                        key={pIdx}
                        disabled={isReader || revealed || disabled || readOnly}
                        onClick={() => setPlayerVote(pIdx, i)}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 999,
                          border: voted ? "2px solid #0ea5e9" : "2px solid #cbd5e1",
                          background: voted ? "#eff6ff" : "#f8fafc",
                          color: "#0f172a",
                          fontWeight: 800,
                          cursor: isReader || revealed || disabled || readOnly ? "not-allowed" : "pointer",
                          opacity: isReader ? 0.6 : disabled || readOnly ? 0.7 : 1,
                        }}
                        title={
                          isReader
                            ? "Reader does not vote"
                            : readOnly
                            ? "Review mode"
                            : "Tap to set this player's vote"
                        }
                      >
                        {name} {isReader ? "📣" : voted ? "✓" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reveal footer */}
      {revealed && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 16,
            border: "2px solid #e2e8f0",
            background: "#0f172a",
            color: "#fff",
          }}
        >
          <div style={{ fontWeight: 1000, fontSize: 16 }}>
            ✅ Correct: Option {correctIndex + 1}
          </div>
          <div style={{ marginTop: 6, fontSize: 14, color: "rgba(255,255,255,0.85)" }}>
            {correctPlayers.length} correct • {fooledPlayers.length} fooled • Team +{teamPoints} pts
            {readerBonus ? ` • Reader +${readerBonus} bonus` : ""}
          </div>
        </div>
      )}

      {/* Overlay between rounds */}
      {revealed && overlaySeconds > 0 && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.88)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            textAlign: "center",
            padding: 20,
          }}
        >
          <div>
            <div style={{ fontSize: "2.2rem", fontWeight: 1000 }}>🎉 Reveal!</div>
            <div style={{ marginTop: 14, fontSize: "1.4rem" }}>
              Next round in <span style={{ fontWeight: 1000 }}>{overlaySeconds}</span>…
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FakeOutTask;
