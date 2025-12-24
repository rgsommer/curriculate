// student-app/src/components/tasks/types/NarrationSynthesizeTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * NarrationSynthesizeTask
 * Turn-based oral teach-back / narration task.
 *
 * Expected task shape (from backend):
 * task = {
 *   taskType: "narration-synthesize",
 *   title,
 *   prompt,
 *   config: {
 *     playerCount: 2-8,
 *     playerNames: [],
 *     perTurnSeconds: 0|60 (optional),
 *     prompts: [{ id, concept, prompt }], // one per player
 *     ratingScale: { min:1, max:5, label:"Clarity / Accuracy / Quality" }
 *   }
 * }
 */
export default function NarrationSynthesizeTask({
  task,
  onSubmit,
  socket, // unused currently (kept for parity with other tasks)
  roomCode, // unused
  teamId, // unused
}) {
  const config = (task && task.config && typeof task.config === "object") ? task.config : {};
  const playerCount = clampInt(config.playerCount, 1, 8, 4);

  const playerNames = useMemo(() => {
    const namesRaw = Array.isArray(config.playerNames) ? config.playerNames : [];
    if (namesRaw.length >= playerCount) {
      return namesRaw.slice(0, playerCount).map((n, i) => safeName(n, i));
    }
    return Array.from({ length: playerCount }, (_, i) => safeName(namesRaw[i], i));
  }, [config.playerNames, playerCount]);

  const prompts = useMemo(() => {
    const raw = Array.isArray(config.prompts) ? config.prompts : [];
    if (!raw.length) {
      return Array.from({ length: playerCount }, (_, i) => ({
        id: `p${i + 1}`,
        concept: `Concept ${i + 1}`,
        prompt:
          `Explain a key idea from today's lesson in your own words. Include what it is, how it works, and one example.`,
      }));
    }
    return Array.from({ length: playerCount }, (_, i) => {
      const p = raw[i] || raw[i % raw.length] || {};
      const concept = String(p.concept || p.title || `Concept ${i + 1}`).trim().slice(0, 80);
      const prompt = String(p.prompt || p.text || `Explain "${concept}" in your own words.`)
        .trim()
        .slice(0, 420);
      return {
        id: String(p.id || `p${i + 1}`),
        concept,
        prompt,
      };
    });
  }, [config.prompts, playerCount]);

  const ratingScale = useMemo(() => {
    const rs = (config.ratingScale && typeof config.ratingScale === "object") ? config.ratingScale : {};
    const min = clampInt(rs.min, 0, 10, 1);
    const max = clampInt(rs.max, 1, 10, 5);
    return {
      min: Math.min(min, max),
      max: Math.max(min, max),
      label: String(rs.label || "Clarity / Accuracy / Quality").trim().slice(0, 80),
    };
  }, [config.ratingScale]);

  const perTurnSeconds = clampInt(config.perTurnSeconds, 0, 600, 60);

  // Flow state
  const [turnIndex, setTurnIndex] = useState(0); // 0-based
  const [phase, setPhase] = useState("prompt"); // prompt | speaking | rate | done
  const [secondsLeft, setSecondsLeft] = useState(perTurnSeconds);
  const timerRef = useRef(null);

  const [ratings, setRatings] = useState(() =>
    Array.from({ length: playerCount }, () => ({
      value: Math.round((ratingScale.min + ratingScale.max) / 2),
    }))
  );

  // Reset timer when turn changes or perTurnSeconds changes
  useEffect(() => {
    stopTimer();
    setSecondsLeft(perTurnSeconds);
  }, [turnIndex, perTurnSeconds]);

  useEffect(() => {
    return () => stopTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = prompts[turnIndex] || prompts[0];
  const turnLabel = `Turn ${turnIndex + 1} of ${playerCount}`;
  const currentName = playerNames[turnIndex] || `Player ${turnIndex + 1}`;

  const canUseTimer = perTurnSeconds > 0;

  function startTimer() {
    if (!canUseTimer) return;
    stopTimer();
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        const next = Math.max(0, (Number(s) || 0) - 1);
        if (next <= 0) {
          stopTimer();
          setPhase("rate");
        }
        return next;
      });
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function goToSpeaking() {
    setPhase("speaking");
    startTimer();
  }

  function finishSpeaking() {
    stopTimer();
    setPhase("rate");
  }

  function setRatingForTurn(val) {
    const v = clampInt(val, ratingScale.min, ratingScale.max, ratingScale.min);
    setRatings((prev) => {
      const next = [...prev];
      next[turnIndex] = { value: v };
      return next;
    });
  }

  function nextTurn() {
    if (turnIndex + 1 >= playerCount) {
      setPhase("done");
      stopTimer();
      return;
    }
    setTurnIndex((i) => i + 1);
    setPhase("prompt");
  }

  async function submitAll() {
    const payload = {
      taskType: task?.taskType || "narration-synthesize",
      ratings: ratings.map((r, i) => ({
        playerIndex: i,
        playerName: playerNames[i],
        score: clampInt(r?.value, ratingScale.min, ratingScale.max, ratingScale.min),
      })),
      ratingScale,
      prompts,
      perTurnSeconds,
      completedAt: new Date().toISOString(),
    };

    try {
      await onSubmit(payload);
    } catch (e) {
      try {
        await onSubmit({ answerPayload: payload });
      } catch (_) {}
    }
  }

  // ----- UI helpers -----
  const cardStyle = {
    borderRadius: 18,
    padding: 16,
    border: "1px solid rgba(148,163,184,0.6)",
    boxShadow: "0 10px 28px rgba(2,6,23,0.08)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.92))",
    maxWidth: 860,
    margin: "0 auto",
  };

  const headerRow = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  };

  const pill = (bg) => ({
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 700,
    border: "1px solid rgba(148,163,184,0.55)",
    background: bg,
    color: "#0f172a",
    whiteSpace: "nowrap",
  });

  const bigTitle = {
    fontSize: 22,
    fontWeight: 900,
    letterSpacing: "-0.02em",
    margin: 0,
    color: "#0f172a",
  };

  const subtitle = {
    margin: "6px 0 0 0",
    color: "#334155",
    fontSize: 14,
    lineHeight: 1.35,
  };

  const promptBox = {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    border: "1px solid rgba(203,213,225,0.9)",
    background:
      "linear-gradient(180deg, rgba(241,245,249,0.95), rgba(255,255,255,0.95))",
  };

  const conceptStyle = {
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: "0.02em",
    color: "#1e293b",
    textTransform: "uppercase",
    margin: "0 0 8px 0",
    opacity: 0.9,
  };

  const promptStyle = {
    fontSize: 20,
    fontWeight: 800,
    color: "#0f172a",
    margin: 0,
    lineHeight: 1.25,
  };

  const hintStyle = {
    fontSize: 13,
    color: "#475569",
    marginTop: 10,
    lineHeight: 1.35,
  };

  const btnBase = {
    borderRadius: 14,
    padding: "12px 14px",
    border: "1px solid rgba(148,163,184,0.7)",
    background: "white",
    color: "#0f172a",
    fontWeight: 900,
    fontSize: 15,
    cursor: "pointer",
    boxShadow: "0 6px 16px rgba(2,6,23,0.08)",
  };

  const btnPrimary = {
    ...btnBase,
    border: "1px solid rgba(59,130,246,0.45)",
    background:
      "linear-gradient(180deg, rgba(59,130,246,0.16), rgba(255,255,255,0.9))",
  };

  const btnSuccess = {
    ...btnBase,
    border: "1px solid rgba(34,197,94,0.45)",
    background:
      "linear-gradient(180deg, rgba(34,197,94,0.14), rgba(255,255,255,0.9))",
  };

  const btnMuted = {
    ...btnBase,
    opacity: 0.6,
    cursor: "not-allowed",
  };

  const footerRow = {
    display: "flex",
    gap: 10,
    justifyContent: "flex-end",
    marginTop: 14,
    flexWrap: "wrap",
  };

  return (
    <div style={cardStyle}>
      <div style={headerRow}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 900, color: "#64748b" }}>
            Narration Synthesize
          </p>
          <h2 style={bigTitle}>{task?.title || "Teach-back Turns"}</h2>
          <p style={subtitle}>
            {task?.prompt ||
              "Take turns explaining out loud. After each turn, the group rates the explanation."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={pill("rgba(224,231,255,0.75)")}>{turnLabel}</span>
          <span style={pill("rgba(254,249,195,0.8)")}>{currentName}</span>
          {canUseTimer ? (
            <span style={pill("rgba(255,255,255,0.8)")}>
              ⏱ {String(secondsLeft).padStart(2, "0")}s
            </span>
          ) : (
            <span style={pill("rgba(241,245,249,0.9)")}>No timer</span>
          )}
        </div>
      </div>

      {phase !== "done" && (
        <div style={promptBox}>
          <div style={conceptStyle}>{current?.concept || "Concept"}</div>
          <p style={promptStyle}>{current?.prompt || "Explain the concept out loud."}</p>
          <div style={hintStyle}>
            Speak to your group (not silently). Aim for: what it is • how it works • one example.
          </div>
        </div>
      )}

      {phase === "prompt" && (
        <div style={footerRow}>
          <button style={btnPrimary} onClick={goToSpeaking}>
            Start Turn
          </button>
        </div>
      )}

      {phase === "speaking" && (
        <div style={footerRow}>
          <button style={btnSuccess} onClick={finishSpeaking}>
            Finished
          </button>
        </div>
      )}

      {phase === "rate" && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              borderRadius: 14,
              padding: 14,
              border: "1px solid rgba(203,213,225,0.9)",
              background:
                "linear-gradient(180deg, rgba(236,254,255,0.92), rgba(255,255,255,0.95))",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>
              Peer rating
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: "#334155" }}>
              Slide to rate this explanation: <b>{ratingScale.label}</b>
            </div>

            <div style={{ marginTop: 12 }}>
              <input
                type="range"
                min={ratingScale.min}
                max={ratingScale.max}
                value={clampInt(ratings[turnIndex]?.value, ratingScale.min, ratingScale.max, ratingScale.min)}
                onChange={(e) => setRatingForTurn(e.target.value)}
                style={{ width: "100%" }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 6,
                  color: "#64748b",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                <span>{ratingScale.min}</span>
                <span style={{ color: "#0f172a" }}>
                  Score:{" "}
                  {clampInt(
                    ratings[turnIndex]?.value,
                    ratingScale.min,
                    ratingScale.max,
                    ratingScale.min
                  )}
                </span>
                <span>{ratingScale.max}</span>
              </div>
            </div>
          </div>

          <div style={footerRow}>
            <button style={btnPrimary} onClick={nextTurn}>
              {turnIndex + 1 >= playerCount ? "Finish Task" : "Next Player"}
            </button>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              borderRadius: 14,
              padding: 14,
              border: "1px solid rgba(187,247,208,0.95)",
              background:
                "linear-gradient(180deg, rgba(220,252,231,0.75), rgba(255,255,255,0.96))",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 950, color: "#052e16" }}>
              All turns complete ✅
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: "#14532d" }}>
              Tap submit to send your team’s ratings.
            </div>

            <div style={{ marginTop: 12 }}>
              {ratings.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 10px",
                    borderRadius: 12,
                    border: "1px solid rgba(203,213,225,0.9)",
                    background: "rgba(255,255,255,0.8)",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontWeight: 900, color: "#0f172a" }}>
                    {playerNames[i] || `Player ${i + 1}`}
                  </div>
                  <div style={{ fontWeight: 950, color: "#0f172a" }}>
                    {clampInt(r?.value, ratingScale.min, ratingScale.max, ratingScale.min)}
                  </div>
                </div>
              ))}
            </div>

            <div style={footerRow}>
              <button style={btnSuccess} onClick={submitAll}>
                Submit
              </button>
              <button
                style={btnMuted}
                onClick={() => {
                  setTurnIndex(0);
                  setPhase("prompt");
                  setRatings(
                    Array.from({ length: playerCount }, () => ({
                      value: Math.round((ratingScale.min + ratingScale.max) / 2),
                    }))
                  );
                  setSecondsLeft(perTurnSeconds);
                }}
              >
                Reset (local)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- helpers ----
function clampInt(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.round(n);
  return Math.max(min, Math.min(max, i));
}

function safeName(v, i) {
  const s = String(v || "").trim();
  if (!s) return `Player ${i + 1}`;
  return s.slice(0, 24);
}
