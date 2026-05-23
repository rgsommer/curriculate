// student-app/src/components/tasks/types/OpenTextTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import DesignatedWriter from "../DesignatedWriter";
import HandwritingCapture, { HANDWRITING_BONUS_POINTS } from "../HandwritingCapture";

/**
 * Open-text response task.
 * - Large text box that can fill the task card space
 * - Optional speech-to-text helper
 * - Optional minimum word requirement (for medium/hard)
 *
 * Expected task shape (typical):
 * {
 *   taskType: "open-text",
 *   prompt: "...",
 *   settings: {
 *     gradeLevel: 8,
 *     difficulty: "easy"|"medium"|"hard",
 *     minWords: 16,           // optional; if omitted we compute from grade+difficulty
 *     language: "en-US"       // optional speech recognition language
 *   }
 * }
 */

// Confetti particle generator
const Confetti = ({ duration = 2000 }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = Array.from({ length: 50 }, () => ({
      x: Math.random() * canvas.width,
      y: -10,
      vx: (Math.random() - 0.5) * 8,
      vy: Math.random() * 4 + 3,
      life: 1,
      decay: Math.random() * 0.015 + 0.01,
      emoji: ["✨", "🎉", "⭐", "🌟", "💫"][Math.floor(Math.random() * 5)],
    }));

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach((p) => {
        p.y += p.vy;
        p.x += p.vx;
        p.life -= p.decay;

        if (p.life > 0) {
          ctx.globalAlpha = p.life;
          ctx.font = "24px Arial";
          ctx.fillText(p.emoji, p.x, p.y);
        }
      });

      ctx.globalAlpha = 1;

      if (particles.some((p) => p.life > 0)) {
        requestAnimationFrame(animate);
      }
    };

    animate();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        pointerEvents: "none",
        zIndex: 9999,
      }}
    />
  );
};

