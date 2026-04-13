// student-app/src/components/tasks/types/ReadingCompTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { TaskCardFrame, Pill, PrimaryButton, GhostButton, TextArea } from "../taskStyles";
import DesignatedWriter from "../DesignatedWriter";

/**
 * ReadingCompTask - Premium Gaming-Quality UX
 * - Solo: write a 1‑sentence reading‑comprehension response to a generated paragraph.
 * - Intra‑team variation (task.isTeamVariation === true):
 *    Each player writes a private 1‑sentence response, taps Submit (locks),
 *    then a brief "pass the device" screen appears.
 *    After the final player submits, all responses are revealed and the team votes on the best.
 */

// ============================================================================
// Keyframe Animations (CSS-in-JS)
// ============================================================================
const keyframes = `
  @keyframes shimmer {
    0% { background-position: -1000px 0; }
    100% { background-position: 1000px 0; }
  }

  @keyframes sparkleFloat {
    0% {
      opacity: 1;
      transform: translateY(0px) scale(1);
    }
    100% {
      opacity: 0;
      transform: translateY(-30px) scale(0.3);
    }
  }

  @keyframes popIn {
    0% {
      opacity: 0;
      transform: scale(0.85) translateY(20px);
    }
    100% {
      opacity: 1;
      transform: scale(1) translateY(0px);
    }
  }

  @keyframes slideInRight {
    0% {
      opacity: 0;
      transform: translateX(40px);
    }
    100% {
      opacity: 1;
      transform: translateX(0px);
    }
  }

  @keyframes slideInLeft {
    0% {
      opacity: 0;
      transform: translateX(-40px);
    }
    100% {
      opacity: 1;
      transform: translateX(0px);
    }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  @keyframes glow {
    0%, 100% {
      box-shadow: 0 0 10px rgba(59, 130, 246, 0.3);
    }
    50% {
      box-shadow: 0 0 25px rgba(59, 130, 246, 0.7);
    }
  }

  @keyframes confetti {
    0% {
      transform: translateY(0) rotateZ(0deg);
      opacity: 1;
    }
    100% {
      transform: translateY(-100px) rotateZ(360deg);
      opacity: 0;
    }
  }

  @keyframes scoreFloat {
    0% {
      opacity: 1;
      transform: translateY(0px) scale(1);
    }
    100% {
      opacity: 0;
      transform: translateY(-50px) scale(0.5);
    }
  }

  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
  }
`;

// Particle effect component
function Sparkles({ count = 8 }) {
  const particles = Array.from({ length: count });

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {particles.map((_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const offsetX = Math.cos(angle) * 30;
        const offsetY = Math.sin(angle) * 30;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: `hsl(${Math.random() * 60 + 200}, 100%, 60%)`,
              marginLeft: -3,
              marginTop: -3,
              animation: `sparkleFloat 0.8s ease-out forwards`,
              animationDelay: `${i * 0.05}s`,
            }}
          />
        );
      })}
    </div>
  );
}

