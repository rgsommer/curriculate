// student-app/src/components/tasks/types/ReadingCompTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { TaskCardFrame, Pill, PrimaryButton, GhostButton, TextArea } from "../taskStyles";

/**
 * ReadingCompTask
 * - Solo: write a 1‑sentence reading‑comprehension response to a generated paragraph.
 * - Intra‑team variation (task.isTeamVariation === true):
 *    Each player writes a private 1‑sentence response, taps Submit (locks),
 *    then a brief “pass the device” screen appears.
 *    After the final player submits, all responses are revealed and the team votes on the best.
 *
 * Notes:
 * - Inter‑team play is NOT supported here (per spec).
 * - This component submits one final payload (after voting) for the team variation,
 *   so the backend can AI‑assess + award bonuses.
 */
export default function ReadingCompTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
  // optional integration props (TaskRunner may pass these)
  teamId = null,
  memberNames = [],
  roomCode = null,
}) {
  const isTeamVariation = !!task?.isTeamVariation;

  function isCompleteSentence(text, gradeLevel) {
    const t = String(text || "").trim();
    if (!t) return false;

    if ((gradeLevel || 0) < 5) return true;

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

  // paragraph
  // Paragraph: in demo/testing we sometimes receive a placeholder task with no paragraph yet.
  // Never show a scary "Loading paragraph…" string to students.
  const paragraph =
    task?.generatedParagraph ||
    task?.paragraph ||
    task?.text ||
    task?.config?.generatedParagraph ||
    task?.config?.paragraph ||
    (
      "In science class, we learned that ecosystems are made of living things and nonliving things working together. " +
      "Plants use sunlight to make food, and animals rely on plants or other animals for energy. " +
      "Water, temperature, and soil all affect what can live in a place. " +
      "If one part changes, other parts can change too. " +
      "For example, if a lake becomes polluted, fish may die and birds may have less to eat. " +
      "Healthy ecosystems usually have many different kinds of organisms. " +
      "This variety helps the system handle problems like disease or drought. " +
      "People can protect ecosystems by reducing waste and keeping habitats clean. " +
      "Small actions, like recycling, can add up when many people help. " +
      "Understanding ecosystems helps us make better choices for the environment."
    );

  // sentence target (for UI hints only — backend enforces on generation)
  const sentenceTarget =
    typeof task?.gradeLevel === "number"
      ? task.gradeLevel
      : typeof task?.config?.gradeLevel === "number"
      ? task.config.gradeLevel
      : null;

  // derive player list (team variation only)
  const players = useMemo(() => {
    const cleaned = Array.isArray(memberNames)
      ? memberNames.map((n) => String(n || "").trim()).filter(Boolean)
      : [];
    if (cleaned.length) return cleaned;

    const hintedSize =
      (typeof task?.teamSize === "number" && task.teamSize > 0 && task.teamSize) ||
      (typeof task?.config?.teamSize === "number" && task.config.teamSize > 0 && task.config.teamSize) ||
      3;

    return Array.from({ length: hintedSize }, (_, i) => `Player ${i + 1}`);
  }, [memberNames, task]);

  // -----------------------------
  // speech recognition (optional)
  // -----------------------------
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

  // -----------------------------
  // SOLO MODE
  // -----------------------------
  const [soloAnswer, setSoloAnswer] = useState(() => String(answerDraft || ""));
  const [soloStage, setSoloStage] = useState("answer"); // "answer" | "followup"
  const [soloFollowUpQuestion, setSoloFollowUpQuestion] = useState("");
  const [soloFollowUpAnswer, setSoloFollowUpAnswer] = useState("");
  const [soloChecking, setSoloChecking] = useState(false);
  const [soloError, setSoloError] = useState("");
  const [soloFeedback, setSoloFeedback] = useState("");
  
  const gradeLevel =
    typeof task?.gradeLevel === "number"
      ? task.gradeLevel
      : typeof task?.config?.gradeLevel === "number"
      ? task.config.gradeLevel
      : null;

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

        setTimeout(() => {
          onSubmit(payload);
        }, 1800);

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
        comprehensionCheck: {
          decision: "followup_answered",
          followUpQuestion: soloFollowUpQuestion,
          followUpAnswer: followAns,
          feedback: soloFeedback || "",
        },
      });
    }
  };

  // -----------------------------
  // TEAM VARIATION MODE
  // -----------------------------
  const [phase, setPhase] = useState(isTeamVariation ? "turn" : "solo"); // "turn" | "pass" | "reveal" | "submitted"
  const [turnIdx, setTurnIdx] = useState(0);
  const [turnText, setTurnText] = useState("");
  const [responses, setResponses] = useState(() => players.map(() => ""));
  const [locked, setLocked] = useState(() => players.map(() => false));

  // pass-screen countdown
  const [passCountdown, setPassCountdown] = useState(15);
  const passTimerRef = useRef(null);

  // voting
  const [voteIdx, setVoteIdx] = useState(null);
  const [finalSent, setFinalSent] = useState(false);

  // reset if task changes
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

  // Reset follow-up when needed
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

  // pass countdown tick
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

  // auto-advance at end of countdown
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

    // show pass screen unless this was the last turn
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
    });
  };

  // common UI blocks
  const headerPill = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <Pill tone="blue">Reading Comp</Pill>
      {isTeamVariation ? <Pill tone="purple">Intra‑Team</Pill> : <Pill tone="green">Solo</Pill>}
      {sentenceTarget ? <Pill tone="slate">{sentenceTarget} sentences</Pill> : null}
      {teamId ? <Pill tone="slate">Team {String(teamId).slice(-4)}</Pill> : null}
    </div>
  );

  const paperBoxStyle = {
    backgroundColor: "rgba(255,255,255,0.78)",
    backgroundImage:
      "radial-gradient(circle at 18% 12%, rgba(2,6,23,0.05), transparent 48%)," +
      "radial-gradient(circle at 82% 38%, rgba(2,6,23,0.035), transparent 55%)," +
      "repeating-linear-gradient(0deg, rgba(2,6,23,0.022), rgba(2,6,23,0.022) 1px, transparent 1px, transparent 7px)," +
      "repeating-linear-gradient(90deg, rgba(2,6,23,0.012), rgba(2,6,23,0.012) 1px, transparent 1px, transparent 12px)",
    backgroundBlendMode: "multiply",
    border: "1px solid rgba(15, 23, 42, 0.08)",
    borderRadius: 16,
    boxShadow: "0 8px 24px rgba(2,6,23,0.06)",
  };

  // render
  return (
    <TaskCardFrame
      title={
        String(task?.title || "").toLowerCase().includes("placeholder")
          ? "Reading Comprehension"
          : task?.title || "Reading Comprehension"
      }
      subtitle={
        task?.prompt ||
        "Read the paragraph. Then write ONE clear sentence that shows you understood it."
      }
      headerRight={headerPill}
    >
      {/* Clear, student-friendly instructions (Grade 7 level) */}
      <div
        style={{
          borderRadius: 16,
          padding: 12,
          marginBottom: 10,
          border: "1px solid rgba(15, 23, 42, 0.10)",
          background: "rgba(255,255,255,0.70)",
          boxShadow: "0 8px 22px rgba(2,6,23,0.05)",
        }}
      >
        {!isTeamVariation ? (
          <div style={{ color: "#334155", lineHeight: 1.4 }}>
            <div style={{ fontWeight: 1000, marginBottom: 6 }}>How to do this task</div>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                <strong>Read</strong> the paragraph below.
              </li>
              <li>
                Write <strong>one clear sentence</strong> that shows you understood it.
              </li>
              <li>
                Tap <strong>Submit</strong> when you are ready.
              </li>
            </ol>
          </div>
        ) : (
          <div style={{ color: "#334155", lineHeight: 1.4 }}>
            <div style={{ fontWeight: 1000, marginBottom: 6 }}>Team version: pass the device</div>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                <strong>Player 1</strong> writes one sentence, then taps <strong>Submit & Pass</strong>.
              </li>
              <li>
                The screen will say <strong>Pass the device</strong>. Hand it to the next player.
              </li>
              <li>
                After everyone writes, all answers are revealed. As a team, <strong>vote</strong> for the best one.
              </li>
            </ol>
            <div style={{ marginTop: 8, fontSize: 12, color: "#64748b", fontWeight: 700 }}>
              Tip: Keep your answer private during your turn.
            </div>
          </div>
        )}
      </div>

      {/* Paragraph panel */}
      <div
        style={{
          ...paperBoxStyle,
          padding: 14,
          marginBottom: 12,
          userSelect: "none",
          WebkitUserSelect: "none",
          MozUserSelect: "none",
          msUserSelect: "none",
        }}
        onCopy={(e) => e.preventDefault()}
        onCut={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 8 }}>Read:</div>
        <div style={{ lineHeight: 1.5, fontSize: 15 }}>
          {paragraph}
        </div>
      </div>

      {/* SOLO */}
      {!isTeamVariation ? (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div style={{ fontSize: 13, opacity: 0.8 }}>
              {soloStage === "answer" ? "Your one-sentence response:" : "Your follow-up answer:"}
            </div>
            {canUseSpeech ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Pill tone={listening ? "green" : "slate"}>{listening ? "Listening…" : "Dictate"}</Pill>
                {listening ? (
                  <GhostButton onClick={stopDictation} disabled={disabled}>
                    Stop
                  </GhostButton>
                ) : (
                  <GhostButton
                    onClick={() =>
                      startDictation((t) => {
                        if (soloStage === "answer") {
                          setSoloAnswer((prev) => {
                            const next = prev ? `${prev} ${t}` : t;
                            onAnswerChange?.(next);
                            return next;
                          });
                        } else {
                          setSoloFollowUpAnswer((prev) => (prev ? `${prev} ${t}` : t));
                          if (soloError) setSoloError("");
                        }
                      })
                    }
                    disabled={disabled}
                  >
                    Start
                  </GhostButton>
                )}
              </div>
            ) : null}
          </div>

          <div style={{ ...paperBoxStyle, marginTop: 10, padding: 12 }}>
            {soloStage === "answer" ? (
              <TextArea
                value={soloAnswer}
                disabled={disabled || soloChecking}
                placeholder="One sentence…"
                onChange={(e) => {
                  setSoloAnswer(e.target.value);
                  onAnswerChange?.(e.target.value);
                  if (soloError) setSoloError("");
                  if (soloFeedback) setSoloFeedback("");
                }}
                onPaste={(e) => e.preventDefault()}
                rows={3}
              />
            ) : (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                  Follow-up question:
                </div>
                <div style={{ marginBottom: 10, lineHeight: 1.5 }}>
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
                />
              </>
            )}
          </div>

          {soloFeedback ? (
            <div
              style={{
                marginTop: 10,
                padding: 12,
                borderRadius: 14,
                background: "#0f172a",
                color: "#ffffff",
                border: "1px solid rgba(255,255,255,0.16)",
                boxShadow: "0 10px 24px rgba(2,6,23,0.18)",
                lineHeight: 1.4,
                fontSize: 14,
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 6 }}>
                {soloStage === "followup" ? "Feedback" : "What we noticed"}
              </div>
              <div>{soloFeedback}</div>
            </div>
          ) : null}

          {soloError ? (
            <div style={{ marginTop: 8, color: "#b91c1c", fontSize: 13, fontWeight: 700 }}>
              {soloError}
            </div>
          ) : null}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <PrimaryButton
              onClick={submitSolo}
              disabled={
                disabled ||
                soloChecking ||
                (soloStage === "answer"
                  ? !String(soloAnswer || "").trim()
                  : !String(soloFollowUpAnswer || "").trim())
              }
            >
              {soloChecking
                ? "Checking..."
                : soloStage === "answer"
                ? "Submit"
                : "Finish"}
            </PrimaryButton>
          </div>
        </div>
      ) : null}

      {/* TEAM: TURN */}
      {isTeamVariation && phase === "turn" ? (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              alignItems: "center",
              marginTop: 2,
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Pill tone="purple">Turn {turnIdx + 1} / {players.length}</Pill>
              <Pill tone="slate">{players[turnIdx] || `Player ${turnIdx + 1}`}</Pill>
              <Pill tone="slate">{locked[turnIdx] ? "Locked" : "Write privately"}</Pill>
            </div>

            {canUseSpeech ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Pill tone={listening ? "green" : "slate"}>{listening ? "Listening…" : "Dictate"}</Pill>
                {listening ? (
                  <GhostButton onClick={stopDictation} disabled={disabled}>
                    Stop
                  </GhostButton>
                ) : (
                  <GhostButton
                    onClick={() =>
                      startDictation((t) => setTurnText((prev) => (prev ? `${prev} ${t}` : t)))
                    }
                    disabled={disabled}
                  >
                    Start
                  </GhostButton>
                )}
              </div>
            ) : null}
          </div>

          <div style={{ ...paperBoxStyle, marginTop: 10, padding: 12 }}>
            <TextArea
              value={turnText}
              disabled={disabled}
              placeholder="ONE sentence… (keep it private)"
              onChange={(e) => setTurnText(e.target.value)}
              onPaste={(e) => e.preventDefault()}
              rows={3}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 12 }}>
            <GhostButton
              onClick={() => {
                // teacher-friendly: allow a quick clear without losing paragraph
                if (disabled) return;
                setTurnText("");
              }}
              disabled={disabled || !turnText}
            >
              Clear
            </GhostButton>

            <PrimaryButton onClick={lockCurrentTurn} disabled={disabled || !String(turnText || "").trim()}>
              Submit &amp; Pass
            </PrimaryButton>
          </div>
        </div>
      ) : null}

      {/* TEAM: PASS */}
      {isTeamVariation && phase === "pass" ? (
        <div
          style={{
            marginTop: 8,
            borderRadius: 18,
            padding: 16,
            border: "1px dashed rgba(15, 23, 42, 0.18)",
            background: "rgba(255,255,255,0.55)",
            boxShadow: "0 10px 28px rgba(2,6,23,0.05)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Pass the device</div>
          <div style={{ opacity: 0.85, marginBottom: 10 }}>
            Next up: <strong>{players[turnIdx + 1] || `Player ${turnIdx + 2}`}</strong>
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
            <Pill tone="slate">Starting in {Math.max(passCountdown, 0)}s</Pill>
            <GhostButton
              onClick={() => {
                // manual advance (teacher-friendly)
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
              Ready
            </GhostButton>
          </div>
        </div>
      ) : null}

      {/* TEAM: REVEAL + VOTE */}
      {isTeamVariation && phase === "reveal" ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <Pill tone="purple">Reveal</Pill>
            <Pill tone="slate">Vote as a team</Pill>
            <Pill tone="slate">Pick the best response</Pill>
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
                    padding: 12,
                    borderRadius: 16,
                    border: selected
                      ? "2px solid rgba(59,130,246,0.75)"
                      : "1px solid rgba(15, 23, 42, 0.10)",
                    background: selected ? "rgba(59,130,246,0.08)" : "rgba(255,255,255,0.70)",
                    boxShadow: "0 10px 26px rgba(2,6,23,0.05)",
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <Pill tone={selected ? "blue" : "slate"}>{name}</Pill>
                      {selected ? <Pill tone="green">Selected</Pill> : null}
                    </div>
                  </div>
                  <div style={{ marginTop: 8, lineHeight: 1.5, fontSize: 14 }}>
                    {responses[i] ? responses[i] : <span style={{ opacity: 0.6 }}>(No response)</span>}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
            <PrimaryButton onClick={finalizeTeamSubmit} disabled={disabled || voteIdx == null || finalSent}>
              {finalSent ? "Submitted" : "Lock Vote & Submit"}
            </PrimaryButton>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
            Once submitted, responses are locked. Your bonus scoring is calculated by the AI scorer.
          </div>
        </div>
      ) : null}
    </TaskCardFrame>
  );
}