export default function OpenTextTask({
  task,
  onSubmit,
  // legacy prop name in some callers:
  answered,
  // preferred prop name in TaskRunner:
  disabled,
  onAnswerChange,
  answerDraft,
  memberNames,
}) {
  const initial = useMemo(() => {
    if (
      answerDraft &&
      typeof answerDraft === "object" &&
      typeof answerDraft.response === "string"
    ) {
      return answerDraft.response;
    }
    if (typeof answerDraft === "string") return answerDraft;
    return "";
  }, [answerDraft]);

  const [value, setValue] = useState(initial);
  const [isListening, setIsListening] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [milestone, setMilestone] = useState(null);
  const [handwritingUsed, setHandwritingUsed] = useState(false);
  const [handwritingPhoto, setHandwritingPhoto] = useState(null);
  const recognitionRef = useRef(null);
  const textareaRef = useRef(null);
  const prevWordCountRef = useRef(0);

  // Undo history — snapshot every 2 seconds of typing or on large deletions
  const [undoStack, setUndoStack] = useState([]);
  const lastSnapshotRef = useRef({ text: initial, ts: Date.now() });

  const isDisabled = !!disabled || !!answered;

  const basePoints = task?.points || 0;

  const gradeLevel = Number(
    task?.settings?.gradeLevel ?? task?.gradeLevel ?? task?.config?.gradeLevel
  );
  const difficultyRaw = String(
    task?.settings?.difficulty ??
      task?.difficulty ??
      task?.config?.difficulty ??
      "easy"
  ).toLowerCase();

  const computedMinWords = useMemo(() => {
    const explicit = Number(task?.settings?.minWords ?? task?.config?.minWords);
    if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);

    const g = Number.isFinite(gradeLevel) && gradeLevel > 0 ? gradeLevel : 8;
    if (difficultyRaw === "hard") return 3 * g;
    if (difficultyRaw === "medium") return 2 * g;
    return 0;
  }, [task?.settings?.minWords, task?.config?.minWords, gradeLevel, difficultyRaw]);

  const wordCount = useMemo(() => {
    const t = String(value || "").trim();
    if (!t) return 0;
    return t.split(/\s+/).filter(Boolean).length;
  }, [value]);

  const charCount = String(value || "").length;

  const meetsMin = computedMinWords <= 0 ? true : wordCount >= computedMinWords;

  // Length bonus: substantive answers earn extra points. Single source of
  // truth for both the "+N bonus" indicator and the submit payload. Tiers:
  // <20 = 0; 20-39 = +1; 40-79 = +3; 80-149 = +5; 150+ = +7.
  // (Server re-caps to guard against tampering.)
  const lengthBonusPoints = useMemo(() => {
    if (wordCount >= 150) return 7;
    if (wordCount >= 80) return 5;
    if (wordCount >= 40) return 3;
    if (wordCount >= 20) return 1;
    return 0;
  }, [wordCount]);

  // Milestone celebrations
  useEffect(() => {
    if (wordCount > prevWordCountRef.current) {
      if (wordCount === 50 || wordCount === 100 || (wordCount > 100 && wordCount % 50 === 0)) {
        setMilestone(wordCount);
        setTimeout(() => setMilestone(null), 1500);
      }
    }
    prevWordCountRef.current = wordCount;
  }, [wordCount]);

  // reset when a new task comes in or answerDraft changes
  useEffect(() => {
    setValue(initial);
  }, [task?._id, task?.id, task?.prompt, initial]);

  const emitDraft = (textValue) => {
    if (!onAnswerChange) return;
    onAnswerChange({
      correct: false,
      basePoints,
      response: textValue,
      wordCount: String(textValue || "").trim()
        ? String(textValue).trim().split(/\s+/).filter(Boolean).length
        : 0,
      minWords: computedMinWords || 0,
    });
  };

  const handleSubmitClick = () => {
    if (isDisabled) return;
    if (!meetsMin) return;

    setIsSubmitting(true);
    setShowConfetti(true);

    // Play sound effect
    try {
      const audio = new Audio("/sounds/yay.mp3");
      audio.play().catch(() => {});
    } catch (e) {
      // Silently fail if sound not available
    }

    setTimeout(() => {
      const payload = {
        type: task?.taskType || task?.type || "open-text",
        correct: false,
        basePoints,
        response: value,
        wordCount,
        minWords: computedMinWords || 0,
        ...(lengthBonusPoints > 0 && {
          lengthBonus: true,
          lengthBonusPoints,
        }),
        ...(handwritingUsed && {
          handwritingBonus: true,
          handwritingBonusPoints: HANDWRITING_BONUS_POINTS,
          handwritingPhotoUrl: handwritingPhoto || undefined,
        }),
      };

      onSubmit?.(payload);
      setValue("");
      setIsSubmitting(false);
      setShowConfetti(false);
    }, 800);
  };

  const handleChange = (e) => {
    const next = e.target.value;
    const prev = value;

    // Snapshot for undo: on large deletions (>10 chars lost) or every 2s of typing
    const now = Date.now();
    const charDiff = prev.length - next.length;
    const shouldSnapshot =
      charDiff > 10 || // big deletion (accidental select-all + delete)
      (now - lastSnapshotRef.current.ts > 2000 && prev !== lastSnapshotRef.current.text);

    if (shouldSnapshot && prev.trim()) {
      setUndoStack((stack) => [...stack.slice(-19), prev]); // keep last 20
      lastSnapshotRef.current = { text: next, ts: now };
    }

    setValue(next);
    if (errorMsg) setErrorMsg("");
    emitDraft(next);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const restored = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setValue(restored);
    emitDraft(restored);
    lastSnapshotRef.current = { text: restored, ts: Date.now() };
  };

  // Track the text that existed before dictation started, so we append rather than replace
  const preDictateTextRef = useRef("");

  const startListening = () => {
    if (typeof window === "undefined" || !window.SpeechRecognition) {
      setErrorMsg("Voice input is not supported on this browser. Try Chrome or Safari.");
      return;
    }

    try {
      const recognition = new window.SpeechRecognition();
      recognition.lang = task?.settings?.language || "en-US";
      recognition.interimResults = true;
      recognition.continuous = true;

      // Remember what was already typed so we APPEND dictated text
      preDictateTextRef.current = value || "";

      recognition.onresult = (event) => {
        let finalText = "";
        let interimText = "";
        for (let i = 0; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalText += t;
          } else {
            interimText += t;
          }
        }
        const combined = (preDictateTextRef.current + " " + finalText + interimText).replace(/^\s+/, "");
        setValue(combined);
        emitDraft(combined);
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);

        if (event.error === "not-allowed") {
          setErrorMsg("Microphone access was denied. Please allow mic access and try again.");
        } else if (event.error === "no-speech") {
          // Don't kill listening — just ignore
          return;
        } else if (event.error === "aborted") {
          // Normal abort from stopListening, ignore
          return;
        } else {
          setErrorMsg("Voice input isn't working right now. You can still type your answer.");
        }

        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
      setErrorMsg("");
    } catch (err) {
      console.error("Speech recognition start failed:", err);
      setErrorMsg("Voice input is not available. Please type your response.");
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  };

  // Auto-stop dictation when task becomes disabled (e.g. time's up / force-ended)
  useEffect(() => {
    if (isDisabled && isListening) {
      stopListening();
    }
  }, [isDisabled, isListening]);

  const progressPercent = computedMinWords > 0 ? Math.min(100, (wordCount / computedMinWords) * 100) : (wordCount > 0 ? 100 : 0);

  const getProgressColor = () => {
    if (progressPercent < 30) return "#f97316";
    if (progressPercent < 70) return "#eab308";
    return "#22c55e";
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "12px",
        gap: "12px",
        minHeight: "260px",
        opacity: isDisabled ? 0.75 : 1,
        animation: "fadeInScale 0.6s ease-out",
      }}
    >
      <style>{`
        @keyframes fadeInScale {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes slideInDown {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        @keyframes textPulse {
          0% { opacity: 0; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.1); }
          100% { opacity: 0; transform: scale(0.8); }
        }
        @keyframes shimmer {
          0% { background-position: -1000px 0; }
          100% { background-position: 1000px 0; }
        }
      `}</style>

      <div
        style={{
          borderRadius: "20px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.08)",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          padding: "20px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Animated gradient background */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "linear-gradient(135deg, rgba(102,126,234,0.1) 0%, rgba(118,75,162,0.1) 100%)",
            animation: "shimmer 6s infinite",
            backgroundSize: "200% 100%",
            pointerEvents: "none",
          }}
        />

        {/* Decorative circles */}
        <div
          style={{
            position: "absolute",
            top: "-50px",
            right: "-50px",
            width: "200px",
            height: "200px",
            background: "rgba(255,255,255,0.05)",
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-80px",
            left: "-80px",
            width: "250px",
            height: "250px",
            background: "rgba(255,255,255,0.03)",
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />

        {/* Content container */}
        <div style={{ position: "relative", zIndex: 10, display: "flex", flexDirection: "column", height: "100%" }}>
          {/* Header card with animation */}
          <div
            style={{
              background: "rgba(255,255,255,0.95)",
              borderRadius: "16px",
              padding: "16px",
              marginBottom: "14px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
              animation: "slideInDown 0.8s ease-out",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{ fontSize: "20px" }}>✍️</span>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#667eea", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Share Your Thoughts
              </div>
            </div>
            <h2
              style={{
                fontSize: "18px",
                fontWeight: 800,
                color: "#1e293b",
                margin: "4px 0",
                lineHeight: 1.3,
              }}
            >
              {task?.title || "Explain your thinking"}
            </h2>
            {!!task?.prompt && (
              <p
                style={{
                  marginTop: "10px",
                  fontSize: "14px",
                  fontWeight: 600,
                  lineHeight: 1.4,
                  color: "#475569",
                  margin: 0,
                }}
              >
                {task.prompt}
              </p>
            )}
          </div>

          {/* Designated writer banner */}
          <DesignatedWriter memberNames={memberNames} taskTitle={task?.title} taskIndex={task?._taskIndex} />

          {/* Tips card */}
          <div
            style={{
              background: "rgba(255,255,255,0.9)",
              borderRadius: "12px",
              padding: "12px 14px",
              marginBottom: "12px",
              borderLeft: "4px solid #667eea",
              fontSize: "12px",
              color: "#334155",
              lineHeight: 1.4,
              fontWeight: 500,
            }}
          >
            <div style={{ fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>💡 Tips:</div>
            <div>Use specific examples and explain your reasoning clearly.</div>
          </div>

          {/* Handwriting capture — write on paper for bonus points */}
          {!isDisabled && !answered && (
            <HandwritingCapture
              onTextExtracted={(text, photoUrl, allPlayerPhotos) => {
                setValue((prev) => {
                  const merged = prev ? prev + "\n\n" + text : text;
                  emitDraft(merged);
                  return merged;
                });
                setHandwritingUsed(true);
                setHandwritingPhoto(allPlayerPhotos || photoUrl);
              }}
              disabled={isDisabled}
              bonusPoints={HANDWRITING_BONUS_POINTS}
              memberNames={memberNames}
            />
          )}

          {/* Error message */}
          {!!errorMsg && (
            <div
              style={{
                borderRadius: "12px",
                border: "1px solid rgba(239,68,68,0.5)",
                background: "rgba(254,226,226,0.9)",
                padding: "10px 12px",
                marginBottom: "10px",
                color: "#7f1d1d",
                fontWeight: 700,
                fontSize: "12px",
                animation: "slideInDown 0.3s ease-out",
              }}
            >
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Media display */}
          {task?.mediaUrl && (
            <img
              src={task.mediaUrl}
              alt=""
              style={{
                maxWidth: "100%",
                borderRadius: "12px",
                marginBottom: "12px",
                maxHeight: "180px",
                objectFit: "cover",
              }}
            />
          )}

          {/* Textarea with enhanced styling */}
          <div
            style={{
              position: "relative",
              marginBottom: "12px",
              flex: 1,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleChange}
              onPaste={(e) => e.preventDefault()}
              placeholder={
                isDisabled
                  ? "Submitted. Waiting for next task…"
                  : "Type your thoughtful response here… no rush, take your time! 🌟"
              }
              disabled={isDisabled}
              style={{
                borderRadius: "12px",
                border: "2px solid rgba(255,255,255,0.3)",
                background: isDisabled ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.95)",
                color: "#1e293b",
                padding: "14px",
                flex: 1,
                minHeight: "140px",
                resize: "none",
                lineHeight: 1.5,
                fontSize: "14px",
                fontFamily: "inherit",
                boxSizing: "border-box",
                transition: "all 0.3s ease",
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                outline: "none",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "rgba(255,255,255,0.6)";
                e.target.style.boxShadow = "0 8px 20px rgba(0,0,0,0.12), inset 0 0 0 2px rgba(102,126,234,0.2)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "rgba(255,255,255,0.3)";
                e.target.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
              }}
            />

            {/* Progress bar for min words requirement */}
            {computedMinWords > 0 && (
              <div
                style={{
                  marginTop: "8px",
                  height: "6px",
                  background: "rgba(255,255,255,0.2)",
                  borderRadius: "3px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${progressPercent}%`,
                    background: getProgressColor(),
                    transition: "all 0.3s ease",
                    borderRadius: "3px",
                  }}
                />
              </div>
            )}
          </div>

          {/* Counter & Toolbar */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              marginBottom: "12px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "rgba(255,255,255,0.15)",
                borderRadius: "12px",
                padding: "10px 12px",
                backdropFilter: "blur(10px)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                {/* Word count badge */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    background: meetsMin && computedMinWords > 0 ? "rgba(34,197,94,0.2)" : "rgba(14,165,233,0.2)",
                    color: meetsMin && computedMinWords > 0 ? "#16a34a" : "#0ea5e9",
                    borderRadius: "8px",
                    padding: "6px 10px",
                    fontWeight: 700,
                    fontSize: "13px",
                  }}
                >
                  <span style={{ fontSize: "16px" }}>📝</span>
                  {computedMinWords > 0 ? `${wordCount}/${computedMinWords}` : `${wordCount}`}
                </div>

                {/* Length-bonus indicator (tester ask): visualises bonus
                    points the player is "earning" just for being substantive.
                    AI scoring at submit can claw it back if the words are
                    nonsense — but seeing the bonus tick up encourages
                    longer answers. */}
                {(() => {
                  // Tiers live in lengthBonusPoints (shared with submit payload).
                  const bonus = lengthBonusPoints;
                  return (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        background: bonus > 0 ? "rgba(245,158,11,0.25)" : "rgba(255,255,255,0.06)",
                        border: bonus > 0 ? "1px solid rgba(245,158,11,0.55)" : "1px solid rgba(255,255,255,0.10)",
                        color: bonus > 0 ? "#fbbf24" : "rgba(255,255,255,0.5)",
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontWeight: 800,
                        fontSize: 13,
                        transition: "all 0.2s",
                      }}
                      title="Substantive-answer bonus.  AI may dock it at submit if the words don't make sense."
                    >
                      ✨ +{bonus} bonus
                    </div>
                  );
                })()}

                {/* Character count */}
                <div
                  style={{
                    fontSize: "11px",
                    color: "rgba(255,255,255,0.8)",
                    fontWeight: 600,
                  }}
                >
                  {charCount} chars
                </div>
              </div>

              {/* Undo button */}
              {undoStack.length > 0 && !isDisabled && (
                <button
                  type="button"
                  onClick={handleUndo}
                  style={{
                    fontSize: "12px",
                    padding: "6px 12px",
                    borderRadius: "20px",
                    border: "none",
                    cursor: "pointer",
                    backgroundColor: "rgba(251,191,36,0.25)",
                    color: "#fbbf24",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    transition: "all 0.2s ease",
                  }}
                  title="Undo last change"
                >
                  ↩ Undo
                </button>
              )}

              {/* Mic button */}
              <button
                type="button"
                onClick={isListening ? stopListening : startListening}
                disabled={isDisabled}
                style={{
                  fontSize: "12px",
                  padding: "6px 12px",
                  borderRadius: "20px",
                  border: "none",
                  cursor: isDisabled ? "not-allowed" : "pointer",
                  backgroundColor: isDisabled
                    ? "rgba(0,0,0,0.1)"
                    : isListening
                    ? "#ef4444"
                    : "rgba(255,255,255,0.25)",
                  color: "#fff",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  transition: "all 0.2s ease",
                  opacity: isDisabled ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!isDisabled) {
                    e.target.style.backgroundColor = isListening
                      ? "#dc2626"
                      : "rgba(255,255,255,0.35)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isDisabled) {
                    e.target.style.backgroundColor = isListening
                      ? "#ef4444"
                      : "rgba(255,255,255,0.25)";
                  }
                }}
                title="Speech-to-text (browser support required)"
              >
                {isListening ? "Stop 🎤" : "Speak 🎤"}
              </button>
            </div>

            {/* Milestone celebration */}
            {milestone && (
              <div
                style={{
                  textAlign: "center",
                  color: "#fff",
                  fontSize: "14px",
                  fontWeight: 800,
                  animation: "textPulse 1.5s ease-out forwards",
                }}
              >
                🎉 {milestone} words! Keep going! 🎉
              </div>
            )}

            {/* Motivational text */}
            {computedMinWords > 0 && !meetsMin && !isDisabled && (
              <div
                style={{
                  fontSize: "12px",
                  color: "rgba(255,255,255,0.85)",
                  fontWeight: 600,
                  textAlign: "center",
                }}
              >
                {wordCount === 0
                  ? "Start writing to see your progress..."
                  : `Only ${computedMinWords - wordCount} more words to go! 💪`}
              </div>
            )}
          </div>

          {/* Submit button - BIG & SATISFYING */}
          <button
            type="button"
            onClick={handleSubmitClick}
            disabled={isDisabled || !String(value || "").trim() || !meetsMin || isSubmitting}
            style={{
              padding: "16px 32px",
              borderRadius: "12px",
              border: "none",
              fontSize: "16px",
              fontWeight: 800,
              cursor: isDisabled || !String(value || "").trim() || !meetsMin || isSubmitting ? "not-allowed" : "pointer",
              background:
                isDisabled || !String(value || "").trim() || !meetsMin
                  ? "rgba(0,0,0,0.2)"
                  : isSubmitting
                  ? "rgba(255,255,255,0.3)"
                  : "linear-gradient(135deg, #fff 0%, #f0f9ff 100%)",
              color: isDisabled || !String(value || "").trim() || !meetsMin ? "rgba(255,255,255,0.5)" : "#667eea",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              transition: "all 0.3s ease",
              boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
              opacity: isDisabled || !String(value || "").trim() || !meetsMin ? 0.6 : 1,
              transform: isSubmitting ? "scale(0.98)" : "scale(1)",
              animation: isSubmitting ? "pulse 0.6s ease-in-out" : "none",
            }}
            onMouseEnter={(e) => {
              if (!isDisabled && String(value || "").trim() && meetsMin && !isSubmitting) {
                e.target.style.transform = "translateY(-2px)";
                e.target.style.boxShadow = "0 12px 32px rgba(0,0,0,0.2)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isDisabled && String(value || "").trim() && meetsMin && !isSubmitting) {
                e.target.style.transform = "translateY(0)";
                e.target.style.boxShadow = "0 8px 24px rgba(0,0,0,0.15)";
              }
            }}
          >
            {isSubmitting ? "Submitting... ✨" : "Submit Answer"}
          </button>
        </div>
      </div>

      {/* Confetti on submit */}
      {showConfetti && <Confetti />}
    </div>
  );
}