// Confetti effect
function Confetti({ count = 30 }) {
  const pieces = Array.from({ length: count });

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none" }}>
      {pieces.map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.2;
        const duration = 2 + Math.random() * 0.5;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${left}%`,
              top: -10,
              width: 8,
              height: 8,
              background: `hsl(${Math.random() * 360}, 70%, 55%)`,
              borderRadius: "50%",
              animation: `confetti ${duration}s linear forwards`,
              animationDelay: `${delay}s`,
            }}
          />
        );
      })}
    </div>
  );
}

// Score float animation
function ScoreFloat({ value, color = "#10b981" }) {
  return (
    <div
      style={{
        position: "absolute",
        right: 20,
        top: 20,
        fontSize: 24,
        fontWeight: 900,
        color,
        animation: `scoreFloat 1.2s ease-out forwards`,
        textShadow: `0 0 8px rgba(0,0,0,0.2)`,
      }}
    >
      +{value}
    </div>
  );
}

export default function ReadingCompTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
  teamId = null,
  memberNames = [],
  roomCode = null,
}) {
  // ============================================================================
  // State & Setup
  // ============================================================================
  const isTeamVariation = !!task?.isTeamVariation;

  // Paragraph extraction
  const paragraph =
    task?.passage ||
    task?.generatedParagraph ||
    task?.paragraph ||
    task?.text ||
    task?.config?.passage ||
    task?.config?.text ||
    task?.config?.generatedParagraph ||
    task?.config?.paragraph ||
    "";

  const sentenceTarget =
    typeof task?.gradeLevel === "number"
      ? task.gradeLevel
      : typeof task?.config?.gradeLevel === "number"
      ? task.config.gradeLevel
      : null;

  const gradeLevel =
    typeof task?.gradeLevel === "number"
      ? task.gradeLevel
      : typeof task?.config?.gradeLevel === "number"
      ? task.config.gradeLevel
      : null;

  const players = useMemo(() => {
    const cleaned = Array.isArray(memberNames)
      ? memberNames.map((n) => String(n || "").trim()).filter(Boolean)
      : [];
    if (cleaned.length) return cleaned;

    const hintedSize =
      (typeof task?.teamSize === "number" && task.teamSize > 0 && task.teamSize) ||
      (typeof task?.config?.teamSize === "number" && task.config?.teamSize > 0 && task.config.teamSize) ||
      3;

    return Array.from({ length: hintedSize }, (_, i) => `Player ${i + 1}`);
  }, [memberNames, task]);

  // Speech recognition
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);
  const canUseSpeech = (() => {
    try {
      return (
        typeof window !== "undefined" &&
        (window.SpeechRecognition || window.webkitSpeechRecognition)
      );
    } catch {
      return false;
    }
  })();

  const startDictation = (appendFn) => {
    if (!canUseSpeech || disabled) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    recognitionRef.current = rec;
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";

    rec.onresult = (e) => {
      const text = e?.results?.[0]?.[0]?.transcript || "";
      if (text) appendFn(text);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);

    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  };

  const stopDictation = () => {
    try {
      recognitionRef.current?.stop?.();
    } catch {}
    setListening(false);
  };

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop?.();
      } catch {}
    };
  }, []);

  // ============================================================================
  // SOLO MODE STATE
  // ============================================================================
  const [soloAnswer, setSoloAnswer] = useState(() => String(answerDraft || ""));
  const [soloStage, setSoloStage] = useState("answer"); // "answer" | "followup"
  const [soloFollowUpQuestion, setSoloFollowUpQuestion] = useState("");
  const [soloFollowUpAnswer, setSoloFollowUpAnswer] = useState("");
  const [soloChecking, setSoloChecking] = useState(false);
  const [soloError, setSoloError] = useState("");
  const [soloFeedback, setSoloFeedback] = useState("");
  const [soloScore, setSoloScore] = useState(0);
  const [soloShowScore, setSoloShowScore] = useState(false);
  const [soloStreak, setSoloStreak] = useState(0);

  function isCompleteSentence(text, grade) {
    const t = String(text || "").trim();
    if (!t) return false;
    if ((grade || 0) < 5) return true;

    const words = t.split(/\s+/).filter(Boolean);
    if (words.length < 4) return false;

    const hasEnding = /[.!?]$/.test(t);
    const hasVerbishWord =
      /\b(is|are|was|were|be|being|been|has|have|had|do|does|did|can|could|will|would|should|may|might|must|shows?|means?|helps?|changes?|protects?|needs?|uses?|relies?|affects?|hurts?|keeps?|makes?)\b/i.test(t);
    return hasEnding && hasVerbishWord;
  }

  async function checkReadingComprehension({ paragraph, answer, gradeLevel }) {
    const base =
      process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.curriculate.net";

    const res = await fetch(`${base}/api/tasks/reading-comp/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paragraph,
        answer,
        gradeLevel,
      }),
    });

    if (!res.ok) {
      throw new Error("Failed to check comprehension.");
    }

    return res.json();
  }

  const submitSolo = async () => {
    if (disabled || soloChecking) return;

    setSoloError("");
    setSoloFeedback("");

    if (soloStage === "answer") {
      const ans = String(soloAnswer || "").trim();
      if (!ans) return;

      if (!isCompleteSentence(ans, gradeLevel)) {
        setSoloError("Type your response as a complete sentence.");
        return;
      }

      setSoloChecking(true);
      try {
        const result = await checkReadingComprehension({
          paragraph,
          answer: ans,
          gradeLevel,
        });

        setSoloFeedback(String(result?.feedback || "").trim());

        // Award points for correct answer
        if (result?.decision === "accept" || result?.decision === "correct") {
          const points = 50;
          setSoloScore((prev) => prev + points);
          setSoloShowScore(true);
          setSoloStreak((prev) => prev + 1);
          setTimeout(() => setSoloShowScore(false), 1500);
        }

        if (result?.decision === "followup" && result?.followUpQuestion) {
          setSoloFollowUpQuestion(result.followUpQuestion);
          setSoloStage("followup");
          setSoloChecking(false);
          return;
        }

        onSubmit?.({
          answer: ans,
          paragraph,
          mode: "solo",
          teamId,
          roomCode,
          score: soloScore + 50,
          comprehensionCheck: {
            decision: result?.decision || "accept",
            reason: result?.reason || null,
            feedback: result?.feedback || "",
          },
        });
      } catch (err) {
        setSoloError("Could not check the answer. Please try again.");
      } finally {
        setSoloChecking(false);
      }

      return;
    }

    if (soloStage === "followup") {
      const followAns = String(soloFollowUpAnswer || "").trim();
      if (!followAns) {
        setSoloError("Please answer the follow-up question.");
        return;
      }

      if (!isCompleteSentence(followAns, gradeLevel)) {
        setSoloError("Type your response as a complete sentence.");
        return;
      }

      onSubmit?.({
        answer: String(soloAnswer || "").trim(),
        paragraph,
        mode: "solo",
        teamId,
        roomCode,
        score: soloScore,
        comprehensionCheck: {
          decision: "followup_answered",
          followUpQuestion: soloFollowUpQuestion,
          followUpAnswer: followAns,
          feedback: soloFeedback || "",
        },
      });
    }
  };

  // ============================================================================
  // TEAM VARIATION MODE STATE
  // ============================================================================
  const [phase, setPhase] = useState(isTeamVariation ? "turn" : "solo");
  const [turnIdx, setTurnIdx] = useState(0);
  const [turnText, setTurnText] = useState("");
  const [responses, setResponses] = useState(() => players.map(() => ""));
  const [locked, setLocked] = useState(() => players.map(() => false));
  const [passCountdown, setPassCountdown] = useState(15);
  const passTimerRef = useRef(null);
  const [voteIdx, setVoteIdx] = useState(null);
  const [finalSent, setFinalSent] = useState(false);
  const [teamScore, setTeamScore] = useState(0);
  const [showTeamScore, setShowTeamScore] = useState(false);

  useEffect(() => {
    if (!isTeamVariation) {
      setPhase("solo");
      return;
    }
    setPhase("turn");
    setTurnIdx(0);
    setTurnText("");
    setResponses(players.map(() => ""));
    setLocked(players.map(() => false));
    setPassCountdown(15);
    setVoteIdx(null);
    setFinalSent(false);
  }, [isTeamVariation, task?.id, task?._id, paragraph, players]);

  useEffect(() => {
    if (!isTeamVariation) {
      setSoloAnswer(String(answerDraft || ""));
      setSoloStage("answer");
      setSoloFollowUpQuestion("");
      setSoloFollowUpAnswer("");
      setSoloChecking(false);
      setSoloError("");
      setSoloFeedback("");
    }
  }, [answerDraft, isTeamVariation]);

  useEffect(() => {
    if (phase !== "pass") return;
    if (passTimerRef.current) clearInterval(passTimerRef.current);

    setPassCountdown(15);
    passTimerRef.current = setInterval(() => {
      setPassCountdown((s) => {
        const next = (s ?? 0) - 1;
        return next;
      });
    }, 1000);

    return () => {
      if (passTimerRef.current) clearInterval(passTimerRef.current);
      passTimerRef.current = null;
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "pass") return;
    if (passCountdown <= 0) {
      if (passTimerRef.current) clearInterval(passTimerRef.current);
      passTimerRef.current = null;

      const next = turnIdx + 1;
      if (next >= players.length) {
        setPhase("reveal");
      } else {
        setTurnIdx(next);
        setTurnText("");
        setPhase("turn");
      }
    }
  }, [phase, passCountdown, turnIdx, players.length]);

  const lockCurrentTurn = () => {
    if (disabled) return;

    const ans = String(turnText || "").trim();
    if (!ans) return;

    if (!isCompleteSentence(ans, gradeLevel)) {
      alert("Please write a complete sentence.");
      return;
    }

    setResponses((prev) => {
      const copy = [...prev];
      copy[turnIdx] = ans;
      return copy;
    });

    setLocked((prev) => {
      const copy = [...prev];
      copy[turnIdx] = true;
      return copy;
    });

    if (turnIdx >= players.length - 1) {
      setPhase("reveal");
    } else {
      setPhase("pass");
    }
  };

  const finalizeTeamSubmit = () => {
    if (disabled || finalSent) return;
    if (voteIdx == null) return;

    setFinalSent(true);
    const points = 40;
    setTeamScore(points);
    setShowTeamScore(true);

    setTimeout(() => {
      onSubmit?.({
        mode: "team",
        paragraph,
        teamId,
        roomCode,
        players,
        responses,
        voteBestIndex: voteIdx,
        voteBestPlayer: players[voteIdx] || null,
        voteBestResponse: responses[voteIdx] || null,
        score: points,
      });
    }, 1500);
  };

  // ============================================================================
  // STYLES
  // ============================================================================
  const bookBoxStyle = {
    position: "relative",
    borderRadius: 20,
    padding: 20,
    background: "linear-gradient(135deg, #fef3c7 0%, #fef9e7 100%)",
    border: "2px solid #d97706",
    boxShadow: `
      0 0 0 1px rgba(217, 119, 6, 0.2),
      0 8px 32px rgba(217, 119, 6, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.8)
    `,
    overflow: "hidden",
  };

  const questionBoxStyle = {
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    background: "linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(99, 102, 241, 0.08) 100%)",
    border: "2px solid rgba(59, 130, 246, 0.3)",
    animation: `slideInRight 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards`,
  };

  const progressBarStyle = {
    height: 6,
    borderRadius: 3,
    background: "rgba(0, 0, 0, 0.1)",
    overflow: "hidden",
    marginBottom: 12,
  };

  const progressFillStyle = {
    height: "100%",
    background: "linear-gradient(90deg, #3b82f6 0%, #8b5cf6 50%, #ec4899 100%)",
    transition: "width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <TaskCardFrame
      title={
        String(task?.title || "").toLowerCase().includes("placeholder")
          ? "Reading Adventure"
          : task?.title || "Reading Adventure"
      }
      subtitle={
        task?.prompt ||
        "Read the passage and answer with thoughtful, complete sentences."
      }
      headerRight={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Pill tone="blue">Reading Quest</Pill>
          {isTeamVariation ? <Pill tone="purple">Multiplayer</Pill> : <Pill tone="green">Solo</Pill>}
          {soloStreak > 0 && !isTeamVariation && (
            <Pill tone="orange" style={{ animation: `bounce 1s infinite` }}>
              🔥 Streak: {soloStreak}
            </Pill>
          )}
          {(soloScore > 0 && !isTeamVariation) || (teamScore > 0 && isTeamVariation) && (
            <Pill tone="green">
              ⭐ {isTeamVariation ? teamScore : soloScore} pts
            </Pill>
          )}
        </div>
      }
    >
      <style>{keyframes}</style>

      {/* Instructions */}
      <div
        style={{
          borderRadius: 16,
          padding: 14,
          marginBottom: 12,
          border: "2px solid rgba(139, 92, 246, 0.2)",
          background: "linear-gradient(135deg, rgba(139, 92, 246, 0.05) 0%, rgba(168, 85, 247, 0.05) 100%)",
        }}
      >
        {!isTeamVariation ? (
          <div style={{ color: "#334155", lineHeight: 1.6, fontSize: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 15 }}>📖 Your Reading Quest:</div>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              <li>
                <strong>Read</strong> the passage below carefully.
              </li>
              <li>
                Write <strong>one clear sentence</strong> showing you understood it.
              </li>
              <li>
                Tap <strong>Submit</strong> to earn points!
              </li>
            </ol>
          </div>
        ) : (
          <div style={{ color: "#334155", lineHeight: 1.6, fontSize: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 15 }}>🎮 Multiplayer Adventure:</div>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              <li>
                <strong>Player {turnIdx + 1}</strong> writes one sentence privately.
              </li>
              <li>
                Tap <strong>Submit & Pass</strong> to hand off to the next player.
              </li>
              <li>
                After everyone writes, <strong>vote</strong> together for the best response!
              </li>
            </ol>
          </div>
        )}
      </div>

      <DesignatedWriter memberNames={memberNames} taskTitle={task?.title} />

      {/* Progress bar for questions */}
      {!isTeamVariation && (
        <div style={progressBarStyle}>
          <div
            style={{
              ...progressFillStyle,
              width: `${soloStage === "answer" ? 50 : 100}%`,
            }}
          />
        </div>
      )}

      {/* PASSAGE - Beautiful Book Aesthetic */}
      <div style={bookBoxStyle}>
        {/* Book spine effect */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: "linear-gradient(90deg, rgba(217, 119, 6, 0.3) 0%, rgba(217, 119, 6, 0) 100%)",
          }}
        />

        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 10, fontWeight: 700, letterSpacing: 1 }}>
          📚 READING PASSAGE
        </div>

        <div
          style={{
            lineHeight: 1.8,
            fontSize: 15,
            color: "#3f3f3f",
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
          }}
        >
          {paragraph || (
            <em style={{ opacity: 0.5 }}>Passage not available for this task.</em>
          )}
        </div>
      </div>

      {/* SOLO MODE */}
      {!isTeamVariation ? (
        <div style={{ animation: `slideInLeft 0.6s ease-out` }}>
          <div style={{ marginTop: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1e40af", marginBottom: 10 }}>
              {soloStage === "answer" ? "✍️ Your Response:" : "❓ Follow-up Question:"}
            </div>

            {soloStage === "answer" ? (
              <div style={questionBoxStyle}>
                <TextArea
                  value={soloAnswer}
                  disabled={disabled || soloChecking}
                  placeholder="Write one clear sentence showing you understood the passage…"
                  onChange={(e) => {
                    setSoloAnswer(e.target.value);
                    onAnswerChange?.(e.target.value);
                    if (soloError) setSoloError("");
                  }}
                  onPaste={(e) => e.preventDefault()}
                  rows={3}
                  style={{
                    borderRadius: 12,
                    border: "2px solid rgba(59, 130, 246, 0.3)",
                    fontSize: 14,
                    padding: 12,
                    fontFamily: "inherit",
                  }}
                />

                {canUseSpeech && (
                  <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    {listening ? (
                      <GhostButton onClick={stopDictation} disabled={disabled}>
                        🎤 Stop Listening
                      </GhostButton>
                    ) : (
                      <GhostButton
                        onClick={() =>
                          startDictation((t) => {
                            setSoloAnswer((prev) => {
                              const next = prev ? `${prev} ${t}` : t;
                              onAnswerChange?.(next);
                              return next;
                            });
                          })
                        }
                        disabled={disabled}
                      >
                        🎤 Dictate
                      </GhostButton>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={questionBoxStyle}>
                <div style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 12, color: "#1f2937" }}>
                  {soloFollowUpQuestion}
                </div>
                <TextArea
                  value={soloFollowUpAnswer}
                  disabled={disabled || soloChecking}
                  placeholder="Answer in one complete sentence…"
                  onChange={(e) => {
                    setSoloFollowUpAnswer(e.target.value);
                    if (soloError) setSoloError("");
                  }}
                  onPaste={(e) => e.preventDefault()}
                  rows={3}
                  style={{
                    borderRadius: 12,
                    border: "2px solid rgba(59, 130, 246, 0.3)",
                    fontSize: 14,
                    padding: 12,
                    fontFamily: "inherit",
                  }}
                />
              </div>
            )}
          </div>

          {/* Feedback */}
          {soloFeedback && (
            <div
              style={{
                marginBottom: 12,
                padding: 14,
                borderRadius: 16,
                background: "linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%)",
                border: "2px solid rgba(34, 197, 94, 0.3)",
                animation: `popIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)`,
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 6, color: "#166534" }}>
                ✨ Feedback
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.5, color: "#1f2937" }}>
                {soloFeedback}
              </div>
            </div>
          )}

          {/* Error */}
          {soloError && (
            <div
              style={{
                marginBottom: 12,
                padding: 12,
                borderRadius: 12,
                background: "rgba(239, 68, 68, 0.1)",
                border: "2px solid rgba(239, 68, 68, 0.3)",
                color: "#991b1b",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              ⚠️ {soloError}
            </div>
          )}

          {/* Score float */}
          {soloShowScore && <ScoreFloat value={50} color="#10b981" />}

          {/* Submit button */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <PrimaryButton
              onClick={submitSolo}
              disabled={
                disabled ||
                soloChecking ||
                (soloStage === "answer"
                  ? !String(soloAnswer || "").trim()
                  : !String(soloFollowUpAnswer || "").trim())
              }
              style={{
                background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                transition: "all 0.3s ease",
              }}
            >
              {soloChecking ? "Checking..." : soloStage === "answer" ? "Submit Answer" : "Finish"}
            </PrimaryButton>
          </div>
        </div>
      ) : null}

      {/* TEAM MODE - TURN */}
      {isTeamVariation && phase === "turn" ? (
        <div style={{ animation: `slideInRight 0.5s ease-out` }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
              <Pill tone="purple">Turn {turnIdx + 1} of {players.length}</Pill>
              <Pill tone="blue" style={{ animation: `bounce 1s infinite` }}>
                👤 {players[turnIdx]}
              </Pill>
            </div>

            <div style={progressBarStyle}>
              <div
                style={{
                  ...progressFillStyle,
                  width: `${((turnIdx + 1) / players.length) * 100}%`,
                }}
              />
            </div>
          </div>

          <div style={questionBoxStyle}>
            <div style={{ fontSize: 13, marginBottom: 10, fontWeight: 700, color: "#6366f1" }}>
              ✍️ Write privately (keep it secret!)
            </div>
            <TextArea
              value={turnText}
              disabled={disabled}
              placeholder="One clear sentence about the passage…"
              onChange={(e) => setTurnText(e.target.value)}
              onPaste={(e) => e.preventDefault()}
              rows={3}
              style={{
                borderRadius: 12,
                border: "2px solid rgba(99, 102, 241, 0.3)",
                fontSize: 14,
                padding: 12,
              }}
            />

            {canUseSpeech && (
              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                {listening ? (
                  <GhostButton onClick={stopDictation} disabled={disabled}>
                    🎤 Stop
                  </GhostButton>
                ) : (
                  <GhostButton
                    onClick={() =>
                      startDictation((t) => setTurnText((prev) => (prev ? `${prev} ${t}` : t)))
                    }
                    disabled={disabled}
                  >
                    🎤 Dictate
                  </GhostButton>
                )}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <GhostButton
              onClick={() => setTurnText("")}
              disabled={disabled || !turnText}
            >
              Clear
            </GhostButton>
            <PrimaryButton
              onClick={lockCurrentTurn}
              disabled={disabled || !String(turnText || "").trim()}
              style={{
                flex: 1,
                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
              }}
            >
              ✅ Submit & Pass Device
            </PrimaryButton>
          </div>
        </div>
      ) : null}

      {/* TEAM MODE - PASS */}
      {isTeamVariation && phase === "pass" ? (
        <div
          style={{
            marginTop: 16,
            borderRadius: 20,
            padding: 20,
            background: "linear-gradient(135deg, rgba(124, 58, 242, 0.1) 0%, rgba(168, 85, 247, 0.1) 100%)",
            border: "2px dashed rgba(124, 58, 242, 0.3)",
            textAlign: "center",
            animation: `popIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)`,
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 8 }}>📱</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, color: "#7c3aed" }}>
            Pass the Device
          </div>
          <div style={{ opacity: 0.85, marginBottom: 12, fontSize: 14 }}>
            Next player: <strong>{players[turnIdx + 1] || `Player ${turnIdx + 2}`}</strong>
          </div>

          <div style={{ fontSize: 24, fontWeight: 900, color: "#ec4899", marginBottom: 12, animation: `pulse 1s infinite` }}>
            {Math.max(passCountdown, 0)}s
          </div>

          <GhostButton
            onClick={() => {
              if (disabled) return;
              if (passTimerRef.current) clearInterval(passTimerRef.current);
              passTimerRef.current = null;
              const next = turnIdx + 1;
              setTurnIdx(next);
              setTurnText("");
              setPhase("turn");
            }}
            disabled={disabled}
          >
            I'm Ready →
          </GhostButton>
        </div>
      ) : null}

      {/* TEAM MODE - REVEAL & VOTE */}
      {isTeamVariation && phase === "reveal" ? (
        <div style={{ animation: `slideInLeft 0.6s ease-out` }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#7c3aed", marginBottom: 10 }}>
              🗳️ Vote for the Best Response
            </div>
            <div style={progressBarStyle}>
              <div
                style={{
                  ...progressFillStyle,
                  width: voteIdx != null ? "100%" : "0%",
                }}
              />
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {players.map((name, i) => {
              const selected = voteIdx === i;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  onClick={() => setVoteIdx(i)}
                  style={{
                    textAlign: "left",
                    padding: 14,
                    borderRadius: 16,
                    border: selected
                      ? "3px solid #ec4899"
                      : "2px solid rgba(99, 102, 241, 0.2)",
                    background: selected
                      ? "linear-gradient(135deg, rgba(236, 72, 153, 0.1) 0%, rgba(168, 85, 247, 0.1) 100%)"
                      : "linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(99, 102, 241, 0.05) 100%)",
                    cursor: disabled ? "not-allowed" : "pointer",
                    transition: "all 0.3s ease",
                    transform: selected ? "scale(1.02)" : "scale(1)",
                    animation: selected ? `glow 1s infinite` : "none",
                    boxShadow: selected
                      ? "0 8px 24px rgba(236, 72, 153, 0.2)"
                      : "0 4px 12px rgba(0, 0, 0, 0.05)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <Pill tone={selected ? "pink" : "slate"}>{name}</Pill>
                    {selected && <div style={{ fontSize: 18 }}>✨</div>}
                  </div>
                  <div style={{ lineHeight: 1.6, fontSize: 14, color: "#1f2937" }}>
                    {responses[i] ? responses[i] : <span style={{ opacity: 0.5 }}>(No response)</span>}
                  </div>
                </button>
              );
            })}
          </div>

          {showTeamScore && <ScoreFloat value={teamScore} color="#f59e0b" />}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <PrimaryButton
              onClick={finalizeTeamSubmit}
              disabled={disabled || voteIdx == null || finalSent}
              style={{
                background: "linear-gradient(135deg, #ec4899 0%, #db2777 100%)",
              }}
            >
              {finalSent ? "✅ Submitted" : "🎉 Lock Vote & Submit"}
            </PrimaryButton>
          </div>
        </div>
      ) : null}

      {/* Confetti celebration */}
      {(showTeamScore && isTeamVariation) || (soloShowScore && !isTeamVariation) ? (
        <Confetti count={25} />
      ) : null}
    </TaskCardFrame>
  );
}
